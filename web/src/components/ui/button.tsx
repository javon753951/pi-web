import { forwardRef, type ButtonHTMLAttributes } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

/* 唯一悬停语言:发丝线亮至 line-lit + 底色升一级;焦点环走全局 :focus-visible(ai)。
   色彩纪律:主动作 = 月光白实心(无彩色 = 人);彩色只属于机器。 */
const buttonVariants = cva(
	"inline-flex cursor-pointer items-center justify-center gap-1.5 rounded-sm text-xs font-semibold transition-all duration-150 select-none active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 whitespace-nowrap",
	{
		variants: {
			variant: {
				default:
					"bg-act text-act-ink shadow-[0_1px_2px_rgba(0,0,0,0.4),inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-white",
				secondary:
					"border border-line bg-surface text-ink-dim hover:border-line-lit hover:bg-inset hover:text-ink",
				ghost: "text-ink-dim hover:bg-inset hover:text-ink",
				danger: "border border-alarm/35 bg-alarm/10 text-alarm hover:bg-alarm/16",
				soft: "border border-line bg-well text-ink hover:border-line-lit hover:bg-surface",
			},
			size: {
				default: "h-8 px-3.5",
				sm: "h-7 px-2.5",
				icon: "h-8 w-8 p-0",
				lg: "h-9 px-5",
			},
		},
		defaultVariants: { variant: "default", size: "default" },
	},
);

export interface ButtonProps
	extends ButtonHTMLAttributes<HTMLButtonElement>,
		VariantProps<typeof buttonVariants> {}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
	({ className, variant, size, type = "button", ...props }, ref) => (
		<button ref={ref} type={type} className={cn(buttonVariants({ variant, size }), className)} {...props} />
	),
);
Button.displayName = "Button";
