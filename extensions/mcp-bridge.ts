/**
 * MCP stdio bridge for Pi — 零依赖扩展。
 *
 * 读取环境变量 PI_MCP_CONFIG（JSON: [{name, command, args, env}]），为每个
 * MCP server 派生子进程，手写 JSON-RPC 2.0 over stdio 客户端：
 *   initialize → notifications/initialized → tools/list → tools/call
 * 将 MCP 工具注册为 pi 工具（inputSchema → TypeBox），调用时转发 tools/call。
 *
 * 由 pi-web 网关在 spawn 会话时通过 --extension 附加加载。
 * 依赖仅 @earendil-works/pi-ai（TypeBox）与 @earendil-works/pi-coding-agent（defineTool），
 * 两者均随 pi 全局安装，无需 npm 安装。
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { Type } from "@earendil-works/pi-ai";
import { defineTool, type ExtensionAPI } from "@earendil-works/pi-coding-agent";


interface McpServerConfig {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

interface JsonRpcResponse {
	id: number | string;
	result?: any;
	error?: { code: number; message: string };
}

class JsonRpcClient {
	private child: ChildProcess;
	private buffer = "";
	private nextId = 1;
	private pending = new Map<number, { resolve: (r: JsonRpcResponse) => void; reject: (e: Error) => void }>();
	private closed = false;

	constructor(private cfg: McpServerConfig) {
		const [cmd, ...args] = resolveCommand(cfg);
		this.child = spawn(cmd, args, {
			env: { ...process.env, ...cfg.env },
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		this.child.stdout!.on("data", (chunk: Buffer) => this.onData(chunk));
		this.child.stderr!.on("data", (chunk: Buffer) => {
			const text = chunk.toString("utf8").trim();
			if (text) console.error(`[mcp:${cfg.name}] ${text}`);
		});
		this.child.on("error", (err) => {
			this.failAll(`MCP server "${cfg.name}" 启动失败: ${err.message}`);
		});
		this.child.on("exit", (code) => {
			this.closed = true;
			this.failAll(`MCP server "${cfg.name}" 退出 (code=${code})`);
		});
	}

	private onData(chunk: Buffer): void {
		this.buffer += chunk.toString("utf8");
		let idx: number;
		while ((idx = this.buffer.indexOf("\n")) !== -1) {
			const line = this.buffer.slice(0, idx);
			this.buffer = this.buffer.slice(idx + 1);
			if (!line.trim()) continue;
			let msg: JsonRpcResponse;
			try {
				msg = JSON.parse(line);
			} catch {
				continue;
			}
			const p = this.pending.get(Number(msg.id));
			if (p) {
				this.pending.delete(Number(msg.id));
				msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg);
			}
		}
	}

	private request(method: string, params?: any): Promise<JsonRpcResponse> {
		if (this.closed) return Promise.reject(new Error(`MCP server "${this.cfg.name}" 已退出`));
		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`MCP 请求超时: ${method}`));
			}, 60_000);
			this.pending.set(id, {
				resolve: (r) => {
					clearTimeout(timer);
					resolve(r);
				},
				reject: (e) => {
					clearTimeout(timer);
					reject(e);
				},
			});
			this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
		});
	}

	private notify(method: string, params?: any): void {
		if (this.closed) return;
		this.child.stdin!.write(JSON.stringify({ jsonrpc: "2.0", method, params }) + "\n");
	}

	async initialize(): Promise<void> {
		const res = await this.request("initialize", {
			protocolVersion: "2024-11-05",
			capabilities: {},
			clientInfo: { name: "pi-mcp-bridge", version: "0.1.0" },
		});
		this.notify("notifications/initialized", {});
		void res;
	}

	async listTools(): Promise<any[]> {
		const res = await this.request("tools/list", {});
		return res.result?.tools ?? [];
	}

	async callTool(name: string, args: Record<string, unknown>): Promise<any> {
		const res = await this.request("tools/call", { name, arguments: args });
		return res.result ?? {};
	}

	kill(): void {
		this.closed = true;
		if (process.platform === "win32") {
			try {
				spawnSync("taskkill", ["/pid", String(this.child.pid), "/T", "/F"], { stdio: "ignore" });
			} catch {
				/* ignore */
			}
		} else {
			try {
				this.child.kill("SIGTERM");
			} catch {
				/* ignore */
			}
		}
	}

	private failAll(reason: string): void {
		for (const [, p] of this.pending) p.reject(new Error(reason));
		this.pending.clear();
	}
}

/** Resolve the command: support "npx" with args, absolute paths, and on-path binaries. */
function resolveCommand(cfg: McpServerConfig): [string, ...string[]] {
	if (!cfg.command) throw new Error(`MCP server "${cfg.name}" 缺少 command`);
	const args = [...(cfg.args ?? [])];
	return [cfg.command, ...args];
}

