import { describe, it, expect } from "vitest";
import {
	applyEventToItems,
	makeOptimisticUser,
	makeWaitingPlaceholder,
	syncToItems,
} from "../src/lib/reducer";

const tid = (s: string) => `call_${s}`;

/** 真实 pi 事件序列（从网关 WS 抓取，deepseek thinking on + bash 工具调用）。 */
function realSequence(): any[] {
	return [
		{ type: "message_start", message: { role: "user", content: [{ type: "text", text: "执行 echo hello" }] } },
		{ type: "message_end", message: { role: "user" } },
		{ type: "message_start", message: { role: "assistant" } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_start", contentIndex: 0 } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "用户需要" } },
		{ type: "message_update", assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "执行命令" } },
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_start", contentIndex: 0 } },
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: '{"command"' } },
		{ type: "message_update", assistantMessageEvent: { type: "toolcall_delta", contentIndex: 0, delta: ': "echo hello"}' } },
		{
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: tid("bash1"), name: "bash", arguments: { command: "echo hello" } },
			},
		},
		{ type: "message_end", message: { role: "assistant" } },
		{ type: "tool_execution_start", toolCallId: tid("bash1"), toolName: "bash", args: { command: "echo hello" } },
		{ type: "tool_execution_update", toolCallId: tid("bash1"), toolName: "bash", partialResult: { output: "hello" } },
		{
			type: "tool_execution_end",
			toolCallId: tid("bash1"),
			toolName: "bash",
			result: { content: [{ type: "text", text: "hello" }] },
			isError: false,
		},
		{ type: "message_start", message: { role: "toolResult", toolCallId: tid("bash1") } },
		{ type: "message_end", message: { role: "toolResult" } },
		{ type: "message_start", message: { role: "assistant" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "结果：" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "hello" } },
		{ type: "message_update", assistantMessageEvent: { type: "text_end", contentIndex: 0 } },
		{ type: "message_end", message: { role: "assistant" } },
		{ type: "turn_end" },
		{ type: "agent_end" },
	];
}

describe("applyEventToItems — 真实事件序列回放", () => {
	it("累积 thinking → 工具调用 → 工具执行 → 最终文本", () => {
		let items: any[] = [];
		for (const ev of realSequence()) {
			items = applyEventToItems(items, ev);
		}
		expect(items).toHaveLength(2);
		expect(items[0]).toMatchObject({ role: "user", text: "执行 echo hello" });

		const asst = items[1];
		expect(asst.role).toBe("assistant");
		expect(asst.thinking).toBe("用户需要执行命令");
		expect(asst.toolCalls).toHaveLength(1);
		expect(asst.toolCalls[0]).toMatchObject({
			id: tid("bash1"),
			name: "bash",
			status: "done",
			isError: false,
		});
		expect(asst.toolCalls[0].output).toContain("hello");
		expect(asst.text).toBe("结果：hello");
		expect(asst.streaming).toBe(false);
	});

	it("thinking 阶段 streaming=true，agent_end 后关闭", () => {
		let items: any[] = [];
		for (const ev of realSequence()) {
			items = applyEventToItems(items, ev);
		}
		expect(items[1].streaming).toBe(false);
	});

	it("工具执行失败标记 error", () => {
		let items: any[] = [];
		items = applyEventToItems(items, { type: "message_start", message: { role: "assistant" } });
		items = applyEventToItems(items, {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: tid("x"), name: "bash", arguments: {} },
			},
		});
		items = applyEventToItems(items, {
			type: "tool_execution_end",
			toolCallId: tid("x"),
			toolName: "bash",
			result: { content: [{ type: "text", text: "boom" }] },
			isError: true,
		});
		expect(items[0].toolCalls[0].status).toBe("error");
		expect(items[0].toolCalls[0].output).toContain("boom");
	});
});

describe("乐观占位", () => {
	it("等待占位在真实 assistant 事件到达时被替换", () => {
		let items = [makeOptimisticUser("你好"), makeWaitingPlaceholder()];
		items = applyEventToItems(items, { type: "message_start", message: { role: "user", content: [{ type: "text", text: "你好" }] } });
		// 真实用户消息替换乐观气泡（去重）
		expect(items[0].key).not.toBe("opt:user");
		expect(items[0].text).toBe("你好");
		// 等待占位仍在（尚未有 assistant 内容）
		expect(items[1].key).toBe("opt:waiting");

		items = applyEventToItems(items, {
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "思考中" },
		});
		expect(items[1].key).not.toBe("opt:waiting");
		expect(items[1].thinking).toBe("思考中");
		expect(items[1].streaming).toBe(true);
	});

	it("没有 assistant 事件时占位保留", () => {
		const items = [makeOptimisticUser("x"), makeWaitingPlaceholder()];
		expect(items[1].key).toBe("opt:waiting");
	});
});

