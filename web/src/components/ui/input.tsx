import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/utils";

/* 焦点:边框亮至 line-lit(全局 :focus-visible 已有 ai 焦点环) */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
	({ className, ...props }, ref) => (
		<input
			ref={ref}
			className={cn(
				"h-8 w-full rounded-sm border border-line bg-well px-3 text-xs text-ink transition-colors outline-none placeholder:text-ink-faint focus:border-line-lit",
				className,
			)}
			{...props}
		/>
	),
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
	({ className, ...props }, ref) => (
		<textarea
			ref={ref}
			className={cn(
				"w-full rounded-sm border border-line bg-well px-3 py-2 text-sm text-ink transition-colors outline-none placeholder:text-ink-faint focus:border-line-lit",
				className,
			)}
			{...props}
		/>
	),
);
Textarea.displayName = "Textarea";
