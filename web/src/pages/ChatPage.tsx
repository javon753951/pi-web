import { useCallback, useEffect, useRef, useState } from "react";
import { useApp } from "../store";
import { LeftSidebar } from "../components/layout/LeftSidebar";
import { TopBar } from "../components/layout/TopBar";
import { StatusBar } from "../components/layout/StatusBar";
import { RightPanel } from "../components/layout/RightPanel";
import { MessageList } from "../components/chat/MessageList";
import { Composer } from "../components/chat/Composer";
import { MarketplacePage } from "./MarketplacePage";
import { SettingsPage } from "./SettingsPage";

const MIN_LEFT = 180;
const MAX_LEFT = 420;
const MIN_RIGHT = 220;
const MAX_RIGHT = 480;
const NARROW_BREAKPOINT = 1100;
const MOBILE_BREAKPOINT = 768;

/** 铣槽分隔条:1px 发丝线全高贯通(板块从同一块台面铣出),悬停亮起并露出抓握 pill。 */
function Milled({ onDrag, delay = 0 }: { onDrag: (e: React.MouseEvent) => void; delay?: number }) {
	return (
		<div
			className="group fade-rise relative flex w-[9px] shrink-0 cursor-col-resize items-center justify-center [animation-delay:var(--d,0ms)]"
			style={{ ["--d" as string]: `${delay}ms` }}
			onMouseDown={onDrag}
		>
			<div className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors duration-200 group-hover:bg-line-lit" />
			<div className="relative z-10 h-10 w-[5px] rounded-full bg-line-lit opacity-0 transition-opacity duration-150 group-hover:opacity-100" />
		</div>
	);
}

