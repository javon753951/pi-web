import { useEffect, useRef, useState } from "react";
import { FileUp, Loader2, Paperclip, Square, SendHorizontal, X } from "lucide-react";
import { useApp } from "../../store";
import { Button } from "../ui/button";
import { Select } from "../ui/select";
import { uploadFile } from "../../lib/api";
import { cn } from "../../lib/utils";

const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "max"];

interface Attachment {
	id: number;
	name: string;
	/** 工作区内相对路径（上传完成后有值）。 */
	path?: string;
	error?: string;
}

let attachSeq = 0;

export function Composer({ disabled }: { disabled?: boolean }) {
	const [text, setText] = useState("");
	const [model, setModel] = useState("");
	const [thinking, setThinking] = useState("");
	const [attachments, setAttachments] = useState<Attachment[]>([]);
	const [dragOver, setDragOver] = useState(false);
	const taRef = useRef<HTMLTextAreaElement>(null);
	const fileRef = useRef<HTMLInputElement>(null);
	const { models, status, currentSessionId, sessions, sendRpc, sendPrompt, bumpWorkspace } = useApp();
	const running = currentSessionId ? status[currentSessionId] === "running" : false;
	const isStreaming = useApp((s) => {
		const sid = s.currentSessionId;
		if (!sid) return false;
		return (s.messages[sid]?.at(-1)?.streaming) ?? false;
	});

	const uploading = attachments.some((a) => !a.path && !a.error);
	const readyAttachments = attachments.filter((a) => a.path);

	// 切换会话时，模型/思考级别跟随会话实际值（避免残留上一个会话的选择）
	const lastSidRef = useRef<string | null>(null);
	useEffect(() => {
		if (lastSidRef.current === currentSessionId) return;
		lastSidRef.current = currentSessionId;
		setAttachments([]);
		const sess = currentSessionId ? sessions.find((s) => s.id === currentSessionId) : undefined;
		if (sess?.model && models.some((m) => m.id === sess.model)) setModel(sess.model);
		if (sess?.thinkingLevel) setThinking(sess.thinkingLevel);
	}, [currentSessionId]);

	// 兜底：模型列表加载后，若尚未选中则用第一个
	useEffect(() => {
		if (!model && models.length > 0) setModel(models[0]!.id);
	}, [models, model]);

	/** 上传一批文件：逐个 PUT，成功后挂附件 chip。 */
	const addFiles = (files: FileList | File[]) => {
		if (!currentSessionId || disabled) return;
		const list = Array.from(files);
		if (list.length === 0) return;
		const slots: Attachment[] = list.map((f) => ({ id: ++attachSeq, name: f.name }));
		setAttachments((prev) => [...prev, ...slots]);
		list.forEach((file, i) => {
			const slot = slots[i]!;
			uploadFile(currentSessionId, file)
				.then((res) => {
					setAttachments((prev) => prev.map((a) => (a.id === slot.id ? { ...a, path: res.path } : a)));
					bumpWorkspace();
				})
				.catch((err) => {
					setAttachments((prev) =>
						prev.map((a) => (a.id === slot.id ? { ...a, error: err instanceof Error ? err.message : String(err) } : a)),
					);
				});
		});
	};

	const send = () => {
		const msg = text.trim();
		if ((!msg && readyAttachments.length === 0) || !currentSessionId || uploading) return;
		// pi 的 RPC prompt 不接收 model 字段，切换模型必须走 set_model
		const sess = sessions.find((s) => s.id === currentSessionId);
		const m = model ? models.find((x) => x.id === model) : undefined;
		if (m && sess && sess.model !== m.id && status[currentSessionId] === "running") {
			sendRpc({ type: "set_model", provider: m.provider, modelId: m.id });
		}
		// 附件以工作区路径写进消息，agent 可直接用文件工具访问
		let full = msg;
		if (readyAttachments.length > 0) {
			const refs = readyAttachments.map((a) => `- ./${a.path}`).join("\n");
			full += `\n\n[已上传文件到工作区]\n${refs}`;
		}
		sendPrompt(full || "[已上传文件到工作区]", { thinking: thinking || undefined });
		setText("");
		setAttachments([]);
		if (taRef.current) taRef.current.style.height = "auto";
	};

	const onModelChange = (v: string) => {
		setModel(v);
		if (!currentSessionId || status[currentSessionId] !== "running") return;
		const m = models.find((x) => x.id === v);
		if (m) sendRpc({ type: "set_model", provider: m.provider, modelId: m.id });
	};

	const abort = () => {
		sendRpc({ type: "abort" });
	};

	return (
		<div className="px-5 pb-4">
			<div
				className={cn(
					"mx-auto max-w-[860px] rounded-2xl border border-line bg-surface px-4 py-3 transition-all duration-200",
					"focus-within:border-ai/45 focus-within:shadow-[0_0_0_3px_rgba(123,140,255,0.13)]",
					disabled && "opacity-50",
					dragOver && "border-ai/60 shadow-[0_0_0_3px_rgba(123,140,255,0.16)]",
				)}
				onDragOver={(e) => {
					e.preventDefault();
					setDragOver(true);
				}}
				onDragLeave={() => setDragOver(false)}
				onDrop={(e) => {
					e.preventDefault();
					setDragOver(false);
					if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files);
				}}
			>
				{attachments.length > 0 && (
					<div className="mb-2 flex flex-wrap gap-1.5">
						{attachments.map((a) => (
							<span
								key={a.id}
								className={cn(
									"flex max-w-[240px] items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-2xs",
									a.error ? "border-alarm/40 bg-alarm/10 text-alarm" : "border-line bg-surface text-ink-dim",
								)}
								title={a.error ?? a.path ?? a.name}
							>
								{!a.path && !a.error && <Loader2 size={10} className="shrink-0 animate-spin" />}
								<span className="truncate">{a.name}</span>
								{a.path && <span className="shrink-0 text-ink-faint">✓</span>}
								<button
									type="button"
									className="shrink-0 cursor-pointer rounded-sm p-0.5 text-ink-faint hover:text-ink"
									onClick={() => setAttachments((prev) => prev.filter((x) => x.id !== a.id))}
									title="移除"
								>
									<X size={10} />
								</button>
							</span>
						))}
					</div>
				)}
				<textarea
					ref={taRef}
					value={text}
					disabled={disabled}
					rows={1}
					placeholder={
						dragOver
							? "松手即上传到工作区…"
							: running
								? "输入消息，Enter 发送 · 可拖入/粘贴/📎 上传文件…"
								: "会话未运行 — 发送后将自动启动…"
					}
					className="max-h-[180px] w-full resize-none bg-transparent text-sm text-ink outline-none caret-ai placeholder:text-ink-faint disabled:cursor-not-allowed"
					onChange={(e) => {
						setText(e.target.value);
						e.target.style.height = "auto";
						e.target.style.height = Math.min(e.target.scrollHeight, 180) + "px";
					}}
					onPaste={(e) => {
						const files = Array.from(e.clipboardData?.files ?? []);
						if (files.length > 0) {
							e.preventDefault();
							addFiles(files);
						}
					}}
					onKeyDown={(e) => {
						if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
							e.preventDefault();
							send();
						}
					}}
				/>
				<div className="mt-2 flex items-center gap-2">
					<input
						ref={fileRef}
						type="file"
						multiple
						className="hidden"
						onChange={(e) => {
							if (e.target.files?.length) addFiles(e.target.files);
							e.target.value = "";
						}}
					/>
					<Button
						variant="ghost"
						size="sm"
						className="h-7 w-7 p-0"
						disabled={disabled || !currentSessionId}
						onClick={() => fileRef.current?.click()}
						title="上传文件到工作区（zip 自动解包）"
					>
						<Paperclip size={13} />
					</Button>
					<span className="label-tech mr-auto hidden text-ink-faint md:inline">Enter 发送 · Shift+Enter 换行</span>
					<Select
						ariaLabel="模型"
						value={model}
						onChange={onModelChange}
						options={models.map((m) => ({ value: m.id, label: `${m.provider}/${m.id}` }))}
					/>
					<Select
						ariaLabel="思考级别"
						value={thinking}
						onChange={setThinking}
						options={THINKING_LEVELS.map((l) => ({ value: l, label: `thinking: ${l}` }))}
					/>
					{isStreaming ? (
						<Button variant="danger" onClick={abort} className="gap-1.5">
							<Square size={12} className="fill-current" /> 停止
						</Button>
					) : (
						<Button onClick={send} disabled={uploading || disabled || (!text.trim() && readyAttachments.length === 0)} className="gap-1.5">
							{uploading ? <Loader2 size={13} className="animate-spin" /> : <SendHorizontal size={13} />} 发送
						</Button>
					)}
				</div>
			</div>
			{dragOver && (
				<div className="pointer-events-none mx-auto mt-1.5 flex max-w-[860px] items-center gap-1.5 font-mono text-2xs text-ai">
					<FileUp size={11} /> 松手上传到当前会话工作区（.zip 自动解包）
				</div>
			)}
		</div>
	);
}
