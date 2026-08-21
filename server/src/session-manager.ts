import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Db } from "./db.js";
import { RpcBridge, type BridgeMessage } from "./rpc-bridge.js";
import type { AppConfig } from "./config.js";
import { trackToolEvent } from "./artifacts.js";
import { writeMcpConfigIfNeeded } from "./mcp/bridge-config.js";

export type SessionStatus = "stopped" | "starting" | "running" | "crashed";

export interface SessionMeta {
	id: string;
	name: string;
	status: SessionStatus;
	engine: "pi";
	model: string | null;
	modelProvider: string | null;
	thinkingLevel: string | null;
	hasHistory: boolean;
	createdAt: number;
	updatedAt: number;
	lastError?: string;
}

export interface SessionRuntime {
	meta: SessionMeta;
	bridge: RpcBridge | null;
	workspaceDir: string;
	stopping: boolean;
}

export interface WsBroadcaster {
	(sessionId: string, msg: unknown): void;
}

export const RPC_COMMAND_TYPES = new Set([
	"prompt", "steer", "follow_up", "abort", "new_session",
	"get_state", "set_model", "cycle_model", "get_available_models",
	"set_thinking_level", "cycle_thinking_level", "get_available_thinking_levels",
	"set_steering_mode", "set_follow_up_mode",
	"compact", "set_auto_compaction", "set_auto_retry", "abort_retry",
	"bash", "abort_bash",
	"get_session_stats", "export_html", "switch_session", "fork", "clone",
	"get_fork_messages", "get_entries", "get_tree", "get_last_assistant_text",
	"set_session_name", "get_messages", "get_commands",
]);

/** Commands that need a running process and may legitimately take a while. */
const SLOW_COMMANDS = new Set(["prompt", "steer", "follow_up", "compact", "bash", "get_entries", "get_tree", "export_html"]);
const RPC_TIMEOUT_MS = 60_000;
const SLOW_TIMEOUT_MS = 10 * 60_000;

export interface SessionManagerOptions {
	config: AppConfig;
	db: Db;
	broadcast: WsBroadcaster;
	/** Injectable spawn for tests. */
	spawnBridge?: (opts: {
		cliPath: string;
		args: string[];
		cwd: string;
		env: Record<string, string | undefined>;
		onEvent: (msg: BridgeMessage) => void;
		onStderr: (line: string) => void;
		onExit: (code: number | null, signal: string | null, stderrTail: string[]) => void;
	}) => RpcBridge;
}

export class SessionManager {
	private runtimes = new Map<string, SessionRuntime>();
	private opts: SessionManagerOptions;
	private onEventInternal: (sessionId: string, msg: BridgeMessage) => void;
	/** Overridable broadcaster (wired to the WS hub at startup). */
	broadcast: WsBroadcaster;

	constructor(opts: SessionManagerOptions) {
		this.opts = opts;
		this.broadcast = opts.broadcast;
		this.onEventInternal = (sessionId, msg) => this.handleEvent(sessionId, msg);
	}

	get config() {
		return this.opts.config;
	}

	// ------------------------------------------------------------------ meta

	private rowToMeta(row: any): SessionMeta {
		return {
			id: row.id,
			name: row.name,
			status: row.status,
			engine: "pi",
			model: row.model ?? null,
			modelProvider: row.model_provider ?? null,
			thinkingLevel: row.thinking_level ?? null,
			hasHistory: !!row.has_history,
			createdAt: Number(row.created_at),
			updatedAt: Number(row.updated_at),
		};
	}

	list(): SessionMeta[] {
		const rows = this.opts.db.all("SELECT * FROM sessions ORDER BY updated_at DESC");
		return rows.map((r) => this.rowToMeta(r));
	}

	get(id: string): SessionRuntime | undefined {
		return this.runtimes.get(id);
	}

	/** Load a session that exists in the DB into the runtime map (no spawn). */
	load(id: string): SessionRuntime {
		let rt = this.runtimes.get(id);
		if (rt) return rt;
		const row = this.opts.db.get("SELECT * FROM sessions WHERE id = ?", id);
		if (!row) throw new Error(`Session not found: ${id}`);
		rt = {
			meta: this.rowToMeta(row),
			bridge: null,
			workspaceDir: join(this.opts.config.workspacesDir, id),
			stopping: false,
		};
		this.runtimes.set(id, rt);
		return rt;
	}

