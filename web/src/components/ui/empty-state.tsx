import type { ReactNode } from "react";
import { cn } from "../../lib/utils";

/** 统一空态:图标 + 一句话 + 可选补充/动作。icon 接受任意 ReactNode(含 PiMonogram)。 */
export function EmptyState({
	icon,
	title,
	hint,
	action,
	className,
}: {
	icon?: ReactNode;
	title: string;
	hint?: string;
	action?: ReactNode;
	className?: string;
}) {
	return (
		<div
			className={cn(
				"flex flex-col items-center justify-center gap-1 px-6 py-10 text-center",
				className,
			)}
		>
			{icon && <div className="mb-1.5 text-ink-faint">{icon}</div>}
			<div className="text-xs text-ink-dim">{title}</div>
			{hint && <div className="max-w-[300px] text-2xs leading-relaxed text-ink-faint">{hint}</div>}
			{action && <div className="mt-3">{action}</div>}
		</div>
	);
}
