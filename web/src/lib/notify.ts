/**
 * 浏览器通知：页面后台/不可见时，会话完成、崩溃、等待审批时提醒。
 * 「沉默 worker → 会喊人的队友」——布置完任务去干别的，事了他叫你。
 */

export type NotifyKind = "done" | "crashed" | "ui_request";

export interface NotifyHooks {
	/** 点击通知时聚焦窗口并切到对应会话。 */
	onActivate: (sessionId: string) => void;
}

let hooks: NotifyHooks | null = null;

export function setNotifyHooks(h: NotifyHooks): void {
	hooks = h;
}

export function notifySupported(): boolean {
	return typeof Notification !== "undefined";
}

export function notifyPermission(): NotificationPermission | "unsupported" {
	if (!notifySupported()) return "unsupported";
	return Notification.permission;
}

export async function requestNotifyPermission(): Promise<NotificationPermission | "unsupported"> {
	if (!notifySupported()) return "unsupported";
	if (Notification.permission === "granted") return "granted";
	try {
		return await Notification.requestPermission();
	} catch {
		return "denied";
	}
}

function fire(sessionId: string, title: string, body: string): void {
	if (!notifySupported() || Notification.permission !== "granted") return;
	if (!document.hidden) return; // 前台盯着呢，不打扰
	try {
		const n = new Notification(title, { body, tag: `piweb-${sessionId}` });
		n.onclick = () => {
			window.focus();
			hooks?.onActivate(sessionId);
			n.close();
		};
	} catch {
		/* 某些环境（无 SW 的移动浏览器）会抛错，忽略 */
	}
}

export function notifySession(sessionId: string, sessionName: string | undefined, kind: NotifyKind): void {
	const label = sessionName?.trim() || sessionId.slice(0, 8);
	switch (kind) {
		case "done":
			fire(sessionId, `✅ ${label}`, "任务完成，回来看看结果");
			break;
		case "crashed":
			fire(sessionId, `⚠️ ${label}`, "会话崩溃了，需要你处理");
			break;
		case "ui_request":
			fire(sessionId, `🔔 ${label}`, "Agent 在等你确认/输入");
			break;
	}
}
