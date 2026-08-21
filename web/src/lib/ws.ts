import type { WsIncoming } from "./types";
import { getToken } from "./api";

type MessageHandler = (msg: WsIncoming) => void;
type StatusHandler = (connected: boolean) => void;

/**
 * 单会话 WS 客户端：自动重连（指数退避）、重连后自动 sync。
 * 切换会话时调用 connect(newId)。
 */
export class SessionSocket {
	private ws: WebSocket | null = null;
	private sessionId: string | null = null;
	private retry = 0;
	private closedByUs = false;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private syncTimer: ReturnType<typeof setTimeout> | null = null;

	onMessage: MessageHandler = () => {};
	onStatus: StatusHandler = () => {};

	get connected(): boolean {
		return this.ws?.readyState === WebSocket.OPEN;
	}

	connect(sessionId: string): void {
		if (this.sessionId === sessionId && this.connected) return;
		this.close();
		this.sessionId = sessionId;
		this.closedByUs = false;
		this.retry = 0;
		this.open();
	}

	private open(): void {
		if (!this.sessionId || this.closedByUs) return;
		const token = getToken();
		const proto = location.protocol === "https:" ? "wss" : "ws";
		const url = `${proto}://${location.host}/ws?session=${encodeURIComponent(this.sessionId)}&token=${encodeURIComponent(token)}`;
		try {
			const ws = new WebSocket(url);
			this.ws = ws;

			ws.onopen = () => {
				if (this.ws !== ws) return;
				this.retry = 0;
				this.onStatus(true);
				// 重连后请求快照
				this.syncTimer = setTimeout(() => this.send({ type: "sync" }), 100);
			};
			ws.onmessage = (e) => {
				// 僵尸套接字：已被 connect(新会话) 替换，事件一律丢弃。
				// 否则双连接会让每条流式事件应用两次（文本逐段成对重复）。
				if (this.ws !== ws) return;
				try {
					const msg = JSON.parse(String(e.data)) as WsIncoming;
					this.onMessage(msg);
				} catch {
					/* malformed frame — ignore */
				}
			};
			ws.onclose = () => {
				// 僵尸套接字静默退出：不广播断线、不触发重连
				if (this.ws !== ws) return;
				this.onStatus(false);
				if (!this.closedByUs && this.sessionId) {
					const delay = Math.min(15_000, 1000 * 2 ** this.retry);
					this.retry++;
					this.reconnectTimer = setTimeout(() => this.open(), delay);
				}
			};
			ws.onerror = () => {
				/* onclose follows */
			};
		} catch {
			/* retry via onclose won't fire — schedule manually */
			this.reconnectTimer = setTimeout(() => this.open(), 2000);
		}
	}

	send(msg: unknown): void {
		if (this.ws?.readyState === WebSocket.OPEN) {
			this.ws.send(JSON.stringify(msg));
		}
	}

	/** 发送 RPC 命令（透传）。 */
	command(cmd: Record<string, unknown>): void {
		this.send(cmd);
	}

	close(): void {
		this.closedByUs = true;
		if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
		if (this.syncTimer) clearTimeout(this.syncTimer);
		this.ws?.close();
		this.ws = null;
		this.onStatus(false);
	}
}
