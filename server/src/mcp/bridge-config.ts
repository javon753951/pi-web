import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config.js";
import type { Db } from "../db.js";

export interface McpServerRow {
	id: string;
	name: string;
	command: string;
	args: string;
	env: string; // JSON object
	enabled: number;
	created_at: number;
}

export interface McpServerConfig {
	name: string;
	command: string;
	args: string[];
	env: Record<string, string>;
}

/**
 * Generate data/mcp/mcp-bridge-config.json from the mcp_servers table.
 * Returns the server list (or null when nothing enabled) so callers can decide
 * whether to attach the mcp-bridge extension to spawned sessions.
 */
export function writeMcpConfigIfNeeded(config: AppConfig, db: Db): McpServerConfig[] | null {
	const rows = db.all<McpServerRow>(
		"SELECT * FROM mcp_servers WHERE enabled = 1 ORDER BY created_at ASC",
	);
	if (rows.length === 0) return null;

	const servers: McpServerConfig[] = rows.map((r) => {
		let env: Record<string, string> = {};
		try {
			env = JSON.parse(r.env || "{}");
		} catch {
			env = {};
		}
		const args = r.args
			? r.args.match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g)?.map((a) => a.replace(/^["']|["']$/g, "")) ?? []
			: [];
		return { name: r.name, command: r.command, args, env };
	});

	writeFileSync(join(config.mcpDir, "mcp-bridge-config.json"), JSON.stringify(servers, null, 2));
	return servers;
}

/** Path to the mcp-bridge extension that spawned pi sessions load. */
export function mcpBridgeExtensionPath(config: AppConfig): string | null {
	const p = join(config.mcpDir, "mcp-bridge.ts");
	return existsSync(p) ? p : null;
}
