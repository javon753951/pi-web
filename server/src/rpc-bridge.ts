import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createJsonlParser } from "./jsonl.js";
import { resolveSpawnCommand } from "./config.js";

export interface RpcEvent {
	type: string;
	[key: string]: unknown;
}

export interface RpcResponse {
	type: "response";
	id?: string;
	command: string;
	success: boolean;
	data?: any;
	error?: string;
}

export interface RpcUiRequest {
	type: "extension_ui_request";
	id: string;
	method: string;
	[key: string]: unknown;
}

export type BridgeMessage = RpcResponse | RpcUiRequest | RpcEvent;

export interface BridgeOptions {
	cliPath: string;
	args: string[];
	cwd: string;
	env?: Record<string, string | undefined>;
	onEvent?: (msg: BridgeMessage) => void;
	onStderr?: (line: string) => void;
	onExit?: (code: number | null, signal: string | null, stderrTail: string[]) => void;
}

const STDOUT_TIMEOUT_MS = 30_000;

/**
 * One `pi --mode rpc` child process.
 *
 * - stdout: strict JSONL (see jsonl.ts). Responses correlate by `id`;
 *   anything else is forwarded as an event / UI request.
 * - stdin: commands serialized as JSON lines (LF only).
 * - stderr: captured into a ring buffer (crash diagnostics), never parsed.
 * - process tree kill: taskkill /T on Windows, process-group signal on POSIX.
 */
export class RpcBridge {
	private proc: ChildProcess | null = null;
	private pending = new Map<string, { resolve: (r: RpcResponse) => void; timer: NodeJS.Timeout }>();
	private stderrTail: string[] = [];
	private argsByToolCallId = new Map<string, { toolName: string; args: any }>();
	private stoppedByUs = false;
	private ready: Promise<void>;
	private resolveReady!: () => void;
	private idCounter = 0;
	readonly sessionId: string;
	readonly workspaceDir: string;

	constructor(
		private opts: BridgeOptions,
		sessionId: string,
		workspaceDir: string,
	) {
		this.sessionId = sessionId;
		this.workspaceDir = workspaceDir;
		this.ready = new Promise((resolve) => {
			this.resolveReady = resolve;
		});
	}

	start(): void {
		const [command, ...preArgs] = resolveSpawnCommand(this.opts.cliPath);
		const child = spawn(command, [...preArgs, ...this.opts.args], {
			cwd: this.opts.cwd,
			env: { ...process.env, ...this.opts.env },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
			detached: process.platform !== "win32",
		});
		this.proc = child;

		const parser = createJsonlParser((line) => this.onLine(line));
		child.stdout!.on("data", (chunk: Buffer) => parser.write(chunk));
		child.stdout!.on("end", () => parser.end());

		child.stderr!.on("data", (chunk: Buffer) => {
			for (const line of chunk.toString("utf8").split("\n")) {
				if (!line.trim()) continue;
				this.stderrTail.push(line);
				if (this.stderrTail.length > 200) this.stderrTail.shift();
				this.opts.onStderr?.(line);
			}
		});

		child.on("error", (err) => {
			this.stderrTail.push(`[spawn error] ${err.message}`);
			this.opts.onStderr?.(`[spawn error] ${err.message}`);
			this.failAllPending(err.message);
		});

		child.on("exit", (code, signal) => {
			this.failAllPending(`process exited (code=${code}${signal ? `, signal=${signal}` : ""})`);
			this.opts.onExit?.(code, signal, this.stderrTail.slice());
			this.proc = null;
		});
	}