// ---------------------------------------------------------------------------
// inputSchema (JSON Schema) → TypeBox 转换（支持常用子集）
// ---------------------------------------------------------------------------

function jsonSchemaToType(schema: any, required: boolean): any {
	if (!schema || typeof schema !== "object") return Type.Any();
	const meta: Record<string, unknown> = {};
	if (schema.description) meta.description = schema.description;

	let t: any;
	switch (schema.type) {
		case "string":
			t = schema.enum ? Type.Enum(Object.fromEntries(schema.enum.map((v: string) => [v, v]))) : Type.String(meta);
			break;
		case "number":
			t = Type.Number(meta);
			break;
		case "integer":
			t = Type.Integer(meta);
			break;
		case "boolean":
			t = Type.Boolean(meta);
			break;
		case "null":
			t = Type.Null();
			break;
		case "array":
			t = Type.Array(jsonSchemaToType(schema.items, true), meta);
			break;
		case "object": {
			const props: Record<string, any> = {};
			const requiredList: string[] = Array.isArray(schema.required) ? schema.required : [];
			for (const [k, v] of Object.entries(schema.properties ?? {})) {
				props[k] = jsonSchemaToType(v, requiredList.includes(k));
			}
			t = Type.Object(props, { ...meta, additionalProperties: schema.additionalProperties !== false });
			break;
		}
		default:
			t = Type.Any(meta);
	}
	return required ? t : Type.Optional(t);
}

function mcpResultToContent(result: any): Array<{ type: string; text?: string }> {
	const content = result?.content;
	if (Array.isArray(content)) {
		return content.map((c: any) => {
			if (c.type === "text") return { type: "text", text: String(c.text ?? "") };
			if (c.type === "image") {
				return { type: "text", text: `[image ${c.mimeType ?? "unknown"} (${String(c.data ?? "").length} chars base64)]` };
			}
			return { type: "text", text: JSON.stringify(c) };
		});
	}
	return [{ type: "text", text: JSON.stringify(result ?? {}, null, 2) }];
}

export default function mcpBridgeExtension(pi: ExtensionAPI): void {
	const raw = process.env.PI_MCP_CONFIG;
	if (!raw) {
		console.error("[mcp-bridge] PI_MCP_CONFIG 未设置，跳过");
		return;
	}

	let servers: McpServerConfig[];
	try {
		servers = JSON.parse(raw);
	} catch (err) {
		console.error(`[mcp-bridge] 配置解析失败: ${err instanceof Error ? err.message : err}`);
		return;
	}
	if (!Array.isArray(servers) || servers.length === 0) return;

	const clients = new Map<string, JsonRpcClient>();
	const registered = new Set<string>();

	pi.on("session_start", () => {
		for (const cfg of servers) {
			const client = new JsonRpcClient(cfg);
			clients.set(cfg.name, client);

			client
				.initialize()
				.then(() => client.listTools())
				.then((tools) => {
					let count = 0;
					for (const tool of tools ?? []) {
						if (!tool?.name) continue;
						if (registered.has(tool.name)) {
							console.error(`[mcp:${cfg.name}] 工具名冲突，跳过: ${tool.name}`);
							continue;
						}
						registered.add(tool.name);
						const params = jsonSchemaToType(tool.inputSchema ?? { type: "object", properties: {} }, false);
						pi.registerTool(
							defineTool({
								name: tool.name,
								label: tool.name,
								description: tool.description ?? `MCP tool (${cfg.name})`,
								parameters: params,
								async execute(_toolCallId, args) {
									try {
										const result = await client.callTool(tool.name, args ?? {});
										const isError = !!result.isError;
										return {
											content: mcpResultToContent(result),
											isError,
										};
									} catch (err) {
										return {
											content: [{ type: "text", text: `MCP 调用失败: ${err instanceof Error ? err.message : err}` }],
											isError: true,
										};
									}
								},
							}),
						);
						count++;
					}
					console.error(`[mcp:${cfg.name}] 注册 ${count} 个工具`);
				})
				.catch((err) => {
					console.error(`[mcp:${cfg.name}] 初始化失败: ${err.message}`);
					client.kill();
					clients.delete(cfg.name);
				});
		}
	});

	pi.registerCommand("mcp-status", {
		description: "查看 MCP 桥接状态",
		handler: async (_args, ctx) => {
			const lines = servers.map((s) => {
				const client = clients.get(s.name);
				return client ? `${s.name}: 已连接` : `${s.name}: 未连接`;
			});
			ctx.ui.notify(lines.join("\n"), "info");
		},
	});
}
