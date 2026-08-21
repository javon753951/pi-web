import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import staticPlugin from "@fastify/static";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { loadConfig } from "./config.js";
import { openDb, migrate, dbPath } from "./db.js";
import { registerAuth } from "./auth.js";
import { SessionManager } from "./session-manager.js";
import { registerRest } from "./api/rest.js";
import { registerWs } from "./api/ws.js";
import { WorkspaceError } from "./workspace.js";

async function main(): Promise<void> {
	const config = loadConfig();
	const db = openDb(dbPath(config.dataDir));
	migrate(db);

	const app: FastifyInstance = Fastify({ logger: true, bodyLimit: 5 * 1024 * 1024 });

	// 文件上传：原始字节流（前端统一以 application/octet-stream 发送，避免逐 mime 解析）
	app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) => {
		done(null, body);
	});

	const sessions = new SessionManager({
		config,
		db,
		broadcast: () => {
			/* replaced by the WS hub */
		},
	});

	registerAuth(app, { token: config.token });
	await app.register(websocket);

	registerRest(app, { config, db, sessions });
	registerWs(app, { config, db, sessions });

	// ------------------------------------------------------------ error handler
	app.setErrorHandler((err, req, reply) => {
		if (err instanceof WorkspaceError) {
			reply.code(err.status).send({ error: err.message });
			return;
		}
		if (err instanceof Error) {
			req.log.error(err);
			reply.code(500).send({ error: err.message });
			return;
		}
		reply.code(500).send({ error: "internal error" });
	});

	// ------------------------------------------------------------ static SPA
	const distDir = config.webDistDir;
	const hasDist = existsSync(join(distDir, "index.html"));

	if (hasDist) {
		await app.register(staticPlugin, {
			root: distDir,
			prefix: "/",
			wildcard: false,
			index: false,
		});

		const indexHtml = readFileSync(join(distDir, "index.html"), "utf8");

		app.get("/", async (_req, reply) => {
			reply
				.type("text/html; charset=utf-8")
				.header("Cache-Control", "no-store")
				.send(indexHtml.replace('"__PI_WEB_TOKEN__"', JSON.stringify(config.token)));
		});

		app.setNotFoundHandler((req, reply) => {
			if (req.method === "GET" && !req.url.startsWith("/api") && !req.url.startsWith("/ws")) {
				reply
					.type("text/html; charset=utf-8")
					.header("Cache-Control", "no-store")
					.send(indexHtml.replace('"__PI_WEB_TOKEN__"', JSON.stringify(config.token)));
				return;
			}
			reply.code(404).send({ error: "not found" });
		});
	}

	// ------------------------------------------------------------ boot
	sessions.restore();
	const running = sessions.list();

	await app.listen({ port: config.port, host: config.host });
	app.log.info(`pi-web listening on http://${config.host}:${config.port}`);
	app.log.info(`cli: ${config.cliPath}`);
	app.log.info(`data dir: ${config.dataDir}`);
	app.log.info(`restored sessions: ${running.length}`);
	app.log.info(`token: ${config.token}${hasDist ? " (injected into served SPA)" : ""}`);
	if (!hasDist) {
		app.log.warn("web/dist 不存在 —— 请先运行 npm run build（或 dev 模式用 vite 开发服务器）");
	}

	// ------------------------------------------------------------ shutdown
	const shutdown = async (signal: string) => {
		app.log.info(`received ${signal}, shutting down…`);
		for (const s of sessions.list()) {
			if (s.status === "running" || s.status === "starting") {
				try {
					await sessions.stopSession(s.id);
				} catch {
					/* best effort */
				}
			}
		}
		db.close();
		process.exit(0);
	};
	process.on("SIGINT", () => void shutdown("SIGINT"));
	process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