	private onLine(line: string): void {
		let msg: any;
		try {
			msg = JSON.parse(line);
		} catch {
			this.opts.onStderr?.(`[non-JSON stdout] ${line.slice(0, 200)}`);
			return;
		}
		if (!msg || typeof msg !== "object") return;

		if (msg.type === "response") {
			const r = msg as RpcResponse;
			if (r.id && this.pending.has(r.id)) {
				const p = this.pending.get(r.id)!;
				clearTimeout(p.timer);
				this.pending.delete(r.id);
				p.resolve(r);
			} else {
				this.opts.onEvent?.(r);
			}
			return;
		}

		// Track tool args so artifact tracking can extract paths on tool_execution_end.
		if (msg.type === "tool_execution_start") {
			this.argsByToolCallId.set(String(msg.toolCallId), {
				toolName: String(msg.toolName),
				args: msg.args,
			});
		} else if (msg.type === "tool_execution_end") {
			const info = this.argsByToolCallId.get(String(msg.toolCallId));
			if (info) msg._args = info.args;
			this.argsByToolCallId.delete(String(msg.toolCallId));
		}

		this.opts.onEvent?.(msg as BridgeMessage);
	}

	/** Send a command; resolves with the correlated response. */
	send<T extends RpcResponse = RpcResponse>(cmd: Record<string, unknown>, timeoutMs = STDOUT_TIMEOUT_MS): Promise<T> {
		return new Promise((resolve, reject) => {
			if (!this.proc || this.proc.exitCode !== null) {
				reject(new Error("RPC process is not running"));
				return;
			}
			const id = cmd.id !== undefined ? String(cmd.id) : `gw${++this.idCounter}`;
			const payload = { ...cmd, id };
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`RPC command "${String(cmd.type)}" timed out after ${timeoutMs}ms`));
			}, timeoutMs);
			this.pending.set(id, { resolve: resolve as (r: RpcResponse) => void, timer });
			this.proc.stdin!.write(JSON.stringify(payload) + "\n", (err) => {
				if (err) {
					clearTimeout(timer);
					this.pending.delete(id);
					reject(err);
				}
			});
		});
	}

	/** Forward an extension UI response back into the child stdin. */
	sendUiResponse(msg: Record<string, unknown>): void {
		if (!this.proc || this.proc.exitCode !== null) return;
		this.proc.stdin!.write(JSON.stringify(msg) + "\n");
	}

	/** Convenience: correlated request without caller-supplied id. */
	request<T extends RpcResponse = RpcResponse>(
		type: string,
		extra: Record<string, unknown> = {},
		timeoutMs?: number,
	): Promise<T> {
		return this.send({ type, ...extra }, timeoutMs);
	}

	/** Resolves once the bridge has been started (not necessarily ready). */
	whenStarted(): Promise<void> {
		return this.ready;
	}

	markReady(): void {
		this.resolveReady();
	}

	async stop(): Promise<void> {
		this.stoppedByUs = true;
		this.kill();
		await new Promise((r) => setTimeout(r, 50));
	}

	get isRunning(): boolean {
		return !!this.proc && this.proc.exitCode === null;
	}

	get exitCode(): number | null {
		return this.proc?.exitCode ?? null;
	}

	get stderr(): string[] {
		return this.stderrTail.slice();
	}

	kill(): void {
		const proc = this.proc;
		if (!proc || proc.exitCode !== null) return;
		if (process.platform === "win32") {
			try {
				if (proc.pid !== undefined) {
					spawnSync("taskkill", ["/pid", String(proc.pid), "/T", "/F"], { stdio: "ignore" });
				}
			} catch {
				/* fall through to direct kill */
			}
			try {
				proc.kill();
			} catch {
				/* already dead */
			}
			return;
		}
		try {
			if (proc.pid !== undefined) process.kill(-proc.pid, "SIGTERM"); // process group (detached)
		} catch {
			try {
				proc.kill("SIGTERM");
			} catch {
				/* already dead */
			}
		}
		setTimeout(() => {
			try {
				if (proc.pid !== undefined) process.kill(-proc.pid, "SIGKILL");
			} catch {
				/* already gone */
			}
		}, 3000).unref();
	}

	private failAllPending(reason: string): void {
		for (const [id, p] of this.pending) {
			clearTimeout(p.timer);
			p.resolve({ type: "response", id, command: "?", success: false, error: reason } as RpcResponse);
		}
		this.pending.clear();
	}
}
