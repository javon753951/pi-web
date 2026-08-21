import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { createSocket } from "node:dgram";
import { networkInterfaces } from "node:os";
import type { SessionManager } from "../session-manager.js";
import { getModels, setAuthKey, type ModelInfo, type ProviderAuth } from "../models.js";
import { CATALOG } from "../marketplace/catalog.js";
import { searchNpm, type SearchHit } from "../marketplace/npm-search.js";
import { scanInstalled, type InstalledItem } from "../marketplace/installed.js";
import { runInstall } from "../marketplace/installer.js";
import { listArtifacts, deleteArtifact } from "../artifacts.js";
import { listDir, previewFile, sendDownload } from "../workspace.js";
import { saveUpload, buildWorkspaceZip } from "../transfer.js";
import { writeMcpConfigIfNeeded } from "../mcp/bridge-config.js";
import type { Db } from "../db.js";
import type { AppConfig } from "../config.js";

export interface RestDeps {
	config: AppConfig;
	db: Db;
	sessions: SessionManager;
}

export function registerRest(app: FastifyInstance, deps: RestDeps): void {
	const { config, db, sessions } = deps;

	// ------------------------------------------------------------- health
	app.get("/api/health", async () => ({
		ok: true,
		name: "pi-web",
		version: "0.1.0",
		engine: "pi-rpc",
		activeSessions: sessions.list().filter((s) => s.status === "running" || s.status === "starting").length,
		tokenConfigured: true,
		cliPath: config.cliPath,
	}));

	// ------------------------------------------------------------ sessions
	app.get("/api/sessions", async () => ({ sessions: sessions.list() }));

	app.post<{ Body: { name?: string } }>("/api/sessions", async (req, reply) => {
		const meta = await sessions.createSession(req.body?.name);
		reply.code(201);
		return { session: meta };
	});

	app.delete<{ Params: { id: string } }>("/api/sessions/:id", async (req) => {
		await sessions.deleteSession(req.params.id);
		return { ok: true };
	});

	app.post<{ Params: { id: string } }>("/api/sessions/:id/restart", async (req) => {
		const meta = await sessions.restartSession(req.params.id);
		return { session: meta };
	});

	app.get<{ Params: { id: string } }>("/api/sessions/:id/artifacts", async (req) => {
		sessions.load(req.params.id);
		return { artifacts: listArtifacts(db, req.params.id) };
	});

	app.delete<{ Params: { id: string; artifactId: string } }>(
		"/api/sessions/:id/artifacts/:artifactId",
		async (req) => {
			deleteArtifact(sessions, db, req.params.id, Number(req.params.artifactId));
			return { ok: true };
		},
	);

	// -------------------------------------------------------------- models
	app.get("/api/models", async () => {
		const data = getModels(config);
		return { models: data.models, providers: data.providers, defaultModel: data.defaultModel };
	});

	app.get("/api/auth-status", async () => {
		const data = getModels(config);
		return { providers: data.providers, defaultModel: data.defaultModel };
	});

	app.post<{ Body: { provider: string; apiKey: string } }>("/api/settings/auth", async (req, reply) => {
		const { provider, apiKey } = req.body ?? {};
		if (!provider || !apiKey) {
			reply.code(400);
			return { error: "provider 和 apiKey 必填" };
		}
		const auth = setAuthKey(config, provider, apiKey);
		return { ok: true, provider: auth, note: "API key 已写入 ~/.pi/agent/auth.json，重启会话后生效" };
	});

	// ------------------------------------------------------------ commands
	app.get("/api/commands", async () => {
		const { commands, stale } = await sessions.getCommands();
		return { commands, stale };
	});

	// ------------------------------------------------------------ settings
	app.get("/api/settings", async () => ({ settings: sessions.allSettings() }));

	app.put<{ Body: { key: string; value: unknown } }>("/api/settings", async (req, reply) => {
		const { key, value } = req.body ?? {};
		if (!key) {
			reply.code(400);
			return { error: "key 必填" };
		}
		sessions.setSetting(key, value);
		return { ok: true };
	});

	// ---------------------------------------------------------- marketplace
	app.get("/api/marketplace/catalog", async () => ({ catalog: CATALOG }));

	app.get("/api/marketplace/installed", async () => {
		const installed: InstalledItem[] = scanInstalled(config);
		const tracked = db.all<{ name: string; version: string | null; installed_at: number }>(
			"SELECT name, version, installed_at FROM installed_packages ORDER BY installed_at DESC",
		);
		return { installed, tracked };
	});

	app.get<{ Querystring: { q?: string } }>("/api/marketplace/search", async (req, reply) => {
		const q = (req.query.q ?? "").trim();
		if (!q) {
			reply.code(400);
			return { error: "q 必填" };
		}
		let hits: SearchHit[] = [];
		try {
			hits = await searchNpm(q);
		} catch (err) {
			reply.code(502);
			return { error: `npm registry 搜索失败: ${err instanceof Error ? err.message : err}` };
		}
		return { hits };
	});

	function streamInstall(req: any, reply: any, spec: string, remove: boolean): void {
		if (!spec || typeof spec !== "string") {
			reply.code(400);
			return reply.send({ error: "spec 必填" });
		}
		reply.raw.writeHead(200, { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" });
		reply.hijack();
		void runInstall({
			config,
			spec,
			remove,
			onLine: (line) => {
				try {
					reply.raw.write(JSON.stringify(line) + "\n");
				} catch {
					/* client gone */
				}
			},
		}).then(() => {
			try {
				reply.raw.end();
			} catch {
				/* client gone */
			}
		});
	}

	app.post<{ Body: { spec: string } }>("/api/marketplace/install", async (req, reply) => {
		streamInstall(req, reply, req.body?.spec, false);
	});

	app.post<{ Body: { spec: string } }>("/api/marketplace/remove", async (req, reply) => {
		streamInstall(req, reply, req.body?.spec, true);
	});

	// ------------------------------------------------------------------ mcp
	app.get("/api/mcp", async () => ({
		servers: db.all("SELECT * FROM mcp_servers ORDER BY created_at ASC"),
	}));

	app.post<{ Body: { name: string; command: string; args?: string; env?: Record<string, string>; enabled?: boolean } }>(
		"/api/mcp",
		async (req, reply) => {
			const { name, command } = req.body ?? {};
			if (!name || !command) {
				reply.code(400);
				return { error: "name 和 command 必填" };
			}
			const id = randomUUID();
			db.run(
				"INSERT INTO mcp_servers (id, name, command, args, env, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
				id, name, command, req.body.args ?? "", JSON.stringify(req.body.env ?? {}),
				req.body.enabled === false ? 0 : 1, Date.now(),
			);
			writeMcpConfigIfNeeded(config, db);
			return { ok: true, id };
		},
	);

	app.put<{ Params: { id: string }; Body: { enabled?: boolean; name?: string; command?: string; args?: string } }>(
		"/api/mcp/:id",
		async (req, reply) => {
			const row = db.get("SELECT * FROM mcp_servers WHERE id = ?", req.params.id);
			if (!row) {
				reply.code(404);
				return { error: "MCP server 不存在" };
			}
			db.run(
				"UPDATE mcp_servers SET enabled = ?, name = ?, command = ?, args = ? WHERE id = ?",
				req.body.enabled === false ? 0 : req.body.enabled === true ? 1 : row.enabled,
				req.body.name ?? row.name,
				req.body.command ?? row.command,
				req.body.args ?? row.args,
				req.params.id,
			);
			writeMcpConfigIfNeeded(config, db);
			return { ok: true };
		},
	);

	app.delete<{ Params: { id: string } }>("/api/mcp/:id", async (req, reply) => {
		db.run("DELETE FROM mcp_servers WHERE id = ?", req.params.id);
		writeMcpConfigIfNeeded(config, db);
		return { ok: true };
	});

	// ------------------------------------------------------------- workspace
	app.get<{ Querystring: { session: string; path?: string } }>("/api/workspace/tree", async (req) => {
		sessions.load(req.query.session);
		const root = sessions.workspaceDir(req.query.session);
		return { entries: listDir(root, req.query.path ?? "") };
	});

	app.get<{ Querystring: { session: string; path: string } }>("/api/workspace/file", async (req, reply) => {
		sessions.load(req.query.session);
		const root = sessions.workspaceDir(req.query.session);
		try {
			return await previewFile(root, req.query.path);
		} catch (err: any) {
			if (err?.status === 404) {
				reply.code(404);
				return { error: "文件不存在" };
			}
			throw err;
		}
	});

	app.get<{ Querystring: { session: string; path: string } }>("/api/workspace/download", async (req, reply) => {
		sessions.load(req.query.session);
		const root = sessions.workspaceDir(req.query.session);
		sendDownload(reply, root, req.query.path);
		return reply;
	});

	// ----------------------------------------------------- upload / zip download

	app.put<{ Params: { id: string }; Querystring: { dir?: string; name: string; unzip?: string }; Body: Buffer }>(
		"/api/sessions/:id/files",
		{ bodyLimit: 256 * 1024 * 1024 },
		async (req, reply) => {
			sessions.load(req.params.id);
			const root = sessions.workspaceDir(req.params.id);
			const body = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body ?? []);
			const result = saveUpload(root, req.query.dir ?? "", req.query.name, body, {
				unzip: req.query.unzip !== "0",
			});
			return result;
		},
	);

	app.get<{ Params: { id: string }; Querystring: { paths?: string } }>("/api/sessions/:id/download-zip", async (req, reply) => {
		sessions.load(req.params.id);
		const root = sessions.workspaceDir(req.params.id);
		const paths = (req.query.paths ?? "")
			.split("\n")
			.map((p) => p.trim())
			.filter(Boolean);
		const zip = buildWorkspaceZip(root, paths);
		const stamp = new Date().toISOString().slice(0, 10);
		reply
			.header("Content-Type", "application/zip")
			.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(`workspace-${req.params.id.slice(0, 8)}-${stamp}.zip`)}`)
			.send(zip);
		return reply;
	});

	// ------------------------------------------------------------------- net
	// 局域网地址发现：前端据此生成扫码访问链接。
	// - lanEnabled：服务是否真的监听在非回环地址上（PI_WEB_HOST 不是 127.0.0.1）
	// - 主出口 IP 排第一（UDP connect 让系统按默认路由选源地址，不发包），
	//   其余网卡按私网段过滤、剔除虚拟网卡（vEthernet/WSL/VMware 等手机不可达）。
	app.get("/api/net", async () => {
		const port = config.publicPort;
		const host = config.host;
		const lanEnabled = !["127.0.0.1", "::1", "localhost"].includes(host);

		const primary = await primaryIPv4();
		const urls: string[] = [];
		const seen = new Set<string>();
		const push = (ip: string) => {
			if (seen.has(ip)) return;
			seen.add(ip);
			urls.push(`http://${ip}:${port}`);
		};

		if (primary && isPrivateIPv4(primary)) push(primary);
		for (const [name, list] of Object.entries(networkInterfaces())) {
			for (const ni of list ?? []) {
				if (ni.family !== "IPv4" || ni.internal) continue;
				if (VIRTUAL_IFACE_RE.test(name)) continue;
				if (!isPrivateIPv4(ni.address)) continue;
				push(ni.address);
			}
		}
		return { port, urls, lanEnabled, host };
	});
}

