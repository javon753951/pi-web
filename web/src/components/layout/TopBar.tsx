import type { ReactNode } from "react";
import { Menu, PanelRightClose, PanelRightOpen, Settings2 } from "lucide-react";
import { useApp } from "../../store";
import { StatusDot } from "../ui/misc";
import { Button } from "../ui/button";
import { Segmented } from "../ui/tabs";
import { PiMark } from "../icons";
import { cn, statusLabel } from "../../lib/utils";

function statusColor(st: string): string {
	if (st === "running") return "text-ok";
	if (st === "starting") return "text-signal";
	if (st === "crashed") return "text-alarm";
	return "text-ink-dim";
}

/** 遥测读数组:label-tech 微标签 + mono 值。始终水平排列,label 在窄屏隐藏防溢出。 */
function Readout({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
	return (
		<div className={cn("flex flex-row items-center gap-1.5 leading-tight", className)}>
			<span className="label-tech hidden text-ink-faint xl:inline">{label}</span>
			<span className="readout max-w-[160px] truncate text-ink">{children}</span>
		</div>
	);
}

/** 仪表条:左 [智 mark + 智擎 + 视图分段] · 右 [遥测读数 + 操作]。只用 store 真实数据。 */
export function TopBar({
	view,
	onView,
	onOpenSidebar,
	onOpenSettings,
	onToggleRight,
	rightOpen,
	mobile,
}: {
	view: "chat" | "marketplace";
	onView: (v: "chat" | "marketplace") => void;
	onOpenSidebar?: () => void;
	onOpenSettings: () => void;
	onToggleRight: () => void;
	rightOpen: boolean;
	mobile?: boolean;
}) {
	const { currentSessionId, sessions, status, connected, models, messages } = useApp();
	const session = sessions.find((s) => s.id === currentSessionId);
	const st = currentSessionId ? (status[currentSessionId] ?? "stopped") : "stopped";
	const model = session?.model;
	const modelName = model ? (models.find((m) => m.id === model)?.name ?? model) : null;
	const msgCount = currentSessionId ? (messages[currentSessionId]?.length ?? 0) : 0;
	const streaming = currentSessionId ? (messages[currentSessionId]?.at(-1)?.streaming ?? false) : false;

	return (
		<header className="flex h-10 shrink-0 items-center gap-3 overflow-hidden border-b border-line px-3">
			{mobile && onOpenSidebar && (
				<Button variant="ghost" size="icon" title="打开会话列表" onClick={onOpenSidebar} className="shrink-0">
					<Menu size={16} />
				</Button>
			)}
			<div className="flex min-w-0 shrink-0 items-center gap-2.5">
				<PiMark size={22} />
				<div className="hidden min-w-0 md:block">
					<span className="font-display text-[13px] font-semibold tracking-wide text-ink">智擎</span>
					<span className="ml-1.5 hidden text-2xs text-ink-faint xl:inline">数字员工平台</span>
				</div>
			</div>
			<Segmented
				ariaLabel="视图切换"
				options={[
					{ value: "chat", label: "聊天" },
					{ value: "marketplace", label: "技能广场" },
				]}
				value={view}
				onChange={onView}
			/>

			<div className="ml-auto flex min-w-0 items-center justify-end gap-3">
				<Readout label="状态">
					<span className="flex items-center gap-1.5">
						<StatusDot status={currentSessionId ? st : ""} />
						<span className={currentSessionId ? statusColor(st) : "text-ink-faint"}>
							{currentSessionId ? statusLabel(st) : "未选择会话"}
						</span>
					</span>
				</Readout>
				<Readout label="模型" className="hidden lg:flex">
					<span className="truncate">{modelName ?? "—"}</span>
				</Readout>
				<Readout label="消息">
					<span className={cn("tnum", streaming ? "text-ai" : "text-ink")}>{msgCount}</span>
				</Readout>
				{!connected && (
					<span className="flex items-center gap-1.5 text-2xs text-signal">
						<span className="h-1.5 w-1.5 rounded-full bg-signal led-starting" />
						重连中
					</span>
				)}
				<div className="flex shrink-0 items-center gap-0.5">
					{view === "chat" && (
						<Button variant="ghost" size="icon" title={rightOpen ? "折叠右栏" : "展开右栏"} onClick={onToggleRight}>
							{rightOpen ? <PanelRightClose size={15} /> : <PanelRightOpen size={15} />}
						</Button>
					)}
					<Button variant="ghost" size="icon" title="设置" onClick={onOpenSettings}>
						<Settings2 size={15} />
					</Button>
				</div>
			</div>
		</header>
	);
}
