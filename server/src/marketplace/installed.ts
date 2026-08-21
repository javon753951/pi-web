import { readdirSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "../config.js";

export interface InstalledItem {
	name: string;
	source: "extension" | "skill" | "package";
	path: string;
	description?: string;
	piField?: Record<string, unknown>;
	version?: string;
}

function readJsonSafe<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

/**
 * 已装扫描：
 * 1. ~/.pi/agent/extensions/*.ts
 * 2. ~/.pi/agent/skills/<name>/SKILL.md
 * 3. ~/.pi/agent/npm/node_modules/@scope/pi-* （package.json 含 pi 字段）
 */
export function scanInstalled(config: AppConfig): InstalledItem[] {
	const out: InstalledItem[] = [];

	const extDir = join(config.agentDir, "extensions");
	if (existsSync(extDir)) {
		for (const f of readdirSync(extDir)) {
			if (f.endsWith(".ts") || f.endsWith(".mjs") || f.endsWith(".js")) {
				out.push({ name: f.replace(/\.(ts|mjs|js)$/, ""), source: "extension", path: join(extDir, f) });
			}
		}
	}

	const skillsDir = join(config.agentDir, "skills");
	if (existsSync(skillsDir)) {
		for (const d of readdirSync(skillsDir, { withFileTypes: true })) {
			if (d.isDirectory() && existsSync(join(skillsDir, d.name, "SKILL.md"))) {
				out.push({ name: d.name, source: "skill", path: join(skillsDir, d.name, "SKILL.md") });
			}
		}
	}

	const npmRoot = join(config.agentDir, "npm", "node_modules");
	if (existsSync(npmRoot)) {
		const scopes = readdirSync(npmRoot, { withFileTypes: true });
		for (const s of scopes) {
			const base = join(npmRoot, s.name);
			const dirs = s.isDirectory() && s.name.startsWith("@")
				? readdirSync(base, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith("pi-")).map((d) => join(base, d.name))
				: s.isDirectory() && s.name.startsWith("pi-")
					? [base]
					: [];
			for (const pkgDir of dirs) {
				const pkg = readJsonSafe<{ name?: string; description?: string; version?: string; pi?: Record<string, unknown> }>(
					join(pkgDir, "package.json"),
				);
				if (!pkg?.pi) continue;
				out.push({
					name: pkg.name ?? pkgDir,
					source: "package",
					path: pkgDir,
					description: pkg.description,
					piField: pkg.pi,
					version: pkg.version,
				});
			}
		}
	}

	out.sort((a, b) => a.name.localeCompare(b.name));
	return out;
}
