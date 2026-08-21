import type { LucideIcon } from "lucide-react";
import { cn } from "../../lib/utils";

export function Tabs<T extends string>({
	tabs,
	active,
	onChange,
	className,
}: {
	tabs: Array<{ key: T; label: string; icon?: LucideIcon; count?: number }>;
	active: T;
	onChange: (key: T) => void;
	className?: string;
}) {
	const idx = Math.max(0, tabs.findIndex((t) => t.key === active));
	return (
		<div
			className={cn(
				"relative flex auto-cols-fr grid-flow-col rounded-md border border-line bg-well p-0.5",
				className,
			)}
			role="tablist"
		>
			<span
				aria-hidden
				className="seg-thumb absolute inset-y-0.5 left-0.5 rounded-[5px] bg-surface-lit shadow-[0_1px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]"
				style={{
					width: `calc((100% - 4px) / ${Math.max(1, tabs.length)})`,
					transform: `translateX(${idx * 100}%)`,
				}}
			/>
			{tabs.map((t) => (
				<button
					key={t.key}
					type="button"
					role="tab"
					aria-selected={active === t.key}
					onClick={() => onChange(t.key)}
					className={cn(
						"relative z-10 flex flex-1 cursor-pointer items-center justify-center gap-1.5 rounded-[5px] px-2 py-1.5 text-xs font-medium transition-colors",
						active === t.key ? "text-ink" : "text-ink-faint hover:text-ink-dim",
					)}
				>
					{t.icon && <t.icon size={13} />}
					{t.label}
					{t.count !== undefined && t.count > 0 && (
						<span className="tnum ml-0.5 rounded-full bg-ai-soft px-1.5 py-px font-mono text-[10px] font-semibold text-ai-bright">
							{t.count}
						</span>
					)}
				</button>
			))}
		</div>
	);
}

/** 视图分段切换器:等宽网格 + 滑动指示药丸(180ms 滑移,与 Tabs 同语言)。 */
export function Segmented<T extends string>({
	options,
	value,
	onChange,
	ariaLabel,
}: {
	options: Array<{ value: T; label: string }>;
	value: T;
	onChange: (v: T) => void;
	ariaLabel?: string;
}) {
	const idx = Math.max(0, options.findIndex((o) => o.value === value));
	return (
		<div
			aria-label={ariaLabel}
			className="relative inline-grid h-7 auto-cols-fr grid-flow-col rounded-md border border-line bg-well p-0.5"
		>
			<span
				aria-hidden
				className="seg-thumb absolute inset-y-0.5 left-0.5 rounded-[5px] bg-surface-lit shadow-[0_1px_4px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.06)]"
				style={{
					width: `calc((100% - 4px) / ${options.length})`,
					transform: `translateX(${idx * 100}%)`,
				}}
			/>
			{options.map((o) => (
				<button
					key={o.value}
					type="button"
					aria-pressed={o.value === value}
					onClick={() => onChange(o.value)}
					className={cn(
						"relative z-10 h-full cursor-pointer rounded-[5px] px-3 text-xs font-medium transition-colors",
						o.value === value ? "text-ink" : "text-ink-faint hover:text-ink-dim",
					)}
				>
					{o.label}
				</button>
			))}
		</div>
	);
}