	workspaceDir(id: string): string {
		return join(this.opts.config.workspacesDir, id);
	}

	// ------------------------------------------------------------ lifecycle

	async createSession(name?: string): Promise<SessionMeta> {
		const id = randomUUID();
		const workspaceDir = this.workspaceDir(id);
		mkdirSync(workspaceDir, { recursive: true });
		const now = Date.now();
		this.opts.db.run(
			"INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			id, name?.trim() || "新会话", "starting", now, now,
		);
		const rt: SessionRuntime = {
			meta: {
				id, name: name?.trim() || "新会话", status: "starting", engine: "pi",
				model: null, modelProvider: null, thinkingLevel: null,
				hasHistory: false, createdAt: now, updatedAt: now,
			},
			bridge: null,
			workspaceDir,
			stopping: false,
		};
		this.runtimes.set(id, rt);
		// 非阻塞拉起:立即返回 starting,就绪/崩溃通过 lifecycle 广播。
		// pi 冷启动受全局扩展加载影响可达 ~10s,不能让 REST 请求同步等待卡住 UI。
		void this.spawn(rt).catch((err) => {
			this.setStatus(rt, "crashed", err instanceof Error ? err.message : String(err));
		});
		return rt.meta;
	}

	/**
	 * Spawn the pi RPC child for a session.
	 * Loads user's global agent config by default; MCP bridge extension is
	 * appended when enabled MCP servers exist.
	 */
	async spawn(rt: SessionRuntime): Promise<void> {
		if (rt.bridge?.isRunning) return;
		const { config, db } = this.opts;
		rt.stopping = false;

		const extraExtensions = this.getSetting<string[]>("extraExtensions", []);
		const args = [
			config.cliPath, "--mode", "rpc",
			"--session-dir", config.sessionsDir,
			"--session-id", rt.meta.id,
			"--name", rt.meta.name,
			"--approve",
		];
		for (const ext of extraExtensions) {
			if (typeof ext === "string" && ext.trim()) args.push("--extension", ext.trim());
		}
		const mcpConfig = writeMcpConfigIfNeeded(config, db);
		if (mcpConfig) {
			const bridgeExt = join(config.extensionsDir, "mcp-bridge.ts");
			if (existsSync(bridgeExt)) args.push("--extension", bridgeExt);
		}

		const env: Record<string, string | undefined> = {};
		if (mcpConfig) env.PI_MCP_CONFIG = JSON.stringify(mcpConfig);

		const bridge = this.opts.spawnBridge
			? this.opts.spawnBridge({
					cliPath: config.cliPath, args, cwd: rt.workspaceDir, env,
					onEvent: (msg) => this.onEventInternal(rt.meta.id, msg),
					onStderr: (line) => this.broadcast(rt.meta.id, { type: "stderr", text: line }),
					onExit: (code, signal, stderrTail) => this.onChildExit(rt, code, signal, stderrTail),
				})
			: new RpcBridge(
					{ cliPath: config.cliPath, args, cwd: rt.workspaceDir, env,
						onEvent: (msg) => this.onEventInternal(rt.meta.id, msg),
						onStderr: (line) => this.broadcast(rt.meta.id, { type: "stderr", text: line }),
						onExit: (code, signal, stderrTail) => this.onChildExit(rt, code, signal, stderrTail),
					},
					rt.meta.id, rt.workspaceDir,
				);
		rt.bridge = bridge;
		this.setStatus(rt, "starting");
		bridge.start();

		// Readiness: get_state roundtrip.
		try {
			const resp = await bridge.request<any>("get_state", {}, RPC_TIMEOUT_MS);
			if (resp.success) {
				this.applyStateToMeta(rt, resp.data);
				this.setStatus(rt, "running");
			} else {
				this.setStatus(rt, "crashed", resp.error);
			}
		} catch (err) {
			// If the process already exited, onChildExit will set crashed.
			if (rt.bridge === bridge && bridge.isRunning) {
				this.setStatus(rt, "crashed", err instanceof Error ? err.message : String(err));
			}
		}
	}

