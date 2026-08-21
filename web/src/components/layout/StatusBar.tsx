import { useEffect, useState } from "react";
import { Bell, BellOff, ChevronDown, ChevronUp, QrCode, X } from "lucide-react";
import QRCode from "qrcode";
import { useApp } from "../../store";
import { StatusDot } from "../ui/misc";
import { api, getToken } from "../../lib/api";
import { notifyPermission, notifySupported, requestNotifyPermission } from "../../lib/notify";
import { cn } from "../../lib/utils";

/** 单行波形:等宽字符滚动(13 字符窗)。只在流式时运转——活数据才动。 */
const WAVE = "▁▂▃▄▅▆▇▆▅▄▃▂▁";

interface LanEntry {
	url: string;
	qr: string;
}

/** 局域网扫码访问弹层：/api/net 拿地址，token 拼进 URL，一码即登录。 */
function LanQrPopover({ onClose }: { onClose: () => void }) {
	const [entries, setEntries] = useState<LanEntry[] | null>(null);
	const [error, setError] = useState<string | null>(null);
	const [lanDisabled, setLanDisabled] = useState(false);

	useEffect(() => {
		let alive = true;
		(async () => {
			try {
				const data = await api.get<{ urls: string[]; lanEnabled?: boolean; host?: string }>("/api/net");
				if (!alive) return;
				// 服务只监听回环地址时，任何局域网 IP 都连不上——直接提示，不生成废码。
				if (data.lanEnabled === false) {
					setLanDisabled(true);
					setEntries([]);
					return;
				}
				const token = getToken();
				const list: LanEntry[] = [];
				for (const url of data.urls.slice(0, 4)) {
					const withToken = token ? `${url}/?token=${encodeURIComponent(token)}` : url;
					const qr = await QRCode.toDataURL(withToken, { margin: 1, width: 180 });
					if (alive) list.push({ url, qr });
				}
				if (alive) setEntries(list);
			} catch (err) {
				if (alive) setError(err instanceof Error ? err.message : String(err));
			}
		})();
		return () => {
			alive = false;
		};
	}, []);

	return (
		<div
			className="glass pop-in fixed right-2 bottom-9 z-(--z-preview) w-[300px] rounded-lg border border-line p-3 shadow-lift"
			onClick={(e) => e.stopPropagation()}
		>
			<div className="mb-2 flex items-center gap-2">
				<span className="label-tech text-ink-dim">LAN · 手机扫码即用</span>
				<button
					type="button"
					className="ml-auto cursor-pointer rounded-sm p-1 text-ink-faint hover:bg-inset hover:text-ink"
					onClick={onClose}
					title="关闭"
				>
					<X size={12} />
				</button>
			</div>
			{error && <div className="text-2xs text-alarm">获取局域网地址失败：{error}</div>}
			{lanDisabled && (
				<div className="text-2xs leading-relaxed text-alarm">
					服务当前只监听了 127.0.0.1，手机无法访问。
					<br />
					请以 <code className="label-tech">PI_WEB_HOST=0.0.0.0</code> 重启服务，并放行防火墙端口
					（Windows 防火墙放行 node.exe），然后重新打开此弹层。
				</div>
			)}
			{!error && !lanDisabled && !entries && (
				<div className="py-4 text-center text-2xs text-ink-faint">生成二维码中…</div>
			)}
			{entries?.length === 0 && !lanDisabled && (
				<div className="text-2xs text-ink-faint">
					未检测到局域网地址 —— 请确认已连上 Wi-Fi/有线网络，且服务绑定到 0.0.0.0（PI_WEB_HOST）。
				</div>
			)}
			{entries?.map((e) => (
				<div key={e.url} className="mb-2 flex items-center gap-3 last:mb-0">
					<img src={e.qr} alt="LAN QR" className="size-[88px] shrink-0 rounded-sm border border-line bg-white p-1" />
					<div className="min-w-0">
						<div className="truncate font-mono text-2xs text-ink-dim">{e.url}</div>
						<div className="mt-0.5 text-2xs text-ink-faint">链接已带 token，扫码直接进入</div>
					</div>
				</div>
			))}
			{!lanDisabled && entries && entries.length > 0 && (
				<div className="mt-2 border-t border-line pt-1.5 text-2xs text-ink-faint">
					手机连不上？检查手机与本机是否同一网络，以及 Windows 防火墙是否放行了 8787/5188 端口。
				</div>
			)}
		</div>
	);
}

