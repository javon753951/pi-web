import { readFileSync } from "node:fs";
import { applyEventToItems, syncToItems, makeOptimisticUser, makeWaitingPlaceholder } from "../src/lib/reducer";

const cap = JSON.parse(readFileSync("../scripts/ws-capture.json", "utf8"));
const syncMsg = cap.find((f: any) => f.msg.type === "sync");
const userStart = cap.find(
	(f: any) => f.msg.type === "event" && f.msg.event?.type === "message_start" && f.msg.event?.message?.role === "user",
);
if (!syncMsg || !userStart) { console.log("capture 缺数据"); process.exit(1); }
const ev = userStart.msg.event;
const text = typeof ev.message.content === "string" ? ev.message.content : (ev.message.content ?? []).map((c: any) => c.text ?? "").join("");

// 场景A(坏顺序):sync 响应先到(已含用户消息) → message_start 后到
let items = syncToItems(syncMsg.msg.messages);
const before = items.filter((i) => i.role === "user").length;
items = applyEventToItems(items, ev);
const after = items.filter((i) => i.role === "user").length;
const dupText = items.filter((i) => i.role === "user" && i.text === text).length;
console.log(`场景A sync先到: 用户消息数 ${before} → ${after}, 该文本出现 ${dupText} 次 ${dupText > 1 ? "❌ 重复!" : "✓"}`);

// 场景B(好顺序):乐观气泡还在 → message_start 替换
let items2 = [makeOptimisticUser(text), makeWaitingPlaceholder()];
items2 = applyEventToItems(items2, ev);
console.log(`场景B 乐观路径: 用户消息数 ${items2.filter((i) => i.role === "user").length} ✓`);