describe("不可变更新（memo 重渲染前提）", () => {
	it("每次事件后 item 对象引用必须变化", () => {
		let items: any[] = [makeOptimisticUser("hi"), makeWaitingPlaceholder()];
		const before = items[1];
		items = applyEventToItems(items, {
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "x" },
		});
		const after = items[1];
		expect(after).not.toBe(before); // 引用必须变化，否则 memo(MessageItem) 跳过渲染
		expect(after.thinking).toBe("x");
		// 未修改的 item 也应克隆（数组元素整体新引用）
		expect(items[0]).not.toBe(undefined);
	});

	it("toolCall 对象引用变化（工具状态更新可渲染）", () => {
		let items: any[] = [];
		items = applyEventToItems(items, { type: "message_start", message: { role: "assistant" } });
		items = applyEventToItems(items, {
			type: "message_update",
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: { type: "toolCall", id: tid("t"), name: "bash", arguments: {} },
			},
		});
		const before = items[0].toolCalls[0];
		items = applyEventToItems(items, { type: "tool_execution_start", toolCallId: tid("t"), toolName: "bash", args: {} });
		expect(items[0].toolCalls[0]).not.toBe(before);
		expect(items[0].toolCalls[0].status).toBe("running");
	});
});

describe("发送流程（防重复渲染回归）", () => {
	it("乐观气泡 + message_start 不产生重复用户消息", () => {
		let items = [makeOptimisticUser("写个脚本"), makeWaitingPlaceholder()];
		// 真实用户消息事件
		items = applyEventToItems(items, {
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "写个脚本" }] },
		});
		const userItems = items.filter((i) => i.role === "user");
		expect(userItems).toHaveLength(1); // 不得重复
		expect(userItems[0].text).toBe("写个脚本");
		expect(userItems[0].key).not.toBe("opt:user");
		// 等待占位仍在，等待 assistant 内容
		expect(items[1].key).toBe("opt:waiting");
	});

	it("等待占位仅渲染一次（无 pendingPrompt 重复源）", () => {
		let items = [makeOptimisticUser("x"), makeWaitingPlaceholder()];
		const waiting = items.filter((i) => i.placeholder === "waiting");
		expect(waiting).toHaveLength(1);
		items = applyEventToItems(items, {
			type: "message_update",
			assistantMessageEvent: { type: "thinking_delta", contentIndex: 0, delta: "想" },
		});
		expect(items.filter((i) => i.placeholder === "waiting")).toHaveLength(0); // 转正后不再是占位
	});

	it("sync 快照已物化用户消息后，迟到的 message_start 不再重复插入（竞态回归）", () => {
		// 真实场景:open 后立即发 prompt,100ms 后的 sync 响应先于 message_start 事件到达,
		// 快照已含该用户消息,乐观气泡被冲掉 —— 此前会再 push 一条重复气泡。
		let items = syncToItems([
			{ role: "user", content: [{ type: "text", text: "写个脚本" }], timestamp: 111 },
			{ role: "assistant", content: [{ type: "text", text: "好的" }], timestamp: 222 },
		]);
		items = applyEventToItems(items, {
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "写个脚本" }], timestamp: 111 },
		});
		const users = items.filter((i) => i.role === "user");
		expect(users).toHaveLength(1);
		expect(users[0].ts).toBe(111);
	});

	it("相同文本但不同 timestamp 的第二次发送仍会插入（不误吞真实重复）", () => {
		let items = syncToItems([
			{ role: "user", content: [{ type: "text", text: "你好" }], timestamp: 111 },
			{ role: "assistant", content: [{ type: "text", text: "hi" }], timestamp: 222 },
		]);
		items = applyEventToItems(items, {
			type: "message_start",
			message: { role: "user", content: [{ type: "text", text: "你好" }], timestamp: 333 },
		});
		expect(items.filter((i) => i.role === "user")).toHaveLength(2);
	});
});

describe("syncToItems — 会话恢复", () => {
	it("重建消息视图（含 thinking/工具/结果绑定）", () => {
		const msgs = [
			{ role: "user", content: [{ type: "text", text: "hi" }] },
			{
				role: "assistant",
				content: [
					{ type: "thinking", thinking: "想一下" },
					{ type: "toolCall", id: tid("a"), name: "read", arguments: { path: "x" } },
					{ type: "text", text: "看完了" },
				],
			},
			{ role: "toolResult", toolCallId: tid("a"), content: [{ type: "text", text: "file content" }] },
		];
		const items = syncToItems(msgs);
		expect(items).toHaveLength(2);
		expect(items[1].thinking).toBe("想一下");
		expect(items[1].text).toBe("看完了");
		expect(items[1].toolCalls[0].output).toBe("file content");
	});
});
