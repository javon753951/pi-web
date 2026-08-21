import type { HTMLAttributes } from "react";
import { cn } from "../../lib/utils";

export function Badge({ className, ...props }: HTMLAttributes<HTMLSpanElement>) {
	return (
		<span
			className={cn(
				"inline-flex items-center gap-1 rounded-full border border-line bg-inset px-2.5 py-0.5 text-2xs font-semibold text-ink-dim",
				className,
			)}
			{...props}
		/>
	);
}

export function Spinner({ className }: { className?: string }) {
	return (
		<span
			className={cn(
				"inline-block h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-line-lit border-t-ink",
				className,
			)}
		/>
	);
}

/** 四态 LED:stopped 灰 / starting 琥珀 1s 脉冲 / running 绿 2s 辉光环 / crashed 红 */
export function StatusDot({ status, className }: { status: string; className?: string }) {
	return (
		<span
			className={cn(
				"inline-block h-[7px] w-[7px] shrink-0 rounded-full",
				status === "running" && "bg-ok led-running",
				status === "starting" && "bg-signal led-starting",
				status === "crashed" && "bg-alarm",
				(status === "stopped" || !status) && "bg-ink-faint/50",
				className,
			)}
		/>
	);
}
