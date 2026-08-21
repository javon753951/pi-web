export interface CatalogItem {
	name: string;
	spec: string | null; // null = 官方路线图条目（不可直接安装）
	description: string;
	category: "planning" | "workflow" | "subagents" | "webui" | "utils" | "official" | "memory";
	tags: string[];
	author: string;
	icon: string;
	experimental?: boolean;
}

/**
 * 内置精选目录（M0 盘点结果）。
 * 安装形式：pi install npm:<name>。spec=null 的条目为官方方向/路线图，不可安装。
 */
export const CATALOG: CatalogItem[] = [
	{
		name: "@narumitw/pi-plan-mode",
		spec: "npm:@narumitw/pi-plan-mode",
		description: "只读 /plan 协作模式：把大任务拆成可执行计划，逐项推进，规划与执行分离。",
		category: "planning",
		tags: ["planning", "codex"],
		author: "@narumitw",
		icon: "🗺️",
	},
	{
		name: "@narumitw/pi-goal",
		spec: "npm:@narumitw/pi-goal",
		description: "为目标设定里程碑与验收标准，周期性自我检视进度，适合长周期任务。",
		category: "planning",
		tags: ["goals", "agentic"],
		author: "@narumitw",
		icon: "🎯",
	},
	{
		name: "@tintinweb/pi-subagents",
		spec: "npm:@tintinweb/pi-subagents",
		description: "让主 agent 派生并行子代理处理独立子任务，隔离上下文窗口，支持多子代理。",
		category: "subagents",
		tags: ["subagents", "parallel"],
		author: "@tintinweb",
		icon: "🤖",
	},
	{
		name: "@quintinshaw/pi-dynamic-workflows",
		spec: "npm:@quintinshaw/pi-dynamic-workflows",
		description: "JS 工作流脚本编排多代理：deep-research / code-review / 对抗评审 / codebase-audit 内置模式。",
		category: "workflow",
		tags: ["workflow", "research"],
		author: "@quintinshaw",
		icon: "🔄",
	},
	{
		name: "@firstpick/pi-package-webui",
		spec: "npm:@firstpick/pi-package-webui",
		description: "Pi 官方参考实现的浏览器 Web UI 包（RPC 子进程模式），本服务同款架构。",
		category: "webui",
		tags: ["webui", "official"],
		author: "@firstpick",
		icon: "🌐",
	},
	{
		name: "@firstpick/pi-utils",
		spec: "npm:@firstpick/pi-utils",
		description: "常用小工具集：会话摘要、工作区管理、Web 辅助等共享工具。",
		category: "utils",
		tags: ["utils"],
		author: "@firstpick",
		icon: "🧰",
	},
	{
		name: "@narumitw/pi-tui-kit",
		spec: "npm:@narumitw/pi-tui-kit",
		description: "TUI 组件工具包：声明式 UI 流程与导航助手，扩展开发者的界面组件库。",
		category: "utils",
		tags: ["tui", "dev"],
		author: "@narumitw",
		icon: "🧱",
	},
	{
		name: "pi-chat",
		spec: null,
		description: "官方方向：Chat 类扩展骨架（官方维护，路线图条目）。",
		category: "official",
		tags: ["official", "roadmap"],
		author: "earendil-works",
		icon: "💬",
		experimental: true,
	},
	{
		name: "pi-server",
		spec: null,
		description: "官方方向：实验性 CBOR RPC 服务（仅 Unix socket，不稳定；本服务已用 RPC 子进程方案替代）。",
		category: "official",
		tags: ["official", "experimental"],
		author: "earendil-works",
		icon: "🖥️",
		experimental: true,
	},
];