export function ChatPage() {
	const { currentSessionId, messages, status, bootstrap } = useApp();
	const [leftW, setLeftW] = useState(248);
	const [rightW, setRightW] = useState(324);
	// 窄屏默认收起右栏:否则抽屉+遮罩一进来就盖住聊天主体
	const [rightOpen, setRightOpen] = useState(window.innerWidth >= NARROW_BREAKPOINT);
	const [view, setView] = useState<"chat" | "marketplace">("chat");
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [narrow, setNarrow] = useState(window.innerWidth < NARROW_BREAKPOINT);
	const [mobile, setMobile] = useState(window.innerWidth < MOBILE_BREAKPOINT);
	const [sidebarOpen, setSidebarOpen] = useState(false);
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		void bootstrap();
	}, [bootstrap]);

	useEffect(() => {
		const onResize = () => {
			setNarrow(window.innerWidth < NARROW_BREAKPOINT);
			setMobile(window.innerWidth < MOBILE_BREAKPOINT);
		};
		window.addEventListener("resize", onResize);
		return () => window.removeEventListener("resize", onResize);
	}, []);

	// 抽屉 Escape 关闭(移动端侧栏优先)
	useEffect(() => {
		if (!sidebarOpen && !(narrow && rightOpen)) return;
		const onKey = (e: KeyboardEvent) => {
			if (e.key !== "Escape") return;
			if (sidebarOpen) setSidebarOpen(false);
			else setRightOpen(false);
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [sidebarOpen, narrow, rightOpen]);

	// 拖拽分隔条
	const startDrag = useCallback(
		(side: "left" | "right") => (e: React.MouseEvent) => {
			e.preventDefault();
			const startX = e.clientX;
			const startW = side === "left" ? leftW : rightW;
			const onMove = (ev: MouseEvent) => {
				const delta = side === "left" ? ev.clientX - startX : startX - ev.clientX;
				const min = side === "left" ? MIN_LEFT : MIN_RIGHT;
				const max = side === "left" ? MAX_LEFT : MAX_RIGHT;
				const w = Math.max(min, Math.min(max, startW + delta));
				if (side === "left") setLeftW(w);
				else setRightW(w);
			};
			const onUp = () => {
				window.removeEventListener("mousemove", onMove);
				window.removeEventListener("mouseup", onUp);
				document.body.style.cursor = "";
				document.body.style.userSelect = "";
			};
			document.body.style.cursor = "col-resize";
			document.body.style.userSelect = "none";
			window.addEventListener("mousemove", onMove);
			window.addEventListener("mouseup", onUp);
		},
		[leftW, rightW],
	);

	const sessionId = currentSessionId;
	const items = sessionId ? messages[sessionId] ?? [] : [];
	const st = sessionId ? status[sessionId] : "stopped";

	return (
		<div ref={containerRef} className="flex h-full flex-col overflow-hidden p-2">
			{/* 仪表台:一整块铣切甲板——左/中/右以发丝槽分隔,底部状态条同板收口 */}
			<div className="slab pane-rise flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl">
				<div className="flex min-h-0 flex-1">
					{/* 左栏:宽屏为台面第一铣区(开机第一步点亮) / 移动端抽屉 */}
					{!mobile && (
						<div
							style={{ width: narrow ? 210 : leftW, minWidth: narrow ? 0 : MIN_LEFT }}
							className="fade-rise h-full shrink-0 overflow-hidden [animation-delay:60ms]"
						>
							<LeftSidebar onOpenMarketplace={() => setView("marketplace")} />
						</div>
					)}
					{!mobile && <Milled onDrag={startDrag("left")} delay={120} />}

					{/* 中栏:聊天三件套 / 技能广场(壳内渲染,顶栏常驻) */}
					<main className="flex h-full min-w-0 flex-1 flex-col overflow-hidden">
						<TopBar
							view={view}
							onView={setView}
							mobile={mobile}
							onOpenSidebar={() => setSidebarOpen(true)}
							onOpenSettings={() => setSettingsOpen(true)}
							onToggleRight={() => setRightOpen(!rightOpen)}
							rightOpen={rightOpen}
						/>
						{view === "chat" ? (
							<div key="chat" className="fade-rise flex min-h-0 flex-1 flex-col [animation-delay:120ms]">
								<MessageList items={items} sessionStatus={st} />
								<Composer disabled={!sessionId || st === "crashed"} />
							</div>
						) : (
							<div key="market" className="fade-rise flex min-h-0 flex-1 flex-col [animation-delay:120ms]">
								<MarketplacePage />
							</div>
						)}
					</main>

					{/* 右栏:宽屏为台面第三铣区 / 窄屏浮层抽屉(带遮罩 + Escape) */}
					{view === "chat" && !narrow && rightOpen && (
						<>
							<Milled onDrag={startDrag("right")} delay={180} />
							<div
								style={{ width: rightW, minWidth: MIN_RIGHT }}
								className="fade-rise h-full shrink-0 overflow-hidden [animation-delay:180ms]"
							>
								<RightPanel />
							</div>
						</>
					)}
					{view === "chat" && narrow && rightOpen && (
						<>
							<div
								className="fade-swap fixed inset-0 z-(--z-backdrop) bg-black/50 backdrop-blur-[2px]"
								onClick={() => setRightOpen(false)}
							/>
							<div className="glass drawer-up fixed inset-y-0 right-0 z-(--z-drawer) w-[min(360px,90vw)] overflow-hidden rounded-l-xl">
								<RightPanel />
							</div>
						</>
					)}

					{/* 移动端左栏抽屉 */}
					{mobile && sidebarOpen && (
						<>
							<div
								className="fade-swap fixed inset-0 z-(--z-backdrop) bg-black/50 backdrop-blur-[2px]"
								onClick={() => setSidebarOpen(false)}
							/>
							<div className="glass-panel fixed inset-y-0 left-0 z-(--z-drawer) w-[min(280px,85vw)] overflow-hidden rounded-r-xl">
								<LeftSidebar onOpenMarketplace={() => { setSidebarOpen(false); setView("marketplace"); }} />
							</div>
						</>
					)}
				</div>

				{/* 底部状态条:与台面同板,发丝线收口,可折叠(折叠后零残留) */}
				<StatusBar />
			</div>

			<SettingsPage open={settingsOpen} onClose={() => setSettingsOpen(false)} />
		</div>
	);
}
