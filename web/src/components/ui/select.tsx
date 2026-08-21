import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

export interface SelectOption {
	value: string;
	label: string;
}

/**
 * 自绘 Select(键盘 listbox):方向键/Home/End/首字母 typeahead/Escape/Enter,
 * 焦点始终留在触发器。弹层为磨砂玻璃,自动测量上下空间翻转。
 * 无 portal:要求触发器祖先无 overflow 裁剪(Composer 场景满足)。
 */
export function Select({
	value,
	onChange,
	options,
	ariaLabel,
	className,
}: {
	value: string;
	onChange: (v: string) => void;
	options: SelectOption[];
	ariaLabel?: string;
	className?: string;
}) {
	const [open, setOpen] = useState(false);
	const [active, setActive] = useState(0);
	const [dropUp, setDropUp] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);
	const triggerRef = useRef<HTMLButtonElement>(null);
	const listRef = useRef<HTMLDivElement>(null);
	const typeBuf = useRef("");
	const typeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const listId = useId();

	const selected = options.findIndex((o) => o.value === value);

	const close = useCallback(() => {
		setOpen(false);
		setActive(Math.max(0, selected));
	}, [selected]);

	// 外点关闭
	useEffect(() => {
		if (!open) return;
		const onDown = (e: MouseEvent) => {
			if (!rootRef.current?.contains(e.target as Node)) close();
		};
		window.addEventListener("mousedown", onDown);
		return () => window.removeEventListener("mousedown", onDown);
	}, [open, close]);

	// 打开时测量翻转 + 滚动到选中项
	useLayoutEffect(() => {
		if (!open || !triggerRef.current) return;
		const r = triggerRef.current.getBoundingClientRect();
		const need = Math.min(280, options.length * 30 + 10);
		setDropUp(window.innerHeight - r.bottom < need && r.top > need);
	}, [open, options.length]);

	useLayoutEffect(() => {
		if (!open || !listRef.current) return;
		listRef.current.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: "nearest" });
	}, [open]);

	// 高亮项跟随键盘滚动
	useEffect(() => {
		if (!open || !listRef.current) return;
		listRef.current.querySelector(`[data-idx="${active}"]`)?.scrollIntoView({ block: "nearest" });
	}, [active, open]);

	const commit = (i: number) => {
		const o = options[i];
		if (!o) return;
		onChange(o.value);
		setActive(i);
		setOpen(false);
	};

	const onKeyDown = (e: React.KeyboardEvent) => {
		if (!open) {
			if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown" || e.key === "ArrowUp") {
				e.preventDefault();
				setActive(Math.max(0, selected));
				setOpen(true);
			}
			return;
		}
		switch (e.key) {
			case "ArrowDown":
				e.preventDefault();
				setActive((a) => Math.min(options.length - 1, a + 1));
				break;
			case "ArrowUp":
				e.preventDefault();
				setActive((a) => Math.max(0, a - 1));
				break;
			case "Home":
				e.preventDefault();
				setActive(0);
				break;
			case "End":
				e.preventDefault();
				setActive(options.length - 1);
				break;
			case "Enter":
			case " ":
				e.preventDefault();
				commit(active);
				break;
			case "Escape":
				e.preventDefault();
				close();
				break;
			case "Tab":
				close();
				break;
			default:
				// typeahead:300ms 间隔重置缓冲
				if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && /\S/.test(e.key)) {
					e.preventDefault();
					if (typeTimer.current) clearTimeout(typeTimer.current);
					typeBuf.current = (typeBuf.current + e.key.toLowerCase()).slice(-16);
					typeTimer.current = setTimeout(() => {
						typeBuf.current = "";
					}, 300);
					const idx = options.findIndex((o) => o.label.toLowerCase().startsWith(typeBuf.current));
					if (idx >= 0) setActive(idx);
				}
				break;
		}
	};

	const current = selected >= 0 ? options[selected] : undefined;

	return (
		<div ref={rootRef} className={cn("relative", className)}>
			<button
				ref={triggerRef}
				type="button"
				role="combobox"
				aria-haspopup="listbox"
				aria-expanded={open}
				aria-controls={listId}
				aria-label={ariaLabel}
				title={ariaLabel}
				onClick={() => {
					if (open) close();
					else {
						setActive(Math.max(0, selected));
						setOpen(true);
					}
				}}
				onKeyDown={onKeyDown}
				className="flex h-7 max-w-[220px] shrink-0 cursor-pointer items-center gap-1.5 rounded-sm border border-line bg-well px-2 font-mono text-2xs text-ink-dim transition-colors hover:border-line-lit hover:text-ink"
			>
				<span className="truncate">{current?.label ?? "—"}</span>
				<ChevronDown size={11} className={cn("shrink-0 text-ink-faint transition-transform", open && "rotate-180")} />
			</button>
			{open && (
				<div
					ref={listRef}
					id={listId}
					role="listbox"
					aria-label={ariaLabel}
					style={dropUp ? { bottom: "calc(100% + 4px)" } : { top: "calc(100% + 4px)" }}
					className="glass pop-in absolute z-(--z-sticky) max-h-[280px] w-max min-w-full overflow-y-auto rounded-sm border border-line p-1"
				>
					{options.map((o, i) => (
						<div
							key={o.value}
							role="option"
							aria-selected={i === selected}
							data-idx={i}
							onClick={() => commit(i)}
							onMouseEnter={() => setActive(i)}
							className={cn(
								"flex cursor-pointer items-center gap-1.5 rounded-sm px-2 py-1 font-mono text-2xs whitespace-nowrap transition-colors",
								i === active ? "bg-inset text-ink" : "text-ink-dim",
							)}
						>
							<span className="truncate">{o.label}</span>
							{i === selected && <Check size={11} className="ml-auto shrink-0 text-ai" />}
						</div>
					))}
				</div>
			)}
		</div>
	);
}
