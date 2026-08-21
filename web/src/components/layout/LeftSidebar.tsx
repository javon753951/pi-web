import { useState } from "react";
import { ChevronDown, ChevronRight, Plus, RotateCcw, Store, Trash2 } from "lucide-react";
import { useApp } from "../../store";
import { StatusDot } from "../ui/misc";
import { Button } from "../ui/button";
import { PiMark } from "../icons";
import { cn, fmtTime, statusLabel } from "../../lib/utils";
import type { SessionMeta } from "../../lib/types";

function SessionItem({ session }: { session: SessionMeta }) {
	const { currentSessionId, selectSession, deleteSession, restartSession, status, lastError } = useApp();
	const [confirming, setConfirming] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [exiting, setExiting] = useState(false);
	const active = currentSessionId === session.id;
	const st = status[session.id] ?? session.status;
	const crashed = st === "crashed";
	const err = lastError[session.id];

	const remove = (e: React.MouseEvent) => {
		e.stopPropagation();
		if (exiting) return;
		if (confirming) {
			// 先收拢高度再真正删除
			setExiting(true);
			setTimeout(() => void deleteSession(session.id), 200);
		} else {
			setConfirming(true);
			setTimeout(() => setConfirming(false), 2500);
		}
	};

	return (
		<div className={cn("collapse-grid mb-0.5", !exiting && "collapse-open")}>
			<div className="collapse-inner">
				<div
					role="button"
					tabIndex={0}
					onClick={() => selectSession(session.id)}
					onKeyDown={(e) => {
						if (e.key === "Enter" || e.key === " ") {
							e.preventDefault();
							selectSession(session.id);
						}
					}}
					className={cn(
						"row-in group relative flex cursor-pointer flex-col gap-0.5 rounded-md border-l-2 px-2 py-1.5 transition-colors outline-none",
						exiting && "pointer-events-none opacity-0",
						crashed
							? "border-l-alarm/70 bg-alarm/[0.05]"
							: active
								? "border-l-ai bg-inset"
								: "border-l-transparent hover:bg-inset",
					)}
				>
					<div className="flex items-center gap-2">
						<StatusDot status={st} />
						<span className="min-w-0 flex-1 truncate text-xs font-medium text-ink">
							{session.name || "无标题会话"}
						</span>
						<span className="shrink-0 text-2xs text-ink-faint">{fmtTime(session.updatedAt)}</span>
					</div>
					<div className="flex items-center gap-1.5 pl-[15px]">
						<span className="font-mono text-2xs text-ink-faint">{session.id.slice(0, 8)}</span>
						{st !== "stopped" && (
							<span
								className={cn(
									"text-2xs",
									crashed ? "text-alarm" : st === "starting" ? "text-signal" : "text-ok",
								)}
							>
								{statusLabel(st)}
							</span>
						)}
						{/* 悬浮操作(嵌套 button:外层保持 div role=button) */}
						<span className="ml-auto flex items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
							{crashed && err && (
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5 text-ink-faint hover:text-ink"
									title={expanded ? "收起错误详情" : "展开错误详情"}
									onClick={(e) => {
										e.stopPropagation();
										setExpanded((v) => !v);
									}}
								>
									{expanded ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
								</Button>
							)}
							{crashed && (
								<Button
									variant="ghost"
									size="icon"
									className="h-5 w-5 text-ink-faint hover:text-ok"
									title="重新拉起"
									onClick={(e) => {
										e.stopPropagation();
										void restartSession(session.id);
									}}
								>
									<RotateCcw size={11} />
								</Button>
							)}
							<Button
								variant="ghost"
								size="icon"
								className={cn(
									"h-5 w-5 text-ink-faint hover:text-alarm",
									confirming && "text-alarm",
								)}
								title={confirming ? "再点一次确认删除" : "删除会话"}
								onClick={remove}
							>
								<Trash2 size={11} />
							</Button>
						</span>
					</div>
					{/* 崩溃 stderr = 黑视窗(可展开) */}
					{crashed && err && (
						<div className={cn("collapse-grid", expanded && "collapse-open")}>
							<div className="collapse-inner">
								<pre className="machine-window mt-1 max-h-[120px] overflow-y-auto rounded-sm border-l-2 border-l-alarm p-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-machine-ink">
									{err}
								</pre>
							</div>
						</div>
					)}
				</div>
			</div>
		</div>
	);
}

export function LeftSidebar({ onOpenMarketplace }: { onOpenMarketplace: () => void }) {
	const { sessions, createSession, currentSessionId, status } = useApp();
	const [search, setSearch] = useState("");
	const [creating, setCreating] = useState(false);

	const list = sessions.filter((s) => s.name.toLowerCase().includes(search.toLowerCase()));
	const runningCount = sessions.filter((s) => (status[s.id] ?? s.status) === "running").length;

	const newSession = async () => {
		setCreating(true);
		try {
			await createSession();
		} finally {
			setCreating(false);
		}
	};

	return (
		<aside className="flex h-full w-full flex-col">
			<div className="flex items-center gap-2.5 px-3.5 pb-2.5 pt-3.5">
				<PiMark size={28} />
				<div className="min-w-0">
					<h1 className="flex items-baseline gap-1.5 leading-tight">
						<span className="font-display text-sm font-semibold tracking-wide text-ink">智擎</span>
						<span className="text-2xs text-ink-faint">数字员工平台</span>
					</h1>
					<div className="label-tech mt-0.5 text-ink-faint">v0.1.0 · localhost</div>
				</div>
			</div>

			<div className="px-2.5 pb-2">
				<Button onClick={newSession} disabled={creating} className="w-full justify-start gap-2">
					<Plus size={14} /> 新会话
				</Button>
			</div>

			<button
				type="button"
				onClick={onOpenMarketplace}
				className="mx-2.5 mb-2 flex cursor-pointer items-center gap-2 rounded-sm px-2.5 py-1.5 text-xs font-medium text-ink-dim transition-colors hover:bg-inset hover:text-ink"
			>
				<Store size={14} /> 技能广场
			</button>

			<div className="label-tech px-3.5 pb-1 text-ink-faint">会话历史</div>
			<input
				value={search}
				onChange={(e) => setSearch(e.target.value)}
				placeholder="搜索会话…"
				className="mx-2.5 mb-1.5 h-7 rounded-sm border border-line bg-well px-2.5 text-2xs text-ink transition-colors outline-none placeholder:text-ink-faint focus:border-line-lit"
			/>
			<div className="flex-1 overflow-y-auto px-1.5 pb-2">
				{list.length === 0 ? (
					<div className="px-3 py-8 text-center text-2xs text-ink-faint">
						{search ? "没有匹配的会话" : "暂无会话,点击「新会话」开始"}
					</div>
				) : (
					list.map((s) => <SessionItem key={s.id} session={s} />)
				)}
			</div>

			<div className="flex items-center gap-2 border-t border-line px-3.5 py-2.5 text-2xs text-ink-faint">
				<StatusDot status={runningCount > 0 ? "running" : "stopped"} />
				网关运行中 · {runningCount} 个活跃子进程
			</div>
		</aside>
	);
}