	private applyStateToMeta(rt: SessionRuntime, state: any): void {
		if (!state) return;
		const model = state.model as { id?: string; provider?: string } | undefined;
		if (model?.id) {
			rt.meta.model = model.id;
			rt.meta.modelProvider = model.provider ?? null;
		}
		rt.meta.thinkingLevel = state.thinkingLevel ?? rt.meta.thinkingLevel;
		this.opts.db.run(
			"UPDATE sessions SET model = ?, model_provider = ?, thinking_level = ? WHERE id = ?",
			rt.meta.model, rt.meta.modelProvider, rt.meta.thinkingLevel, rt.meta.id,
		);
	}

	private onChildExit(rt: SessionRuntime, code: number | null, _signal: string | null, stderrTail: string[]): void {
		rt.bridge = null;
		if (rt.stopping) {
			this.setStatus(rt, "stopped");
			return;
		}
		const tail = stderrTail.slice(-8).join("\n");
		this.setStatus(rt, "crashed", tail || `进程退出 (code=${code})`);
	}

	async stopSession(id: string): Promise<void> {
		const rt = this.load(id);
		rt.stopping = true;
		if (rt.bridge?.isRunning) await rt.bridge.stop();
		else this.setStatus(rt, "stopped");
	}

	async restartSession(id: string): Promise<SessionMeta> {
		const rt = this.load(id);
		if (rt.bridge?.isRunning) await rt.bridge.stop();
		rt.stopping = false;
		await this.spawn(rt);
		return rt.meta;
	}

	/** Delete DB row + workspace; the JSONL session file is kept. */
	async deleteSession(id: string): Promise<void> {
		const rt = this.load(id);
		if (rt.bridge?.isRunning) await rt.bridge.stop();
		this.runtimes.delete(id);
		this.opts.db.run("DELETE FROM sessions WHERE id = ?", id);
		this.opts.db.run("DELETE FROM artifacts WHERE session_id = ?", id);
		try {
			rmSync(rt.workspaceDir, { recursive: true, force: true });
		} catch {
			/* best effort */
		}
	}

	/** Ensure a session is running (auto-start stopped sessions, wait for starting). */
	async ensureRunning(id: string, timeoutMs = 60_000): Promise<SessionRuntime> {
		const rt = this.load(id);
		if (rt.bridge?.isRunning && rt.meta.status === "running") return rt;
		if (rt.meta.status === "starting") {
			return this.waitForRunning(rt, timeoutMs);
		}
		if (rt.meta.status === "crashed") {
			throw new Error("会话已崩溃，请先点击「重新拉起」");
		}
		await this.spawn(rt);
		if (rt.meta.status !== "running") {
			return this.waitForRunning(rt, timeoutMs);
		}
		return rt;
	}

	/** Poll until the runtime reaches running (or crashed / timeout). */
	private async waitForRunning(rt: SessionRuntime, timeoutMs: number): Promise<SessionRuntime> {
		const deadline = Date.now() + timeoutMs;
		while (Date.now() < deadline) {
			if (rt.meta.status === "running" && rt.bridge?.isRunning) return rt;
			if (rt.meta.status === "crashed") {
				throw new Error(rt.meta.lastError ? `会话启动失败：${rt.meta.lastError}` : "会话已崩溃");
			}
			if (rt.meta.status === "stopped") {
				await this.spawn(rt);
			}
			await new Promise((r) => setTimeout(r, 500));
		}
		throw new Error("会话启动超时");
	}

	/** Restore DB sessions after gateway boot; nothing is auto-spawned. */
	restore(): void {
		for (const row of this.opts.db.all("SELECT * FROM sessions")) {
			const rt = this.load(row.id);
			const hasHistory = existsSync(join(this.opts.config.sessionsDir, `${row.id}.jsonl`));
			rt.meta.hasHistory = hasHistory;
			rt.meta.status = "stopped";
			this.opts.db.run(
				"UPDATE sessions SET status = 'stopped', has_history = ? WHERE id = ?",
				hasHistory ? 1 : 0, row.id,
			);
		}
	}

