import {
	Bot,
	Blocks,
	BookOpen,
	File,
	FileText,
	Globe,
	Image as ImageIcon,
	Map,
	MessageSquare,
	Monitor,
	Package,
	Puzzle,
	RefreshCw,
	Settings2,
	Target,
	Wrench,
	type LucideIcon,
} from "lucide-react";
import { cn } from "../lib/utils";

/** 服务端目录/已装项的 emoji → lucide 映射(覆盖 marketplace/catalog.ts 已知全部条目,未知识别兜底 Package)。 */
const BY_EMOJI: Record<string, LucideIcon> = {
	"🗺️": Map,
	"🎯": Target,
	"🤖": Bot,
	"🔄": RefreshCw,
	"🌐": Globe,
	"🧰": Wrench,
	"🧱": Blocks,
	"💬": MessageSquare,
	"🖥️": Monitor,
	"🧩": Puzzle,
	"📚": BookOpen,
	"📦": Package,
};

export function catalogIcon(icon: string): LucideIcon {
	return BY_EMOJI[icon.trim()] ?? Package;
}

/** 扩展名 → lucide 文件图标(替换原 emoji 版 extIcon)。 */
export function fileIcon(path: string): { Icon: LucideIcon; className: string } {
	const ext = path.split(".").pop()?.toLowerCase() ?? "";
	if (["png", "jpg", "jpeg", "gif", "webp", "bmp", "svg"].includes(ext))
		return { Icon: ImageIcon, className: "text-ok" };
	if (["md", "mdx", "txt"].includes(ext)) return { Icon: FileText, className: "text-ink-dim" };
	if (["json", "yaml", "yml", "toml"].includes(ext)) return { Icon: Settings2, className: "text-signal" };
	if (["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "sql"].includes(ext))
		return { Icon: File, className: "text-ink-dim" };
	return { Icon: File, className: "text-ink-faint" };
}

/** 品牌「π」星标:深空圆角芯片 + 思考光谱描边的 π 笔画 + 横杠右端一颗信号节点。
 *  全应用唯一身份符号;聊天空态复用为大号星标(size≈96)并挂 live——一粒月光沿横杠巡游到节点。
 *  渐变 id 全实例同值,文档内重复定义无害(引用解析到首个,值一致)。 */
export function PiMark({
	size = 28,
	live = false,
	className,
}: {
	size?: number;
	live?: boolean;
	className?: string;
}) {
	return (
		<svg
			width={size}
			height={size}
			viewBox="0 0 48 48"
			aria-hidden
			className={cn("shrink-0 select-none", className)}
		>
			<defs>
				<linearGradient id="pi-spectrum" x1="12" y1="34" x2="37" y2="14" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="#6d7dff" />
					<stop offset="0.5" stopColor="#a78bfa" />
					<stop offset="1" stopColor="#4fd6c8" />
				</linearGradient>
				<linearGradient id="pi-chip" x1="24" y1="1" x2="24" y2="47" gradientUnits="userSpaceOnUse">
					<stop offset="0" stopColor="#151c30" />
					<stop offset="1" stopColor="#0b101d" />
				</linearGradient>
			</defs>
			<rect x="1" y="1" width="46" height="46" rx="14" fill="url(#pi-chip)" stroke="rgba(255,255,255,0.13)" strokeWidth="1" />
			<path
				d="M12 17h24M18.5 17v15.5M29.5 17v15.5"
				stroke="url(#pi-spectrum)"
				strokeWidth="4.2"
				strokeLinecap="round"
				fill="none"
			/>
			<circle cx="36" cy="17" r="2.4" fill="#4fd6c8" />
			{live && <circle className="pi-orb" cx="36" cy="17" r="2.2" fill="#eef2ff" />}
		</svg>
	);
}