// ------------------------------------------------------------------- helpers

const VIRTUAL_IFACE_RE = /vEthernet|WSL|Hyper-?V|VirtualBox|VMware|Tailscale|WireGuard|ZeroTier|docker/i;

function isPrivateIPv4(ip: string): boolean {
	const parts = ip.split(".").map(Number);
	if (parts.length !== 4 || parts.some((n) => Number.isNaN(n) || n < 0 || n > 255)) return false;
	const a = parts[0]!;
	const b = parts[1]!;
	return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/**
 * 主出口 IPv4：对公网地址做 UDP connect——UDP 不发任何包，只是让系统
 * 按默认路由挑一块网卡，再读回本地源地址（即手机应访问的局域网 IP）。
 */
function primaryIPv4(timeoutMs = 800): Promise<string | null> {
	return new Promise((resolve) => {
		const sock = createSocket("udp4");
		let done = false;
		const finish = (v: string | null) => {
			if (done) return;
			done = true;
			try {
				sock.close();
			} catch {
				/* noop */
			}
			resolve(v);
		};
		sock.once("error", () => finish(null));
		sock.once("connect", () => finish(sock.address().address));
		try {
			sock.connect(80, "8.8.8.8");
		} catch {
			finish(null);
		}
		setTimeout(() => finish(null), timeoutMs);
	});
}
