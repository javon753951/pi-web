// 与网关共享的类型定义（REST + WS 协议）

export interface SessionMeta {
	id: string;
	name: string;
	status: "stopped" | "starting" | "running" | "crashed";
	engine: "pi";
	model: string | null;
	modelProvider: string | null;
	thinkingLevel: string | null;
	hasHistory: boolean;
	createdAt: number;
	updatedAt: number;
	lastError?: string;
}

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

export interface ProviderAuth {
	provider: string;
	configured: boolean;
	type?: string;
	keyPreview?: string;
}

export interface Artifact {
	id: number;
	sessionId: string;
	path: string;
	toolCallId: string | null;
	kind: "code" | "image" | "data" | "other";
	size: number | null;
	mtime: number | null;
	createdAt: number;
}

export interface TreeEntry {
	name: string;
	path: string;
	type: "dir" | "file";
	size: number | null;
}

export interface FilePreview {
	name: string;
	path: string;
	kind: "text" | "image" | "binary" | "notfound";
	content?: string;
	dataUrl?: string;
	size: number;
	truncated?: boolean;
}

export interface CatalogItem {
	name: string;
	spec: string | null;
	description: string;
	category: string;
	tags: string[];
	author: string;
	icon: string;
	experimental?: boolean;
}

export interface InstalledItem {
	name: string;
	source: "extension" | "skill" | "package";
	path: string;
	description?: string;
	piField?: Record<string, unknown>;
	version?: string;
}

export interface SearchHit {
	name: string;
	version: string;
	description: string;
	author?: string;
	keywords?: string[];
	piField?: Record<string, unknown>;
	hasPiField: boolean;
}

export interface McpServer {
	id: string;
	name: string;
	command: string;
	args: string;
	env: string;
	enabled: number;
	created_at: number;
}

// ---------------------------------------------------------------- WS 消息

export type WsIncoming =
	| { type: "event"; sessionId?: string; event: RpcEvent }
	| { type: "response"; sessionId?: string; id?: string; command: string; success: boolean; data?: any; error?: string }
	| { type: "lifecycle"; sessionId: string; status: string; lastError?: string }
	| { type: "artifact"; sessionId?: string; artifact: Artifact }
	| { type: "ui_request"; sessionId?: string; request: UiRequest }
	| { type: "stderr"; sessionId?: string; text: string }
	| { type: "error"; error: string }
	| { type: "sync"; session: SessionMeta; state: RpcState | null; messages: AgentMessage[] | null; artifacts: Artifact[] }
	| { type: "session_meta"; meta: SessionMeta };

export interface RpcState {
	model?: { id: string; provider?: string };
	thinkingLevel: string;
	isStreaming: boolean;
	sessionId: string;
	messageCount: number;
}

export interface UiRequest {
	type: "extension_ui_request";
	id: string;
	method: "select" | "confirm" | "input" | "editor" | "notify" | "setStatus" | "setWidget" | "setTitle";
	title?: string;
	message?: string;
	placeholder?: string;
	options?: string[];
	timeout?: number;
}

export type RpcEvent = {
	type: string;
	[key: string]: any;
} & (
	| { type: "message_update"; assistantMessageEvent?: AssistantDelta }
	| { type: "tool_execution_start"; toolCallId: string; toolName: string; args: any }
	| { type: "tool_execution_update"; toolCallId: string; toolName: string; partialResult: any }
	| { type: "tool_execution_end"; toolCallId: string; toolName: string; result: any; isError: boolean }
);

export type AssistantDelta =
	| { type: "start" }
	| { type: "text_start"; contentIndex: number }
	| { type: "text_delta"; contentIndex: number; delta: string }
	| { type: "text_end"; contentIndex: number }
	| { type: "thinking_start"; contentIndex: number }
	| { type: "thinking_delta"; contentIndex: number; delta: string }
	| { type: "thinking_end"; contentIndex: number }
	| { type: "toolcall_start"; contentIndex: number }
	| { type: "toolcall_delta"; contentIndex: number; delta: string }
	| { type: "toolcall_end"; contentIndex: number; toolCall: ToolCall }
	| { type: "done"; reason: string };

export interface ToolCall {
	type: "toolCall";
	id: string;
	name: string;
	arguments: Record<string, any>;
}

export interface AgentMessage {
	role: "user" | "assistant" | "toolResult" | string;
	content: any;
	toolCallId?: string;
	toolName?: string;
	timestamp?: number;
	model?: string;
	provider?: string;
	usage?: any;
	stopReason?: string;
}

// ---------------------------------------------------------------- 前端视图

export interface ToolCallView {
	id: string;
	name: string;
	args: Record<string, any>;
	status: "pending" | "running" | "done" | "error";
	output?: string;
	startAt: number;
	endAt?: number;
	duration?: number;
	isError?: boolean;
}

export interface ChatItem {
	key: string;
	role: "user" | "assistant";
	text: string;
	thinking: string;
	toolCalls: ToolCallView[];
	streaming: boolean;
	toolResultByCallId?: Record<string, string>;
	/** 消息原始 timestamp(pi UserMessage.timestamp),用于 sync/事件竞态下的权威去重 */
	ts?: number;
	/** 乐观占位（等待响应） */
	placeholder?: "waiting";
	pendingToolcallArgs?: string;
}
