import { useCallback, useEffect, useState } from "react";
import { Archive, ChevronDown, ChevronRight, Download, Folder, FolderOpen, Package, RefreshCw, Trash2, X } from "lucide-react";
import { useApp } from "../../store";
import { api, downloadUrl } from "../../lib/api";
import { Tabs } from "../ui/tabs";
import { Button } from "../ui/button";
import { EmptyState } from "../ui/empty-state";
import { fileIcon } from "../icons";
import { fmtBytes, fmtTime } from "../../lib/utils";
import type { FilePreview, TreeEntry } from "../../lib/types";
import { cn } from "../../lib/utils";

/** 触发浏览器下载（多选打包 zip）。paths 为工作区相对路径数组。 */
function downloadZip(sessionId: string, paths: string[]): void {
	if (paths.length === 0) return;
	const url = downloadUrl(`/api/sessions/${sessionId}/download-zip?paths=${encodeURIComponent(paths.join("\n"))}`);
	const a = document.createElement("a");
	a.href = url;
	a.download = "";
	document.body.appendChild(a);
	a.click();
	a.remove();
}

// ---------------------------------------------------------------- file tree

function TreeNode({
	entry,
	depth,
	sessionId,
	selected,
	selectedPaths,
	onToggle,
}: {
	entry: TreeEntry;
	depth: number;
	sessionId: string;
	selected: boolean;
	selectedPaths: Set<string>;
	onToggle: (path: string) => void;
}) {
	const [open, setOpen] = useState(false);
	const [children, setChildren] = useState<TreeEntry[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [preview, setPreview] = useState<FilePreview | null>(null);
	const [showPreview, setShowPreview] = useState(false);

	const load = useCallback(async () => {
		if (entry.type !== "dir") return;
		if (children !== null) {
			setOpen(!open);
			return;
		}
		setLoading(true);
		try {
			const data = await api.get<{ entries: TreeEntry[] }>(
				`/api/workspace/tree?session=${sessionId}&path=${encodeURIComponent(entry.path)}`,
			);
			setChildren(data.entries);
			setOpen(true);
		} catch {
			setChildren([]);
		} finally {
			setLoading(false);
		}
	}, [entry, children, open, sessionId]);

	const previewFile = async (e: React.MouseEvent) => {
		e.stopPropagation();
		try {
			const data = await api.get<FilePreview>(
				`/api/workspace/file?session=${sessionId}&path=${encodeURIComponent(entry.path)}`,
			);
			setPreview(data);
			setShowPreview(true);
		} catch {
			/* ignore */
		}
	};

	const fi = entry.type === "dir" ? null : fileIcon(entry.path);
	const Icon = fi?.Icon;
	const iconCls = fi?.className;

	return (
		<div>
			<div
				className="group flex cursor-pointer items-center gap-1.5 rounded-sm px-1.5 py-[3.5px] transition-colors hover:bg-inset"
				style={{ paddingLeft: 6 + depth * 13 }}
				onClick={load}
				onDoubleClick={previewFile}
			>
				<button
					type="button"
					className={cn(
						"size-2.5 shrink-0 cursor-pointer rounded-[2px] border transition-all",
						selected ? "border-ai bg-ai/80" : "border-line-lit bg-transparent opacity-0 group-hover:opacity-100",
					)}
					onClick={(e) => {
						e.stopPropagation();
						onToggle(entry.path);
					}}
					title={selected ? "取消选择" : "选择（可打包下载）"}
				/>
				<span className="w-3 text-center text-ink-faint">
					{entry.type === "dir" ? (open ? <ChevronDown size={10} /> : <ChevronRight size={10} />) : null}
				</span>
				{entry.type === "dir" ? (
					open ? <FolderOpen size={13} className="shrink-0 text-ink-dim" /> : <Folder size={13} className="shrink-0 text-ink-dim" />
				) : (
					Icon && <Icon size={13} className={cn("shrink-0", iconCls)} />
				)}
				<span className="truncate text-xs text-ink-dim group-hover:text-ink">{entry.name}</span>
				<span className="tnum ml-auto font-mono text-2xs text-ink-faint">
					{entry.size !== null ? fmtBytes(entry.size) : ""}
				</span>
			</div>
			{loading && (
				<div className="py-1 text-2xs text-ink-faint" style={{ paddingLeft: 20 + depth * 13 }}>
					加载中…
				</div>
			)}
			{open && children && (
				<div>
					{children.length === 0 && (
						<div className="py-0.5 text-2xs text-ink-faint" style={{ paddingLeft: 20 + depth * 13 }}>
							（空目录）
						</div>
					)}
					{children.map((c) => (
						<TreeNode
							key={c.path}
							entry={c}
							depth={depth + 1}
							sessionId={sessionId}
							selected={selectedPaths.has(c.path)}
							selectedPaths={selectedPaths}
							onToggle={onToggle}
						/>
					))}
				</div>
			)}
			{showPreview && preview && <FilePreviewView preview={preview} onClose={() => setShowPreview(false)} sessionId={sessionId} />}
		</div>
	);
}

function FilePreviewView({ preview, onClose, sessionId }: { preview: FilePreview; onClose: () => void; sessionId: string }) {
	useEffect(() => {
		const onKey = (e: KeyboardEvent) => {
			if (e.key === "Escape") onClose();
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [onClose]);

	return (
		<div
			className="fade-swap fixed inset-0 z-(--z-preview) flex items-center justify-center bg-black/50 p-8 backdrop-blur-[3px]"
			onClick={onClose}
		>
			<div
				className="glass pop-in flex max-h-[85vh] w-[720px] max-w-[92vw] flex-col overflow-hidden rounded-lg border border-line"
				onClick={(e) => e.stopPropagation()}
			>
				<div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
					<span className="truncate font-mono text-xs text-ink">{preview.path}</span>
					<span className="tnum font-mono text-2xs text-ink-faint">{fmtBytes(preview.size)}</span>
					<span className="ml-auto flex gap-1">
						<a
							href={downloadUrl(`/api/workspace/download?session=${sessionId}&path=${encodeURIComponent(preview.path)}`)}
							className="rounded-sm p-1.5 text-ink-dim transition-colors hover:bg-inset hover:text-ink"
							title="下载"
						>
							<Download size={14} />
						</a>
						<Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} title="关闭">
							<X size={14} />
						</Button>
					</span>
				</div>
				<div className="overflow-auto p-4">
					{preview.kind === "text" && (
						<pre className="machine-window machine-scroll max-h-[70vh] overflow-auto rounded-sm p-3 font-mono text-2xs leading-relaxed text-machine-ink whitespace-pre-wrap">
							{preview.content}
							{preview.truncated && <div className="mt-2 text-signal">（内容过长，仅显示前 512KB）</div>}
						</pre>
					)}
					{preview.kind === "image" && preview.dataUrl && (
						<img src={preview.dataUrl} alt={preview.name} className="mx-auto max-h-[70vh] object-contain" />
					)}
					{preview.kind === "binary" && (
						<EmptyState icon={<Package size={20} />} title="二进制文件，无法预览 — 请下载查看" />
					)}
				</div>
			</div>
		</div>
	);
}

// ---------------------------------------------------------------- right panel

export function RightPanel() {
	const { currentSessionId, artifacts, refreshArtifacts, deleteSession, workspaceVersion } = useApp();
	const [tab, setTab] = useState<"files" | "artifacts">("files");
	const [tree, setTree] = useState<TreeEntry[] | null>(null);
	const [loading, setLoading] = useState(false);
	const [refreshKey, setRefreshKey] = useState(0);
	const [selected, setSelected] = useState<Set<string>>(new Set());

	const sessionId = currentSessionId;
	const arts = sessionId ? artifacts[sessionId] ?? [] : [];

	useEffect(() => {
		setTree(null);
		setSelected(new Set());
		if (!sessionId) return;
		setLoading(true);
		api
			.get<{ entries: TreeEntry[] }>(`/api/workspace/tree?session=${sessionId}&path=`)
			.then((d) => setTree(d.entries))
			.catch(() => setTree([]))
			.finally(() => setLoading(false));
	}, [sessionId, refreshKey, workspaceVersion]);

	useEffect(() => {
		if (sessionId) void refreshArtifacts(sessionId);
	}, [sessionId, refreshKey, refreshArtifacts]);

	const toggleSelect = useCallback((path: string) => {
		setSelected((prev) => {
			const next = new Set(prev);
			if (next.has(path)) next.delete(path);
			else next.add(path);
			return next;
		});
	}, []);

	const removeArtifact = async (id: number) => {
		if (!sessionId) return;
		await api.del(`/api/sessions/${sessionId}/artifacts/${id}`);
		await refreshArtifacts(sessionId);
	};

	return (
		<aside className="flex h-full w-full flex-col">
			<Tabs
				tabs={[
					{ key: "files", label: "文件", icon: Folder },
					{ key: "artifacts", label: "产物", icon: Package, count: arts.length },
				]}
				active={tab}
				onChange={setTab}
				className="px-2.5 pt-2.5"
			/>
			<div className="flex-1 overflow-y-auto p-2.5">
				{tab === "files" && (
					<div>
						<div className="mb-1.5 flex items-center gap-1.5">
							<span className="flex-1 truncate font-mono text-2xs text-ink-faint">
								{selected.size > 0 ? `已选 ${selected.size} 项` : `workspaces/${sessionId?.slice(0, 8)}…/`}
							</span>
							{selected.size > 0 && sessionId && (
								<>
									<Button
										variant="secondary"
										size="sm"
										className="h-6 px-2 text-2xs"
										onClick={() => downloadZip(sessionId, Array.from(selected))}
									>
										<Archive size={11} /> 打包下载
									</Button>
									<Button variant="ghost" size="sm" className="h-6 px-1.5 text-2xs" onClick={() => setSelected(new Set())}>
										清除
									</Button>
								</>
							)}
							<Button variant="secondary" size="sm" className="h-6 px-2 text-2xs" onClick={() => setRefreshKey((k) => k + 1)}>
								<RefreshCw size={11} /> 刷新
							</Button>
						</div>
						{!sessionId ? (
							<EmptyState icon={<FolderOpen size={20} />} title="选择左侧会话查看工作区" />
						) : loading ? (
							<EmptyState title="加载中…" />
						) : !tree || tree.length === 0 ? (
							<EmptyState icon={<FolderOpen size={20} />} title="工作区为空 — 拖个文件进来或让 agent 写点东西" />
						) : (
							tree.map((e) => (
								<TreeNode
									key={e.path}
									entry={e}
									depth={0}
									sessionId={sessionId}
									selected={selected.has(e.path)}
									selectedPaths={selected}
									onToggle={toggleSelect}
								/>
							))
						)}
					</div>
				)}
				{tab === "artifacts" && (
					<div>
						{arts.length === 0 ? (
							<EmptyState icon={<Package size={20} />} title="本次会话通过 write/edit 工具产出的文件会显示在这里" />
						) : (
							<div>
								{sessionId && (
									<div className="mb-1.5 flex items-center gap-1.5">
										<span className="flex-1 font-mono text-2xs text-ink-faint">{arts.length} 个产物</span>
										<Button
											variant="secondary"
											size="sm"
											className="h-6 px-2 text-2xs"
											onClick={() => downloadZip(sessionId, arts.map((a) => a.path))}
										>
											<Archive size={11} /> 打包下载
										</Button>
									</div>
								)}
								{arts.map((a) => {
									const { Icon: AIcon, className: aCls } = fileIcon(a.path);
									return (
										<div key={a.id} className="group mb-1.5 flex items-center gap-2.5 rounded-md border border-line bg-surface p-2.5 transition-colors hover:border-line-lit">
											<AIcon size={15} className={cn("shrink-0", aCls)} />
											<div className="min-w-0 flex-1">
												<div className="truncate font-mono text-xs font-medium text-ink">{a.path}</div>
												<div className="tnum mt-0.5 font-mono text-2xs text-ink-faint">
													{fmtBytes(a.size)} · {fmtTime(a.createdAt)}
												</div>
											</div>
											<div className="flex gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
												<a
													href={downloadUrl(`/api/workspace/download?session=${sessionId}&path=${encodeURIComponent(a.path)}`)}
													className="rounded-sm p-1.5 text-ink-dim transition-colors hover:bg-inset hover:text-ink"
													title="下载"
												>
													<Download size={12} />
												</a>
												<Button
													variant="ghost"
													size="icon"
													className="h-6 w-6 text-ink-dim hover:text-alarm"
													title="删除"
													onClick={() => void removeArtifact(a.id)}
												>
													<Trash2 size={12} />
												</Button>
											</div>
										</div>
									);
								})}
							</div>
						)}
					</div>
				)}
			</div>
		</aside>
	);
}
