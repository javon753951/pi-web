import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";

/**
 * Locate the pi-web project root by walking up from this file until we find
 * the root package.json (the one with a "workspaces" field).
 * Works in dev (server/src/config.ts) and prod (server/dist/config.js).
 */
function findProjectRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (let i = 0; i < 8; i++) {
		const pkgPath = join(dir, "package.json");
		try {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
			if (Array.isArray(pkg.workspaces)) return dir;
		} catch {
			/* keep walking up */
		}
		dir = dirname(dir);
	}
	return process.cwd();
}

export const PROJECT_ROOT = findProjectRoot();

export interface AppConfig {
	port: number;
	/** 对外公布的端口（二维码/局域网链接用）。dev 模式指向 vite 端口，docker 可指向宿主映射端口。 */
	publicPort: number;
	host: string;
	dataDir: string;
	agentDir: string;
	cliPath: string;
	token: string;
	sessionsDir: string;
	workspacesDir: string;
	mcpDir: string;
	extensionsDir: string;
	webDistDir: string;
}

function env(name: string): string | undefined {
	return process.env[name];
}

function readOrCreateToken(dataDir: string): string {
	const envToken = env("PI_WEB_TOKEN");
	if (envToken) return envToken;
	const file = join(dataDir, ".token");
	if (existsSync(file)) {
		const t = readFileSync(file, "utf8").trim();
		if (t) return t;
	}
	const token = `piweb_${randomBytes(24).toString("base64url")}`;
	writeFileSync(file, token + "\n", { mode: 0o600 });
	return token;
}

function detectCliPath(agentDir: string): string {
	const explicit = env("PI_CLI_PATH");
	if (explicit && existsSync(explicit)) return explicit;
	const agentInstall = join(agentDir, "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js");
	if (existsSync(agentInstall)) return agentInstall;
	return "pi"; // fall back to PATH
}

/**
 * Resolve `pi` invocation to a spawnable [command, ...preArgs].
 * On Windows a bare `.js` path cannot be spawned directly (EFTYPE);
 * it must be run through the current node executable.
 */
export function resolveSpawnCommand(cliPath: string): [string, ...string[]] {
	if (/\.[cm]?js$/i.test(cliPath) && existsSync(cliPath)) {
		return [process.execPath, cliPath];
	}
	return [cliPath];
}

export function loadConfig(): AppConfig {
	const dataDir = resolve(env("PI_WEB_DATA") || join(PROJECT_ROOT, "data"));
	const agentDir = resolve(env("PI_AGENT_DIR") || join(homedir(), ".pi", "agent"));
	const port = Number(env("PI_WEB_PORT") || 8787);
	const publicPort = Number(env("PI_WEB_PUBLIC_PORT") || port);
	const host = env("PI_WEB_HOST") || "127.0.0.1";

	const sessionsDir = join(dataDir, "sessions");
	const workspacesDir = join(dataDir, "workspaces");
	const mcpDir = join(dataDir, "mcp");

	for (const dir of [dataDir, sessionsDir, workspacesDir, mcpDir]) {
		mkdirSync(dir, { recursive: true });
	}

	return {
		port,
		publicPort,
		host,
		dataDir,
		agentDir,
		cliPath: detectCliPath(agentDir),
		token: readOrCreateToken(dataDir),
		sessionsDir,
		workspacesDir,
		mcpDir,
		extensionsDir: join(PROJECT_ROOT, "extensions"),
		webDistDir: join(PROJECT_ROOT, "web", "dist"),
	};
}
