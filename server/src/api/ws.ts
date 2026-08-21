import type { FastifyInstance } from "fastify";
import type { SessionManager } from "../session-manager.js";
import { RPC_COMMAND_TYPES } from "../session-manager.js";
import { listArtifacts } from "../artifacts.js";
import type { Db } from "../db.js";
import type { AppConfig } from "../config.js";

export interface WsDeps {
	config: AppConfig;
	db: Db;
	sessions: SessionManager;
}

interface WsClient {
	sessionId: string;
	send: (msg: unknown) => void;
}

/**
 * WS 协议（前端 lib/ws.ts 对应实现）：
 *
 * 上行：
 *   {type:"sync"}                                          → 快照（state+messages+session+artifacts）
 *   {type:"ui_response", ...}                              → 透传 extension_ui_response
 *   RPC 命令对象（type 在 RPC_COMMAND_TYPES 中）           → 透传子进程 stdin
 *
 * 下行：
 *   {type:"event", event}       RPC 事件透传
 *   {type:"response", ...}      RPC 命令响应
 *   {type:"lifecycle", status}  会话生命周期
 *   {type:"artifact", artifact} 产物入库广播
 *   {type:"ui_request", request}扩展 UI 请求
 *   {type:"stderr", text}       子进程 stderr（调试）
 *   {type:"error", error}
 */
export function registerWs(app: FastifyInstance, deps: WsDeps): void {
	const { sessions } = deps;

	const clients = new Map<string, Set<WsClient>>(); // sessionId → clients

	sessions.broadcast = (sessionId, msg) => {
		const set = clients.get(sessionId);
		if (!set) return;
		const text = JSON.stringify({ ...(msg as object), sessionId });
		for (const c of set) {
			try {
				c.send(text);
			} catch {
				/* client gone */
			}
		}
	};

	app.get("/ws", { websocket: true }, (socket, req) => {
		const sessionId = (req.query as Record<string, string>)?.session;
		if (!sessionId) {
			socket.close(4000, "missing session");
			return;
		}
		let rt;
		try {
			rt = sessions.load(sessionId);
		} catch {
			socket.close(4004, "session not found");
			return;
		}

		const client: WsClient = {
			sessionId,
			send: (msg) => {
				if (socket.readyState !== 1) return;
				socket.send(typeof msg === "string" ? msg : JSON.stringify(msg));
			},
		};
		let set = clients.get(sessionId);
		if (!set) {
			set = new Set();
			clients.set(sessionId, set);
		}
		set.add(client);

		const send = (msg: unknown) => client.send(msg);

		// Auto-start stopped sessions on connect.
		if (rt.meta.status === "stopped" && rt.meta.hasHistory) {
			void sessions.spawn(rt).catch((err) => {
				send({ type: "lifecycle", status: "crashed", lastError: err instanceof Error ? err.message : String(err) });
			});
		}

		socket.on("message", (raw: Buffer) => {
			let msg: any;
			try {
				msg = JSON.parse(String(raw));
			} catch {
				send({ type: "error", error: "invalid JSON" });
				return;
			}
			if (!msg || typeof msg !== "object") return;
			void handleClientMessage(msg, sessionId, send);
		});

		socket.on("close", () => {
			set.delete(client);
			if (set.size === 0) clients.delete(sessionId);
		});

		async function handleClientMessage(msg: any, sessionId: string, send: (m: unknown) => void): Promise<void> {
			try {
				if (msg.type === "sync") {
					await sendSync(sessionId, send);
					return;
				}
				if (msg.type === "ui_response") {
					const rt2 = sessions.get(sessionId);
					rt2?.bridge?.sendUiResponse(msg);
					return;
				}
				if (typeof msg.type === "string" && RPC_COMMAND_TYPES.has(msg.type)) {
					const resp = await sessions.command(sessionId, msg);
					send({ type: "response", ...resp, sessionId });
					return;
				}
				send({ type: "error", error: `unknown message type: ${String(msg.type)}` });
			} catch (err) {
				send({ type: "error", error: err instanceof Error ? err.message : String(err) });
			}
		}

		async function sendSync(sessionId: string, send: (m: unknown) => void): Promise<void> {
			const rt2 = sessions.get(sessionId);
			const meta = rt2?.meta ?? sessions.list().find((s) => s.id === sessionId);
			let state: unknown = null;
			let messages: unknown = null;
			if (rt2?.bridge?.isRunning) {
				const [sResp, mResp] = await Promise.all([
					rt2.bridge.request<any>("get_state", {}, 30_000).catch(() => null),
					rt2.bridge.request<any>("get_messages", {}, 30_000).catch(() => null),
				]);
				if (sResp?.success) {
					state = sResp.data;
					rt2.meta.model = sResp.data?.model?.id ?? rt2.meta.model;
					rt2.meta.modelProvider = sResp.data?.model?.provider ?? rt2.meta.modelProvider;
					rt2.meta.thinkingLevel = sResp.data?.thinkingLevel ?? rt2.meta.thinkingLevel;
				}
				if (mResp?.success) messages = mResp.data?.messages ?? null;
			}
			send({
				type: "sync",
				session: meta,
				state,
				messages,
				artifacts: listArtifacts(deps.db, sessionId),
			});
		}
	});
}
