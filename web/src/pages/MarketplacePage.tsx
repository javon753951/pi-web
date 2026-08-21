import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Download, Package, Puzzle, BookOpen, Search, Store, X } from "lucide-react";
import { api } from "../lib/api";
import { Button } from "../components/ui/button";
import { Tabs } from "../components/ui/tabs";
import { Spinner } from "../components/ui/misc";
import { Input } from "../components/ui/input";
import { EmptyState } from "../components/ui/empty-state";
import { catalogIcon } from "../components/icons";
import { cn } from "../lib/utils";
import type { LucideIcon } from "lucide-react";
import type { CatalogItem, InstalledItem, SearchHit } from "../lib/types";

type LogLine = { type: "log" | "done" | "error"; text?: string; message?: string; code?: number | null };

// ---------------------------------------------------------------- card

function PackageCard({
	name,
	Icon,
	description,
	tags,
	version,
	installed,
	spec,
	onInstall,
	installing,
}: {
	name: string;
	Icon: LucideIcon;
	description: string;
	tags: string[];
	version?: string;
	installed?: boolean;
	spec: string | null;
	onInstall: (spec: string) => void;
	installing?: boolean;
}) {
	return (
		<div className="flex flex-col gap-2 rounded-md border border-line bg-surface p-3.5 transition-all duration-150 hover:-translate-y-px hover:border-line-lit hover:bg-surface-lit hover:shadow-soft">
			<div className="flex items-center gap-2.5">
				<div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-sm bg-inset text-ink-dim">
					<Icon size={16} />
				</div>
				<div className="min-w-0">
					<div className="truncate font-mono text-xs font-semibold text-ink">{name}</div>
					{version && <div className="text-2xs tnum text-ink-faint">v{version}</div>}
				</div>
			</div>
			<p className="min-h-[34px] text-2xs leading-relaxed text-ink-dim">{description}</p>
			<div className="flex flex-wrap gap-1">
				{tags.map((t) => (
					<span key={t} className="rounded-sm border border-line bg-well px-1.5 py-0.5 text-2xs text-ink-faint">
						{t}
					</span>
				))}
			</div>
			<div className="mt-auto flex items-center">
				{installed ? (
					<span className="chip-in ml-auto flex items-center gap-1 rounded-sm border border-ok/30 bg-ok/10 px-2.5 py-1 text-2xs font-medium text-ok">
						<Check size={11} /> 已安装
					</span>
				) : spec ? (
					<Button variant="soft" size="sm" className="ml-auto" disabled={installing} onClick={() => onInstall(spec)}>
						{installing ? <Spinner className="h-3 w-3" /> : null} 安装
					</Button>
				) : (
					<span className="ml-auto rounded-sm border border-signal/30 bg-signal/10 px-2 py-1 text-2xs font-medium text-signal">
						路线图
					</span>
				)}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- log drawer

function InstallLogDrawer({ title, lines, done, onClose }: { title: string; lines: LogLine[]; done: boolean; onClose: () => void }) {
	const bodyRef = useRef<HTMLDivElement>(null);
	useEffect(() => {
		bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
	}, [lines]);
	return (
		<div className="drawer-up fixed inset-x-0 bottom-0 z-[var(--z-logdrawer)] flex h-[240px] flex-col border-t border-machine-line bg-machine [box-shadow:inset_0_1px_0_rgba(255,255,255,0.04),0_-10px_40px_rgba(16,24,40,0.12)]">
			<div className="flex items-center gap-2.5 border-b border-machine-line px-4 py-2 text-xs font-medium text-machine-ink">
				{!done && <Spinner />}
				<span>{title}</span>
				<span className="ml-auto" />
				<Button variant="secondary" size="sm" className="h-6 px-2 text-2xs" onClick={onClose}>
					关闭
				</Button>
			</div>
			<div
				ref={bodyRef}
				className="machine-scroll flex-1 overflow-y-auto px-4 py-2 font-mono text-2xs leading-relaxed"
			>
				{lines.map((l, i) => (
					<div
						key={i}
						className={cn(
							"whitespace-pre-wrap break-all text-machine-dim",
							l.type === "done" && "text-machine-ok",
							l.type === "error" && "text-machine-alarm",
						)}
					>
						{l.text ?? l.message}
					</div>
				))}
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- page

export function MarketplacePage() {
	const [tab, setTab] = useState<"installed" | "catalog" | "search">("installed");
	const [catalog, setCatalog] = useState<CatalogItem[]>([]);
	const [installed, setInstalled] = useState<InstalledItem[]>([]);
	const [hits, setHits] = useState<SearchHit[]>([]);
	const [query, setQuery] = useState("");
	const [searching, setSearching] = useState(false);
	const [loading, setLoading] = useState(true);
	const [searchError, setSearchError] = useState<string | null>(null);
	const [log, setLog] = useState<{ title: string; lines: LogLine[]; done: boolean } | null>(null);
	const [installingSpec, setInstallingSpec] = useState<string | null>(null);

	const load = useCallback(async () => {
		setLoading(true);
		try {
			const [cat, inst] = await Promise.all([
				api.get<{ catalog: CatalogItem[] }>("/api/marketplace/catalog"),
				api.get<{ installed: InstalledItem[] }>("/api/marketplace/installed"),
			]);
			setCatalog(cat.catalog);
			setInstalled(inst.installed);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void load();
	}, [load]);

	const installedNames = new Set(installed.map((i) => i.name));

	const doSearch = async (q: string) => {
		if (!q.trim()) return;
		setSearchError(null);
		setSearching(true);
		try {
			const data = await api.get<{ hits: SearchHit[] }>(`/api/marketplace/search?q=${encodeURIComponent(q)}`);
			setHits(data.hits);
			setTab("search");
		} catch (err) {
			setSearchError(err instanceof Error ? err.message : "搜索失败");
		} finally {
			setSearching(false);
		}
	};

	const install = async (spec: string) => {
		setInstallingSpec(spec);
		const lines: LogLine[] = [];
		setLog({ title: `正在安装 ${spec.replace(/^npm:/, "")} …`, lines, done: false });
		try {
			const { lines: stream } = api.stream("/api/marketplace/install", { spec });
			for await (const line of stream) {
				lines.push(line as LogLine);
				setLog({ title: `正在安装 ${spec.replace(/^npm:/, "")} …`, lines: [...lines], done: false });
			}
			setLog((prev) => ({ ...prev!, lines, done: true }));
			await load();
		} catch (err) {
			lines.push({ type: "error", message: err instanceof Error ? err.message : "安装失败" });
			setLog({ title: `安装失败 ${spec.replace(/^npm:/, "")}`, lines, done: true });
		} finally {
			setInstallingSpec(null);
		}
	};

	return (
		<div className="flex h-full flex-col overflow-hidden">
			<div className="flex shrink-0 items-center gap-3 border-b border-line px-6 py-4">
				<div>
					<h2 className="flex items-center gap-2 font-display text-lg font-medium text-ink">
						<Store size={16} className="text-ink-dim" /> 技能广场
					</h2>
					<p className="text-2xs text-ink-faint">安装扩展与技能，重启会话后生效</p>
				</div>
				<div className="ml-auto flex items-center gap-2">
					<Input
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						onKeyDown={(e) => e.key === "Enter" && void doSearch(query)}
						placeholder="搜索 npm 上的 pi 扩展…"
						className="w-64"
					/>
					<Button size="sm" onClick={() => void doSearch(query)} disabled={searching}>
						{searching ? <Spinner className="h-3 w-3" /> : <Search size={12} />} 搜索
					</Button>
				</div>
			</div>

			{searchError && (
				<div className="flex items-center gap-2 border-b border-alarm/30 bg-alarm/10 px-6 py-2 text-xs text-alarm">
					<span>{searchError}</span>
					<span className="ml-auto">
						<Button variant="ghost" size="icon" className="h-5 w-5" onClick={() => setSearchError(null)}>
							<X size={12} />
						</Button>
					</span>
				</div>
			)}

			<div className="border-b border-line px-6">
				<Tabs
					tabs={[
						{ key: "installed", label: `已安装 (${installed.length})` },
						{ key: "catalog", label: "精选目录" },
						{ key: "search", label: `搜索结果${hits.length ? ` (${hits.length})` : ""}` },
					]}
					active={tab}
					onChange={setTab}
				/>
			</div>

			<div className="flex-1 overflow-y-auto p-6">
				<div key={tab} className="fade-swap grid grid-cols-[repeat(auto-fill,minmax(270px,1fr))] gap-3">
					{loading ? (
						<div className="col-span-full flex justify-center py-16">
							<Spinner className="mr-2 h-3.5 w-3.5" />
							<span className="text-xs text-ink-faint">加载中…</span>
						</div>
					) : tab === "installed" ? (
						installed.length === 0 ? (
							<EmptyState icon={<Package size={32} />} title="未发现已安装的扩展/技能/包" />
						) : (
							installed.map((i) => (
								<PackageCard
									key={i.name}
									name={i.name}
									Icon={i.source === "extension" ? Puzzle : i.source === "skill" ? BookOpen : Package}
									description={i.description ?? (i.source === "extension" ? "本地扩展" : i.source === "skill" ? "本地技能" : "npm 包")}
									tags={[i.source, ...Object.keys(i.piField ?? {})]}
									version={i.version}
									installed
									spec={null}
									onInstall={() => {}}
								/>
							))
						)
					) : tab === "catalog" ? (
						catalog.map((p) => (
							<PackageCard
								key={p.name}
								name={p.name}
								Icon={catalogIcon(p.icon)}
								description={p.description}
								tags={[p.category, ...p.tags]}
								installed={installedNames.has(p.name)}
								spec={p.spec}
								installing={installingSpec === p.spec}
								onInstall={install}
							/>
						))
					) : hits.length === 0 ? (
						<EmptyState icon={<Search size={32} />} title="输入关键词搜索 npm 上的 pi 扩展（需含 pi 字段的包）" />
					) : (
						hits.map((h) => (
							<PackageCard
								key={h.name}
								name={h.name}
								Icon={Package}
								description={h.description}
								tags={h.keywords?.slice(0, 4) ?? []}
								version={h.version}
								installed={installedNames.has(h.name)}
								spec={`npm:${h.name}`}
								installing={installingSpec === `npm:${h.name}`}
								onInstall={install}
							/>
						))
					)}
				</div>
			</div>

			{log && <InstallLogDrawer title={log.title} lines={log.lines} done={log.done} onClose={() => setLog(null)} />}
		</div>
	);
}
