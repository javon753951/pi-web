import { describe, it, expect, vi, beforeEach } from "vitest";
import { openDb, migrate } from "../src/db.js";
import { SessionManager } from "../src/session-manager.js";
import type { BridgeMessage } from "../src/rpc-bridge.js";

/** Fake bridge standing in for a pi child process. */
function makeFakeBridge(handlers: {
	onEvent?: (m: BridgeMessage) => void;
	onExit?: (code: number | null, signal: string | null, stderr: string[]) => void;
}) {
	const callbacks: any = {};
	return {
		isRunning: true,
		start: vi.fn(),
		send: vi.fn(async (cmd: any) => {
			if (cmd.type === "get_state") {
				return {
					id: cmd.id,
					type: "response",
					command: "get_state",
					success: true,
					data: { model: { id: "deepseek-v4-flash", provider: "deepseek" }, thinkingLevel: "high" },
				};
			}
			return { id: cmd.id, type: "response", command: cmd.type, success: true };
		}),
		request: vi.fn(async (cmd: any) => ({
			id: cmd.id,
			type: "response",
			command: cmd.type,
			success: true,
			data: { model: { id: "deepseek-v4-flash", provider: "deepseek" }, thinkingLevel: "high" },
		})),
		sendUiResponse: vi.fn(),
		kill: vi.fn(),
		stop: vi.fn(async () => {
			handlers.onExit?.(0, null, []);
		}),
		_handlers: handlers,
	};
}

function makeManager() {
	const db = openDb(":memory:");
	migrate(db);
	const broadcasts: unknown[] = [];
	const sm = new SessionManager({
		config: {
			cliPath: "pi", sessionsDir: "/tmp/sessions", workspacesDir: "/tmp/workspaces",
			agentDir: "/tmp/agent", dataDir: "/tmp/data", mcpDir: "/tmp/mcp",
			extensionsDir: "/tmp/ext", webDistDir: "/tmp/dist", token: "t", port: 1, host: "x",
		} as any,
		db,
		broadcast: (id, msg) => broadcasts.push({ id, msg }),
		spawnBridge: (opts) => makeFakeBridge({
			onEvent: opts.onEvent,
			onExit: opts.onExit,
		}) as any,
	});
	return { db, sm, broadcasts };
}

describe("SessionManager lifecycle", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("creates a session and transitions starting → running", async () => {
		const { sm, db } = makeManager();
		const meta = await sm.createSession("测试会话");
		expect(meta.id).toBeTruthy();
		expect(meta.name).toBe("测试会话");
		// 非阻塞:createSession 立即返回(不等待 spawn 就绪),后台拉起后转 running。
		// 真实场景下返回时必为 starting;fake bridge 微任务即时就绪,故此处不锁死中间态。
		await vi.waitFor(() => {
			expect(sm.get(meta.id)!.meta.status).toBe("running");
		});
		expect(meta.model).toBe("deepseek-v4-flash");
		const row = db.get("SELECT status FROM sessions WHERE id = ?", meta.id);
		expect(row.status).toBe("running");
	});

	it("restore() marks sessions stopped", async () => {
		const { sm, db } = makeManager();
		const meta = await sm.createSession("x");
		// simulate gateway restart: new manager over same db
		const sm2 = new SessionManager({
			config: sm.config as any,
			db,
			broadcast: () => {},
			spawnBridge: (opts) => makeFakeBridge({ onEvent: opts.onEvent, onExit: opts.onExit }) as any,
		});
		sm2.restore();
		expect(sm2.list()[0]!.status).toBe("stopped");
	});

	it("crash exit → status crashed with stderr tail", async () => {
		const { sm, broadcasts } = makeManager();
		const meta = await sm.createSession("x");
		const rt = sm.get(meta.id)!;
		const fake = rt.bridge as any;
		fake._handlers.onExit(1, null, ["Error: boom", "at line 3"]);
		expect(sm.get(meta.id)!.meta.status).toBe("crashed");
		const lifecycle = [...broadcasts].reverse().find((b: any) => b.msg.type === "lifecycle");
		expect(lifecycle.msg.status).toBe("crashed");
		expect(sm.get(meta.id)!.meta.lastError).toContain("boom");
	});

	it("stopSession → stopped, no crash broadcast", async () => {
		const { sm } = makeManager();
		const meta = await sm.createSession("x");
		await sm.stopSession(meta.id);
		expect(sm.get(meta.id)!.meta.status).toBe("stopped");
	});

	it("deleteSession removes row and runtime", async () => {
		const { sm, db } = makeManager();
		const meta = await sm.createSession("x");
		await sm.deleteSession(meta.id);
		expect(db.get("SELECT * FROM sessions WHERE id = ?", meta.id)).toBeUndefined();
	});

	it("rpc command passthrough correlates response", async () => {
		const { sm } = makeManager();
		const meta = await sm.createSession("x");
		const resp = await sm.command(meta.id, { type: "set_thinking_level", level: "low" });
		expect(resp.success).toBe(true);
		expect(resp.command).toBe("set_thinking_level");
	});

	it("ensureRunning refuses to auto-restart crashed sessions", async () => {
		const { sm } = makeManager();
		const meta = await sm.createSession("x");
		const rt = sm.get(meta.id)!;
		(rt.bridge as any)._handlers.onExit(1, null, ["boom"]);
		await expect(sm.ensureRunning(meta.id)).rejects.toThrow(/重新拉起/);
	});
});
