import type { ChatItem, ToolCallView } from "./types";

/** 乐观占位 key 前缀（用户已发送 / 等待响应）。 */
export const OPT_KEY_USER = "opt:user";
export const OPT_KEY_WAITING = "opt:waiting";

export function makeOptimisticUser(text: string): ChatItem {
	return { key: OPT_KEY_USER, role: "user", text, thinking: "", toolCalls: [], streaming: false };
}

export function makeWaitingPlaceholder(): ChatItem {
	return { key: OPT_KEY_WAITING, role: "assistant", text: "", thinking: "", toolCalls: [], streaming: true, placeholder: "waiting" };
}

function uid(role: "u" | "a"): string {
	return `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * 纯函数：把一个 RPC 事件归约到消息视图。
 * 由 store 调用；单测覆盖（见 test/reducer.test.ts）。
 */
export function applyEventToItems(items: ChatItem[], event: any): ChatItem[] {
	// 不可变更新：克隆每个 item 与 toolCall，保证对象引用变化，
	// 否则 memo(MessageItem) 会因引用未变而跳过重渲染（流式内容不更新）。
	const out = items.map((it) => ({
		...it,
		toolCalls: it.toolCalls.map((tc) => ({ ...tc })),
	}));
	const last = out[out.length - 1];

	/** 拿到当前 assistant 消息项；必要时新建（并清掉等待占位）。 */
	const ensureAssistant = (): ChatItem => {
		if (last && last.role === "assistant" && last.key !== OPT_KEY_WAITING) return last;
		if (last && last.key === OPT_KEY_WAITING) {
			last.key = uid("a"); // 转正：换成正式 key，避免后续事件再当占位处理
			last.placeholder = undefined;
			last.streaming = true;
			return last;
		}
		const filtered = out.filter((i) => i.key !== OPT_KEY_WAITING);
		const item: ChatItem = { key: uid("a"), role: "assistant", text: "", thinking: "", toolCalls: [], streaming: true };
		filtered.push(item);
		out.length = 0;
		out.push(...filtered);
		return item;
	};
	const patch = (item: ChatItem, p: Partial<ChatItem>) => Object.assign(item, p);

	switch (event.type) {
		case "message_start": {
			const m = event.message;
			if (m?.role === "user") {
				const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((c: any) => c.text ?? "").join("");
				const ts = typeof m.timestamp === "number" ? m.timestamp : undefined;
				// 用真实消息替换乐观用户气泡（同文去重，保持顺序）
				const idx = out.findIndex((i) => i.key === OPT_KEY_USER && i.text === text);
				if (idx !== -1) {
					out[idx] = { key: uid("u"), role: "user", text, ts, thinking: "", toolCalls: [], streaming: false };
				} else {
					// 竞态去重:sync 快照可能已物化同一条消息(sync 响应先于 message_start 事件到达,
					// 乐观气泡已被快照冲掉)。同一消息 = 同文本 + 同 timestamp(事件与 get_messages
					// 返回同一个 pi 消息对象);相同文本但 timestamp 不同 = 用户真的又发了一次,必须插入。
					const already =
						ts !== undefined && out.some((i) => i.role === "user" && i.text === text && i.ts === ts);
					if (!already) {
						out.push({ key: uid("u"), role: "user", text, ts, thinking: "", toolCalls: [], streaming: false });
					}
				}
			} else if (m?.role === "assistant") {
				ensureAssistant();
			}
			break;
		}
		case "message_update": {
			const d = event.assistantMessageEvent;
			if (!d) break;
			const item = ensureAssistant();
			switch (d.type) {
				case "text_delta":
					patch(item, { text: item.text + d.delta });
					break;
				case "thinking_delta":
					patch(item, { thinking: item.thinking + d.delta });
					break;
				case "toolcall_delta":
					// 流式参数暂存（toolcall_end 会给出完整参数）
					patch(item, { pendingToolcallArgs: (item.pendingToolcallArgs ?? "") + d.delta });
					break;
				case "toolcall_end": {
					const tc = d.toolCall;
					if (tc?.id) {
						item.toolCalls.push({
							id: tc.id,
							name: tc.name,
							args: tc.arguments ?? {},
							status: "pending",
							startAt: Date.now(),
						});
					}
					patch(item, { pendingToolcallArgs: undefined });
					break;
				}
				case "done":
					patch(item, { streaming: false });
					break;
				default:
					break;
			}
			break;
		}
		case "message_end": {
			if (last?.role === "assistant" && last.key !== OPT_KEY_WAITING) patch(last, { streaming: false });
			break;
		}
		case "tool_execution_start": {
			const item = ensureAssistant();
			const tc = item.toolCalls.find((t) => t.id === event.toolCallId);
			if (tc) {
				tc.status = "running";
				tc.args = event.args ?? tc.args;
				tc.startAt = Date.now();
			} else {
				item.toolCalls.push({
					id: event.toolCallId,
					name: event.toolName,
					args: event.args ?? {},
					status: "running",
					startAt: Date.now(),
				});
			}
			break;
		}
		case "tool_execution_update": {
			const item = ensureAssistant();
			const tc = item.toolCalls.find((t) => t.id === event.toolCallId);
			if (tc) {
				const p = event.partialResult;
				const delta =
					typeof p?.output === "string" ? p.output : typeof p?.content === "string" ? p.content : "";
				tc.output = (tc.output ?? "") + delta;
			}
			break;
		}
		case "tool_execution_end": {
			const item = ensureAssistant();
			const tc = item.toolCalls.find((t) => t.id === event.toolCallId);
			if (tc) {
				tc.status = event.isError ? "error" : "done";
				tc.isError = event.isError;
				tc.endAt = Date.now();
				tc.duration = tc.endAt - tc.startAt;
				const result = event.result;
				const text = Array.isArray(result?.content)
					? result.content.map((c: any) => c.text ?? "").join("")
					: typeof result?.output === "string"
						? result.output
						: JSON.stringify(result ?? {}).slice(0, 4000);
				tc.output = text;
			}
			break;
		}
		case "turn_end":
		case "agent_end": {
			if (last?.role === "assistant" && last.key !== OPT_KEY_WAITING) patch(last, { streaming: false });
			break;
		}
		default:
			break;
	}
	return out;
}

/** get_messages (AgentMessage[]) → ChatItem[]。 */
export function syncToItems(messages: any[] | null): ChatItem[] {
	if (!Array.isArray(messages)) return [];
	const items: ChatItem[] = [];
	let curAssistant: ChatItem | null = null;

	for (const m of messages) {
		if (m.role === "user") {
			const text = typeof m.content === "string" ? m.content : (m.content ?? []).map((c: any) => c.text ?? "").join("");
			items.push({
				key: uid("u"),
				role: "user",
				text,
				ts: typeof m.timestamp === "number" ? m.timestamp : undefined,
				thinking: "",
				toolCalls: [],
				streaming: false,
			});
			curAssistant = null;
		} else if (m.role === "assistant") {
			const content = Array.isArray(m.content) ? m.content : [];
			let text = "";
			let thinking = "";
			const toolCalls: ToolCallView[] = [];
			for (const c of content) {
				if (c.type === "text") text += c.text ?? "";
				else if (c.type === "thinking") thinking += c.thinking ?? "";
				else if (c.type === "toolCall" && c.id) {
					toolCalls.push({ id: c.id, name: c.name, args: c.arguments ?? {}, status: "done", startAt: Date.now(), endAt: Date.now(), duration: 0 });
				}
			}
			// 同一轮（用户消息之间）的多条 assistant 消息合并为一个气泡，
			// 与实时流式渲染对齐——否则刷新后一轮工具任务会被拆成
			// 「思考+工具」「文本」「思考+工具」多段，看起来像重复。
			if (curAssistant) {
				curAssistant.thinking += thinking;
				curAssistant.text += text;
				curAssistant.toolCalls.push(...toolCalls);
			} else {
				curAssistant = {
					key: uid("a"),
					role: "assistant",
					text,
					thinking,
					toolCalls,
					streaming: false,
					ts: typeof m.timestamp === "number" ? m.timestamp : undefined,
				};
				items.push(curAssistant);
			}
		} else if (m.role === "toolResult" && curAssistant) {
			const text = (m.content ?? []).map((c: any) => c.text ?? "").join("");
			const tc = curAssistant.toolCalls.find((t) => t.id === m.toolCallId);
			if (tc) tc.output = text;
		}
	}
	return items;
}