/**
 * 底部状态条(方案A 座舱信息架构的核心):整条玻璃板,跨全宽悬浮。
 * 左 = 会话 LED + 名称 + 模型/思考;中 = 流式波形(靛)或待命;
 * 右 = 消息计数 + WS 连接 + LAN 二维码 + 通知开关 + 版本 + 折叠钮。
 * 折叠后只留一条 20px 的展开钮——零内容残留(遵循 collapse 规范)。
 */
export function StatusBar() {
	const { currentSessionId, sessions, connected, messages, status } = useApp();
	const [open, setOpen] = useState(true);
	const [phase, setPhase] = useState(0);
	const [qrOpen, setQrOpen] = useState(false);
	const [perm, setPerm] = useState<NotificationPermission | "unsupported">(notifyPermission());

	const session = sessions.find((s) => s.id === currentSessionId);
	const st = currentSessionId ? (status[currentSessionId] ?? "stopped") : "stopped";
	const msgCount = currentSessionId ? (messages[currentSessionId]?.length ?? 0) : 0;
	const streaming = currentSessionId ? (messages[currentSessionId]?.at(-1)?.streaming ?? false) : false;

	useEffect(() => {
		if (!streaming) return;
		const t = setInterval(() => setPhase((p) => p + 1), 140);
		return () => clearInterval(t);
	}, [streaming]);

	const wave = WAVE.repeat(3).slice(phase % WAVE.length, (phase % WAVE.length) + 13);

	const toggleNotify = async () => {
		const result = await requestNotifyPermission();
		setPerm(result);
	};

	if (!open) {
		return (
			<button
				type="button"
				onClick={() => setOpen(true)}
				title="展开状态条"
				className="flex h-5 w-full shrink-0 cursor-pointer items-center justify-center text-ink-faint transition-colors hover:bg-inset hover:text-ink-dim"
			>
				<ChevronUp size={12} />
			</button>
		);
	}

	return (
		<div className="fade-rise flex h-7 shrink-0 items-center gap-3 border-t border-line px-3 [animation-delay:240ms]">
			<span className="flex min-w-0 items-center gap-2">
				<StatusDot status={st} />
				<span className="max-w-[160px] truncate text-2xs font-medium text-ink">
					{session?.name ?? "未选择会话"}
				</span>
			</span>
			<span className="label-tech hidden max-w-[220px] shrink-0 truncate text-ink-faint md:inline">
				{session?.model ?? "—"} · thinking:{session?.thinkingLevel ?? "—"}
			</span>

			<span className="mx-auto flex min-w-0 items-center gap-1.5">
				{streaming ? (
					<span className="readout text-ai" aria-label="模型正在输出">
						{wave}
					</span>
				) : (
					<span className="readout text-ink-faint">● 待命</span>
				)}
			</span>

			{qrOpen && <LanQrPopover onClose={() => setQrOpen(false)} />}

			<span className="ml-auto flex shrink-0 items-center gap-3">
				<span className="readout hidden text-ink-dim sm:inline">msg {msgCount}</span>
				<span className={cn("readout", connected ? "text-ok" : "text-signal")}>
					{connected ? "ws ✓" : "ws 重连中"}
				</span>
				<button
					type="button"
					onClick={() => setQrOpen((v) => !v)}
					title="局域网访问二维码"
					className={cn(
						"flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-inset",
						qrOpen ? "text-ai" : "text-ink-faint hover:text-ink-dim",
					)}
				>
					<QrCode size={12} />
				</button>
				{notifySupported() && (
					<button
						type="button"
						onClick={() => void toggleNotify()}
						title={
							perm === "granted"
								? "通知已开启：任务完成/崩溃/等审批时提醒（仅页面后台时）"
								: "开启浏览器通知：任务完成/崩溃/等审批时提醒"
						}
						className={cn(
							"flex h-5 w-5 cursor-pointer items-center justify-center rounded-sm transition-colors hover:bg-inset",
							perm === "granted" ? "text-ok" : "text-ink-faint hover:text-ink-dim",
						)}
					>
						{perm === "denied" ? <BellOff size={12} /> : <Bell size={12} />}
					</button>
				)}
				<span className="readout hidden text-ink-faint lg:inline">v0.1.0</span>
				<button
					type="button"
					onClick={() => setOpen(false)}
					title="折叠状态条"
					className="flex h-5 w-5 shrink-0 cursor-pointer items-center justify-center rounded-sm text-ink-faint transition-colors hover:bg-inset hover:text-ink-dim"
				>
					<ChevronDown size={12} />
				</button>
			</span>
		</div>
	);
}
