import { memo, useEffect, useRef, useState } from "react";
import { Check, ChevronDown, ChevronRight, Wrench, X } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { PiMark } from "../icons";
import { Spinner } from "../ui/misc";
import type { ChatItem, ToolCallView } from "../../lib/types";
import { cn, fmtDuration, fmtTime } from "../../lib/utils";

// ---------------------------------------------------------------- thinking

function ThinkingBlock({ text, streaming }: { text: string; streaming: boolean }) {
	const [open, setOpen] = useState(streaming);
	useEffect(() => {
		if (streaming) setOpen(true);
	}, [streaming]);
	if (!text && !streaming) return null;
	return (
		<div className="mb-1.5 overflow-hidden rounded-md border border-line bg-surface text-xs">
			<button
				className={cn(
					"flex w-full cursor-pointer items-center gap-1.5 px-3 py-1.5 select-none",
					streaming && "sweep",
				)}
				onClick={() => setOpen(!open)}
			>
				{open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
				<span className="font-medium text-ink-dim hover:text-ink">思考过程</span>
				<span className="ml-auto font-mono text-2xs tnum text-ink-faint">{text.length} 字</span>
			</button>
			<div className={cn("collapse-grid", open && "collapse-open")}>
				{/* 折叠规范:collapse-inner 必须零 padding/border,否则 0fr 折叠后残留高度条(Chrome 轨道基线含 padding) */}
				<div className="collapse-inner">
					<div className="max-h-[240px] overflow-y-auto border-t border-line px-3.5 py-2 text-ink-dim whitespace-pre-wrap">
						{text}
						{streaming && <span className="stream-caret" />}
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- tool card

function toolArgsSummary(args: Record<string, unknown>): string {
	try {
		const s = JSON.stringify(args);
		return s.length > 600 ? s.slice(0, 600) + "…" : s;
	} catch {
		return String(args);
	}
}

function ToolCallCard({ tc }: { tc: ToolCallView }) {
	const [open, setOpen] = useState(false);
	const statusIcon =
		tc.status === "running" ? (
			<Spinner />
		) : tc.status === "error" ? (
			<X size={11} className="text-alarm" />
		) : tc.status === "done" ? (
			<Check size={11} className="text-ok" />
		) : (
			<span className="text-ink-faint">·</span>
	);
	return (
		<div className="my-1.5 overflow-hidden rounded-md border border-line bg-surface text-xs">
			<button
				className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-left transition-colors select-none hover:bg-inset"
				onClick={() => setOpen(!open)}
			>
				<span className="flex h-5 w-5 items-center justify-center rounded-sm bg-inset">
					<Wrench size={11} className="text-ink-dim" />
				</span>
				<span className="font-mono font-semibold text-ink">{tc.name}</span>
				<span className="ml-auto flex items-center gap-2">
					{statusIcon}
					{tc.duration !== undefined && tc.status !== "running" && (
						<span className="font-mono text-2xs tnum text-ink-faint">{fmtDuration(tc.duration)}</span>
					)}
				</span>
			</button>
			<div className={cn("collapse-grid", open && "collapse-open")}>
				{/* 折叠规范:collapse-inner 必须零 padding/border(同 ThinkingBlock) */}
				<div className="collapse-inner">
					<div className="space-y-1.5 px-3 pb-2">
						<pre className="machine-window machine-scroll rounded-sm p-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap text-machine-dim">
							{toolArgsSummary(tc.args)}
						</pre>
						{tc.output !== undefined && (
							<pre
								className={cn(
									"machine-window machine-scroll rounded-sm p-2 font-mono text-2xs leading-relaxed whitespace-pre-wrap",
									tc.isError ? "text-machine-alarm" : "text-machine-ok",
								)}
							>
								{tc.output}
							</pre>
						)}
						<div className="font-mono text-2xs text-ink-faint">{fmtTime(tc.startAt)}</div>
					</div>
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- message

/** 等待三点波:思考光谱三站(钴→紫→青),AI 活着的最小信号。 */
function SpectrumWave() {
	return (
		<>
			<span className="wave-dot h-1.5 w-1.5 rounded-full bg-[#6d7dff] [animation-delay:0ms]" />
			<span className="wave-dot h-1.5 w-1.5 rounded-full bg-[#a78bfa] [animation-delay:150ms]" />
			<span className="wave-dot h-1.5 w-1.5 rounded-full bg-[#4fd6c8] [animation-delay:300ms]" />
		</>
	);
}

function MessageBody({ item }: { item: ChatItem }) {
	const parts: React.ReactNode[] = [];
	let key = 0;
	if (item.thinking) {
		parts.push(<ThinkingBlock key={key++} text={item.thinking} streaming={item.streaming} />);
	}
	if (item.toolCalls.length > 0) {
		for (const tc of item.toolCalls) {
			parts.push(<ToolCallCard key={key++} tc={tc} />);
		}
	}
	if (item.text) {
		parts.push(
			<div key={key++} className="md">
				<ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
					{item.text}
				</ReactMarkdown>
				{item.streaming && <span className="stream-caret" />}
			</div>,
		);
	}
	if (!item.text && !item.thinking && item.toolCalls.length === 0 && item.streaming) {
		parts.push(<div key={key++} className="flex items-center gap-1.5 py-1.5"><SpectrumWave /></div>);
	}
	return <>{parts}</>;
}

export const MessageItem = memo(function MessageItem({ item, animate }: { item: ChatItem; animate?: boolean }) {
	if (item.role === "user") {
		return (
			<div className={cn("flex justify-end px-1 py-1", animate && "row-in")}>
				<div className="max-w-[70%] rounded-md border border-line bg-inset px-4 py-2.5 text-sm leading-relaxed text-ink whitespace-pre-wrap">
					{item.text}
				</div>
			</div>
		);
	}
	return (
		<div className={cn("px-1 py-1", animate && "row-in")}>
			<MessageBody item={item} />
		</div>
	);
});

// ---------------------------------------------------------------- list

function WaitingBubble({ status }: { status: string }) {
	const text =
		status === "starting" || status === "stopped"
			? "正在启动会话（拉起 pi 子进程）…"
			: status === "crashed"
				? "会话已崩溃，请点击左栏「重新拉起」"
				: "已发送，等待模型响应…";
	return (
		<div className="px-1 py-1">
			<div className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 text-xs text-ink-dim">
				{status === "crashed" ? (
					<X size={11} className="text-alarm" />
				) : (
					<SpectrumWave />
				)}
				{text}
			</div>
		</div>
	);
}

function EmptyState() {
	return (
		<div className="relative flex h-full flex-col items-center justify-center gap-4 overflow-hidden">
			<div className="calib-grid pointer-events-none absolute inset-0" aria-hidden />
			<div className="pop-spring [animation-delay:120ms]">
				<div className="drop-shadow-[0_20px_50px_rgba(109,125,255,0.28)]">
					<PiMark size={96} live />
				</div>
			</div>
			<span className="pi-digits">3.14159 26535 89793 23846 26433</span>
			<div className="fade-swap [animation-delay:1100ms] mt-1 flex flex-col items-center gap-2">
				<h2 className="font-display text-xl font-semibold tracking-wide text-ink">给数字员工下达第一个任务</h2>
				<span className="text-2xs text-ink-faint">发送消息开始 · Enter 发送 · Shift+Enter 换行</span>
			</div>
		</div>
	);
}

export function MessageList({ items, sessionStatus }: {
	items: ChatItem[];
	sessionStatus: string;
}) {
	const ref = useRef<HTMLDivElement>(null);
	const stick = useRef(true);
	const seenKeys = useRef<Set<string>>(new Set());

	useEffect(() => {
		const el = ref.current;
		if (el && stick.current) el.scrollTop = el.scrollHeight;
	}, [items]);

	const isEmpty = items.length === 0;

	return (
		<div
			ref={ref}
			className="flex-1 overflow-y-auto"
			onScroll={(e) => {
				const el = e.currentTarget;
				stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
			}}
		>
			{isEmpty ? (
				<EmptyState />
			) : (
				<div className="mx-auto max-w-[860px] px-5 py-4">
					{items.map((it) => {
						const key = it.key;
						const isNew = seenKeys.current.size > 0 && !seenKeys.current.has(key);
						seenKeys.current.add(key);
						return it.placeholder === "waiting" ? (
							<WaitingBubble key={key} status={sessionStatus} />
						) : (
							<MessageItem key={key} item={it} animate={isNew} />
						);
					})}
				</div>
			)}
		</div>
	);
}