	// ------------------------------------------------------------- commands

	/** Send an RPC command to a session's bridge (auto-starting it). */
	async command(id: string, cmd: Record<string, unknown>): Promise<any> {
		const rt = await this.ensureRunning(id);
		const bridge = rt.bridge!;
		const slow = typeof cmd.type === "string" && SLOW_COMMANDS.has(cmd.type);
		const resp = await bridge.send(cmd as any, slow ? SLOW_TIMEOUT_MS : RPC_TIMEOUT_MS);
		if (cmd.type === "set_model" && resp.success) {
			await this.refreshState(rt);
		}
		if (cmd.type === "set_session_name" && resp.success) {
			rt.meta.name = String(cmd.name ?? "");
			this.opts.db.run("UPDATE sessions SET name = ?, updated_at = ? WHERE id = ?", rt.meta.name, Date.now(), id);
			this.broadcast(id, { type: "session_meta", meta: rt.meta });
		}
		return resp;
	}

	async refreshState(rt: SessionRuntime): Promise<void> {
		if (!rt.bridge?.isRunning) return;
		const resp = await rt.bridge.request<any>("get_state", {}, RPC_TIMEOUT_MS).catch(() => null);
		if (resp?.success) this.applyStateToMeta(rt, resp.data);
	}

	/** Slash commands from the first running session, else empty. */
	async getCommands(): Promise<{ commands: any[]; stale: boolean }> {
		for (const rt of this.runtimes.values()) {
			if (rt.bridge?.isRunning) {
				const resp = await rt.bridge
					.request<any>("get_commands", {}, RPC_TIMEOUT_MS)
					.catch(() => null);
				if (resp?.success) return { commands: resp.data?.commands ?? [], stale: false };
			}
		}
		return { commands: [], stale: true };
	}

	// -------------------------------------------------------------- events

	private handleEvent(sessionId: string, msg: BridgeMessage): void {
		if (msg.type === "extension_ui_request") {
			this.broadcast(sessionId, { type: "ui_request", request: msg });
			return;
		}
		const rt = this.runtimes.get(sessionId);
		const artifact = trackToolEvent(this.opts.db, rt?.workspaceDir ?? this.workspaceDir(sessionId), sessionId, msg);
		if (artifact) this.broadcast(sessionId, { type: "artifact", artifact });
		this.broadcast(sessionId, { type: "event", event: msg });
	}

	private setStatus(rt: SessionRuntime, status: SessionStatus, lastError?: string): void {
		rt.meta.status = status;
		if (lastError !== undefined) rt.meta.lastError = lastError;
		this.opts.db.run(
			"UPDATE sessions SET status = ?, updated_at = ? WHERE id = ?",
			status, Date.now(), rt.meta.id,
		);
		this.broadcast(rt.meta.id, { type: "lifecycle", status, lastError });
	}

	// -------------------------------------------------------------- settings

	getSetting<T>(key: string, fallback: T): T {
		const row = this.opts.db.get("SELECT value FROM settings WHERE key = ?", key);
		if (!row) return fallback;
		try {
			return JSON.parse(row.value) as T;
		} catch {
			return fallback;
		}
	}

	setSetting(key: string, value: unknown): void {
		this.opts.db.run(
			"INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
			key, JSON.stringify(value),
		);
	}

	allSettings(): Record<string, unknown> {
		const out: Record<string, unknown> = {};
		for (const row of this.opts.db.all("SELECT key, value FROM settings")) {
			try {
				out[row.key] = JSON.parse(row.value);
			} catch {
				out[row.key] = row.value;
			}
		}
		return out;
	}
}

/** Check whether the session has a JSONL history file. */
export function sessionHasHistory(sessionsDir: string, id: string): boolean {
	return existsSync(join(sessionsDir, `${id}.jsonl`));
}

/** List JSONL files in the sessions dir (crash recovery scan). */
export function listSessionFiles(sessionsDir: string): string[] {
	if (!existsSync(sessionsDir)) return [];
	return readdirSync(sessionsDir).filter((f) => f.endsWith(".jsonl"));
}
