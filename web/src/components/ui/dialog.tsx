import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { cn } from "../../lib/utils";
import { Button } from "./button";

const FOCUSABLE =
	"button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])";

/** 对话框:磨砂玻璃浮层 + 焦点陷阱(Tab 圈定/Escape/关闭还原焦点)。 */
export function Dialog({
	open,
	onClose,
	title,
	subtitle,
	children,
	footer,
	width = "w-[620px]",
}: {
	open: boolean;
	onClose: () => void;
	title: string;
	subtitle?: string;
	children: ReactNode;
	footer?: ReactNode;
	width?: string;
}) {
	const panelRef = useRef<HTMLDivElement>(null);
	const restoreRef = useRef<HTMLElement | null>(null);

	useEffect(() => {
		if (!open) return;
		restoreRef.current = document.activeElement as HTMLElement | null;
		const raf = requestAnimationFrame(() => {
			panelRef.current?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
		});
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				onClose();
				return;
			}
			if (e.key === "Tab") {
				const focusables = panelRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE);
				if (!focusables || focusables.length === 0) return;
				const first = focusables[0]!;
				const last = focusables[focusables.length - 1]!;
				if (e.shiftKey && document.activeElement === first) {
					e.preventDefault();
					last.focus();
				} else if (!e.shiftKey && document.activeElement === last) {
					e.preventDefault();
					first.focus();
				}
			}
		};
		window.addEventListener("keydown", onKey);
		return () => {
			cancelAnimationFrame(raf);
			window.removeEventListener("keydown", onKey);
			restoreRef.current?.focus?.();
		};
	}, [open, onClose]);

	if (!open) return null;
	return (
		<div
			className="fade-swap fixed inset-0 z-(--z-modal) flex items-center justify-center bg-black/50 p-6 backdrop-blur-[3px]"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) onClose();
			}}
		>
			<div
				ref={panelRef}
				tabIndex={-1}
				className={cn(
					"glass pop-in max-h-[84vh] w-full max-w-[calc(100vw-48px)] overflow-y-auto rounded-lg border border-line p-6",
					width,
				)}
			>
				<div className="mb-1 flex items-start justify-between gap-4">
					<div>
						<h3 className="font-display text-lg font-medium text-ink">{title}</h3>
						{subtitle && <p className="mt-0.5 text-2xs text-ink-faint">{subtitle}</p>}
					</div>
					<Button variant="ghost" size="icon" onClick={onClose} className="h-7 w-7 shrink-0" title="关闭">
						<X size={15} />
					</Button>
				</div>
				<div className="mt-4">{children}</div>
				{footer && <div className="mt-5 flex justify-end gap-2">{footer}</div>}
			</div>
		</div>
	);
}
