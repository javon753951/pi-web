import { useEffect, useState } from "react";
import { KeyRound, Plus, Trash2, Eye, EyeOff, Check } from "lucide-react";
import { api } from "../lib/api";
import { useApp } from "../store";
import { Dialog } from "../components/ui/dialog";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import type { McpServer, ProviderAuth } from "../lib/types";

type Section = "providers" | "mcp" | "token";

export function SettingsPage({ open, onClose }: { open: boolean; onClose: () => void }) {
	const { providers, refreshModels, token } = useApp();
	const [keys, setKeys] = useState<Record<string, string>>({});
	const [showKey, setShowKey] = useState<Record<string, boolean>>({});
	const [saving, setSaving] = useState<string | null>(null);
	const [savedNote, setSavedNote] = useState("");
	const [mcpServers, setMcpServers] = useState<McpServer[]>([]);
	const [mcpForm, setMcpForm] = useState({ name: "", command: "", args: "", enabled: true });
	const [showMcpForm, setShowMcpForm] = useState(false);
	const [section, setSection] = useState<Section>("providers");

	useEffect(() => {
		if (!open) return;
		setSavedNote("");
		api
			.get<{ servers: McpServer[] }>("/api/mcp")
			.then((d) => setMcpServers(d.servers))
			.catch(() => {});
	}, [open]);

	const saveKey = async (provider: ProviderAuth) => {
		const key = keys[provider.provider];
		if (!key) return;
		setSaving(provider.provider);
		try {
			await api.post("/api/settings/auth", { provider: provider.provider, apiKey: key });
			setSavedNote(`${provider.provider} 密钥已保存，重启会话后生效`);
			await refreshModels();
			setKeys((k) => ({ ...k, [provider.provider]: "" }));
		} catch (err) {
			setSavedNote(err instanceof Error ? err.message : "保存失败");
		} finally {
			setSaving(null);
		}
	};

	const addMcp = async () => {
		if (!mcpForm.name || !mcpForm.command) return;
		await api.post("/api/mcp", { ...mcpForm, args: mcpForm.args });
		const d = await api.get<{ servers: McpServer[] }>("/api/mcp");
		setMcpServers(d.servers);
		setMcpForm({ name: "", command: "", args: "", enabled: true });
		setShowMcpForm(false);
	};

	const toggleMcp = async (s: McpServer) => {
		await api.put(`/api/mcp/${s.id}`, { enabled: !s.enabled });
		const d = await api.get<{ servers: McpServer[] }>("/api/mcp");
		setMcpServers(d.servers);
	};

	const removeMcp = async (id: string) => {
		await api.del(`/api/mcp/${id}`);
		setMcpServers((s) => s.filter((x) => x.id !== id));
	};

	const navButton = (id: Section, label: string) => (
		<button
			onClick={() => setSection(id)}
			className={`flex w-full items-center rounded-sm px-2.5 py-1.5 text-xs transition-colors ${
				section === id
					? "bg-inset font-medium text-ink"
					: "text-ink-faint hover:bg-inset hover:text-ink-dim"
			}`}
		>
			{label}
		</button>
	);

	return (
		<Dialog
			open={open}
			onClose={onClose}
			title="设置"
			subtitle="API 密钥、MCP 服务器与访问令牌"
			width="w-[720px]"
		>
			<div className="flex gap-5">
				{/* Left mini-nav */}
				<nav className="w-36 shrink-0 space-y-0.5">
					{navButton("providers", "模型提供方")}
					{navButton("mcp", "MCP 服务器")}
					{navButton("token", "访问令牌")}
				</nav>

				{/* Vertical divider */}
				<div className="w-px bg-line" />

				{/* Right content area */}
				<div className="min-w-0 flex-1">
					{/* Section: 模型提供方 · API 密钥 */}
					{section === "providers" && (
						<div className="space-y-3">
							<h4 className="label-tech text-ink-faint">模型提供方 · API 密钥</h4>
							<div className="space-y-2">
								{providers.map((p) => (
									<div key={p.provider} className="flex items-center gap-2">
										<span className="w-20 shrink-0 text-xs text-ink-dim">{p.provider}</span>
										<Input
											type={showKey[p.provider] ? "text" : "password"}
											value={keys[p.provider] ?? ""}
											placeholder={p.configured ? `已配置 ${p.keyPreview ?? ""}` : "sk-…（未配置）"}
											onChange={(e) => setKeys((k) => ({ ...k, [p.provider]: e.target.value }))}
											className="flex-1"
										/>
										<Button
											variant="ghost"
											size="icon"
											className="h-7 w-7 shrink-0"
											onClick={() => setShowKey((s) => ({ ...s, [p.provider]: !s[p.provider] }))}
										>
											{showKey[p.provider] ? <EyeOff size={12} /> : <Eye size={12} />}
										</Button>
										{p.configured && <Check size={12} className="text-ok shrink-0" />}
										<Button
											size="sm"
											className="shrink-0"
											disabled={!keys[p.provider] || saving === p.provider}
											onClick={() => void saveKey(p)}
										>
											{saving === p.provider ? "…" : "保存"}
										</Button>
									</div>
								))}
								{providers.length === 0 && (
									<p className="text-2xs text-ink-faint">未发现模型提供方（读取 ~/.pi/agent）</p>
								)}
							</div>
							<p className="flex items-center gap-1.5 text-2xs text-ink-faint">
								<KeyRound size={10} />
								密钥写入 ~/.pi/agent/auth.json · 修改后需重启会话生效
							</p>
							{savedNote && <p className="text-2xs text-ok">{savedNote}</p>}
						</div>
					)}

					{/* Section: MCP 服务器（stdio） */}
					{section === "mcp" && (
						<div className="space-y-3">
							<h4 className="label-tech text-ink-faint">MCP 服务器（stdio，重启会话生效）</h4>
							<div className="space-y-1.5">
								{mcpServers.map((s) => (
									<div
										key={s.id}
										className="flex items-center gap-2.5 rounded-md border border-line bg-surface p-2.5 transition-colors hover:border-line-lit"
									>
										<span className={`h-1.5 w-1.5 shrink-0 rounded-full ${s.enabled ? "bg-ok" : "bg-ink-faint/50"}`} />
										<div className="min-w-0 flex-1">
											<div className="text-xs font-medium text-ink">{s.name}</div>
											<div className="font-mono text-2xs text-ink-faint truncate">
												{s.command} {s.args}
											</div>
										</div>
										<Button variant="secondary" size="sm" className="h-6 px-2 text-2xs" onClick={() => void toggleMcp(s)}>
											{s.enabled ? "停用" : "启用"}
										</Button>
										<Button variant="ghost" size="icon" className="h-6 w-6 text-ink-dim hover:text-alarm" onClick={() => void removeMcp(s.id)}>
											<Trash2 size={12} />
										</Button>
									</div>
								))}
								{mcpServers.length === 0 && <p className="py-6 text-center text-2xs text-ink-faint">暂无 MCP 服务器</p>}
							</div>
							{showMcpForm ? (
								<div className="space-y-2 rounded-md border border-line bg-inset p-2.5">
									<Input
										placeholder="名称（如 filesystem）"
										value={mcpForm.name}
										onChange={(e) => setMcpForm({ ...mcpForm, name: e.target.value })}
									/>
									<Input
										placeholder="命令（如 npx）"
										value={mcpForm.command}
										onChange={(e) => setMcpForm({ ...mcpForm, command: e.target.value })}
									/>
									<Input
										placeholder="参数（如 -y @modelcontextprotocol/server-filesystem ./workspace）"
										value={mcpForm.args}
										onChange={(e) => setMcpForm({ ...mcpForm, args: e.target.value })}
									/>
									<div className="flex justify-end gap-2">
										<Button variant="ghost" size="sm" onClick={() => setShowMcpForm(false)}>
											取消
										</Button>
										<Button size="sm" onClick={() => void addMcp()}>
											<Plus size={12} /> 添加
										</Button>
									</div>
								</div>
							) : (
								<Button variant="secondary" size="sm" className="w-full" onClick={() => setShowMcpForm(true)}>
									<Plus size={12} /> 添加 MCP 服务器
								</Button>
							)}
						</div>
					)}

					{/* Section: 访问令牌 */}
					{section === "token" && (
						<div className="space-y-3">
							<h4 className="label-tech text-ink-faint">访问令牌</h4>
							<div className="font-mono text-2xs text-ink-dim break-all bg-inset border border-line rounded-sm p-2">
								{token || "（未注入 — dev 模式由 vite 注入）"}
							</div>
							<p className="text-2xs text-ink-faint">
								用于 /api 与 /ws 的 Bearer 鉴权 · 由环境变量 PI_WEB_TOKEN 或 data/.token 提供
							</p>
						</div>
					)}
				</div>
			</div>
		</Dialog>
	);
}
