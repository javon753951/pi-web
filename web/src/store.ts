import { create } from "zustand";
import { api } from "./lib/api";
import { SessionSocket } from "./lib/ws";
import { notifySession, setNotifyHooks } from "./lib/notify";
import { applyEventToItems, makeOptimisticUser, makeWaitingPlaceholder, syncToItems } from "./lib/reducer";
import type {
	Artifact,
	ChatItem,
	ModelInfo,
	ProviderAuth,
	SessionMeta,
	ToolCallView,
	WsIncoming,
} from "./lib/types";

interface AppState {
	token: string;
	connected: boolean;
	sessions: SessionMeta[];
	currentSessionId: string | null;
	status: Record<string, string>;
	lastError: Record<string, string | undefined>;
	messages: Record<string, ChatItem[]>;
	artifacts: Record<string, Artifact[]>;
	models: ModelInfo[];
	providers: ProviderAuth[];
	settings: Record<string, unknown>;
	socket: SessionSocket;
	uiRequests: Record<string, unknown>;
	pendingPrompt: { text: string; at: number } | null;
	/** 工作区文件版本号：上传/删除后 +1，右栏据此刷新文件树。 */
	workspaceVersion: number;

	// actions
	bootstrap: () => Promise<void>;
	refreshSessions: () => Promise<void>;
	refreshModels: () => Promise<void>;
	refreshSettings: () => Promise<void>;
	createSession: (name?: string) => Promise<SessionMeta | null>;
	deleteSession: (id: string) => Promise<void>;
	restartSession: (id: string) => Promise<void>;
	selectSession: (id: string) => void;
	refreshArtifacts: (id: string) => Promise<void>;
	handleWsMessage: (msg: WsIncoming) => void;
	applyEvent: (sessionId: string | null, event: any) => void;
	sendRpc: (cmd: Record<string, unknown>) => void;
	sendPrompt: (text: string, opts?: { model?: string; thinking?: string }) => void;
	respondUi: (msg: Record<string, unknown>) => void;
	setCurrentSession: (id: string | null) => void;
	updateSessionMeta: (meta: SessionMeta) => void;
	bumpWorkspace: () => void;
}

export const useApp = create<AppState>()((set, get) => ({
	token: "",
	connected: false,
	sessions: [],
	currentSessionId: null,
	status: {},
	lastError: {},
	messages: {},
	artifacts: {},
	models: [],
	providers: [],
	settings: {},
	socket: new SessionSocket(),
	uiRequests: {},
	pendingPrompt: null,
	workspaceVersion: 0,

	bootstrap: async () => {
		const socket = get().socket;
		socket.onMessage = (msg) => get().handleWsMessage(msg);
		socket.onStatus = (connected) => set({ connected });
		setNotifyHooks({ onActivate: (sid) => get().selectSession(sid) });
		await Promise.all([get().refreshSessions(), get().refreshModels(), get().refreshSettings()]);
		const sessions = get().sessions;
		const current = get().currentSessionId ?? sessions[0]?.id ?? null;
		if (current) {
			set({ currentSessionId: current });
			socket.connect(current);
		}
	},

	refreshSessions: async () => {
		try {
			const data = await api.get<{ sessions: SessionMeta[] }>("/api/sessions");
			set({ sessions: data.sessions });
			// 同步状态映射
			const status: Record<string, string> = {};
			const lastError: Record<string, string | undefined> = {};
			for (const s of data.sessions) {
				status[s.id] = s.status;
				if (s.lastError) lastError[s.id] = s.lastError;
			}
			set({ status, lastError });
		} catch {
			/* 未认证或网关未启动 */
		}
	},

	refreshModels: async () => {
		try {
			const data = await api.get<{ models: ModelInfo[]; providers: ProviderAuth[]; defaultModel: string }>("/api/models");
			set({ models: data.models, providers: data.providers });
		} catch {
			/* ignore */
		}
	},

	refreshSettings: async () => {
		try {
			const data = await api.get<{ settings: Record<string, unknown> }>("/api/settings");
			set({ settings: data.settings });
		} catch {
			/* ignore */
		}
	},

	createSession: async (name) => {
		try {
			const data = await api.post<{ session: SessionMeta }>("/api/sessions", { name });
			await get().refreshSessions();
			get().selectSession(data.session.id);
			return data.session;
		} catch (err) {
			console.error(err);
			return null;
		}
	},

	deleteSession: async (id) => {
		await api.del(`/api/sessions/${id}`);
		if (get().currentSessionId === id) {
			get().socket.close();
			set({ currentSessionId: null });
		}
		await get().refreshSessions();
	},

	restartSession: async (id) => {
		await api.post(`/api/sessions/${id}/restart`);
		await get().refreshSessions();
	},

	selectSession: (id) => {
		if (get().currentSessionId === id) return;
		set({ currentSessionId: id });
		get().socket.connect(id);
		void get().refreshArtifacts(id);
	},

	refreshArtifacts: async (id) => {
		try {
			const data = await api.get<{ artifacts: Artifact[] }>(`/api/sessions/${id}/artifacts`);
			set((s) => ({ artifacts: { ...s.artifacts, [id]: data.artifacts } }));
		} catch {
			/* ignore */
		}
	},

	sendRpc: (cmd) => {
		get().socket.command(cmd);
	},

	sendPrompt: (text, opts) => {
		const { currentSessionId } = get();
		if (!currentSessionId) return;
		set((s) => ({
			pendingPrompt: { text, at: Date.now() },
			messages: {
				...s.messages,
				[currentSessionId]: [...(s.messages[currentSessionId] ?? []), makeOptimisticUser(text), makeWaitingPlaceholder()],
			},
		}));
		const cmd: Record<string, unknown> = { type: "prompt", message: text };
		get().socket.command(cmd);
		if (opts?.thinking) get().socket.command({ type: "set_thinking_level", level: opts.thinking });
	},

	respondUi: (msg) => {
		get().socket.send({ type: "ui_response", ...msg });
	},

	setCurrentSession: (id) => set({ currentSessionId: id }),
	updateSessionMeta: (meta) => {
		set((s) => ({
			sessions: s.sessions.map((x) => (x.id === meta.id ? { ...x, ...meta } : x)),
			status: { ...s.status, [meta.id]: meta.status },
		}));
	},

	handleWsMessage: (msg) => {
		switch (msg.type) {
			case "lifecycle": {
				const sid = msg.sessionId;
				set((s) => ({
					status: { ...s.status, [sid]: msg.status },
					lastError: { ...s.lastError, [sid]: msg.lastError },
				}));
				if (msg.status === "crashed") {
					notifySession(sid, get().sessions.find((s) => s.id === sid)?.name, "crashed");
				}
				break;
			}
			case "session_meta": {
				get().updateSessionMeta(msg.meta);
				break;
			}
			case "artifact": {
				const sid = msg.sessionId ?? get().currentSessionId;
				if (!sid) break;
				set((s) => ({
					artifacts: {
						...s.artifacts,
						[sid]: [msg.artifact, ...(s.artifacts[sid] ?? []).filter((a) => a.path !== msg.artifact.path)],
					},
				}));
				break;
			}
			case "ui_request": {
				set((s) => ({ uiRequests: { ...s.uiRequests, [msg.request.id]: msg.request } }));
				const sid = msg.sessionId ?? get().currentSessionId;
				if (sid) notifySession(sid, get().sessions.find((s) => s.id === sid)?.name, "ui_request");
				break;
			}
			case "sync": {
				set((s) => ({
					sessions: s.sessions.map((x) => (x.id === msg.session.id ? { ...x, ...msg.session } : x)),
					status: { ...s.status, [msg.session.id]: msg.session.status },
					messages: { ...s.messages, [msg.session.id]: syncToItems(msg.messages) },
					artifacts: { ...s.artifacts, [msg.session.id]: msg.artifacts },
					pendingPrompt: null,
				}));
				break;
			}
			case "event": {
				const ev = msg.event as any;
				if (ev?.type === "message_start" && ev.message?.role === "user") {
					set({ pendingPrompt: null });
				}
				get().applyEvent(msg.sessionId ?? get().currentSessionId, ev);
				break;
			}
			default:
				break;
		}
	},

	applyEvent: (sessionId: string | null, event: any) => {
		if (!sessionId) return;
		let ended = false;
		set((s) => {
			const items = applyEventToItems(s.messages[sessionId] ?? [], event);
			// 流式 true→false 跳变 = 一轮回答收尾，是「任务完成」的通知时机
			const streaming = items.at(-1)?.streaming ?? false;
			if (wasStreaming.get(sessionId) === true && !streaming) ended = true;
			wasStreaming.set(sessionId, streaming);
			return { messages: { ...s.messages, [sessionId]: items } };
		});
		if (ended) {
			notifySession(sessionId, get().sessions.find((s) => s.id === sessionId)?.name, "done");
		}
	},

	bumpWorkspace: () => set((s) => ({ workspaceVersion: s.workspaceVersion + 1 })),
}));

/** 每会话上一帧的流式状态（通知检测用，非响应式）。 */
const wasStreaming = new Map<string, boolean>();

function getCurrent(s: AppState): string {
	return s.currentSessionId ?? "";
}
