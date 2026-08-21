import { spawn } from "node:child_process";
import type { AppConfig } from "../config.js";
import { resolveSpawnCommand } from "../config.js";

export type InstallLogLine =
	| { type: "log"; text: string }
	| { type: "done"; ok: true; code: number }
	| { type: "error"; message: string; code: number | null };

export type InstallSink = (line: InstallLogLine) => void;

/**
 * Normalize a user-supplied spec into `pi install` form.
 * - "@scope/name" / "name" → "npm:name"
 * - "npm:name" / "github:user/repo" / "url" → passthrough
 */
export function normalizeSpec(spec: string): string {
	const s = spec.trim();
	if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s;
	return `npm:${s}`;
}

export interface InstallOptions {
	config: AppConfig;
	spec: string;
	remove?: boolean;
	cwd?: string;
	onLine: InstallSink;
}

/** Run `pi install|remove <spec>` and stream stdout/stderr lines. */
export function runInstall(opts: InstallOptions): Promise<void> {
	return new Promise((resolve) => {
		const spec = normalizeSpec(opts.spec);
		const cmd = opts.remove ? "remove" : "install";
		const [command, ...preArgs] = resolveSpawnCommand(opts.config.cliPath);
		const child = spawn(command, [...preArgs, cmd, spec], {
			cwd: opts.cwd ?? opts.config.agentDir,
			env: process.env,
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});

		opts.onLine({ type: "log", text: `> pi ${cmd} ${spec}` });

		const feed = (chunk: Buffer) => {
			for (const line of chunk.toString("utf8").split("\n")) {
				if (line.trim()) opts.onLine({ type: "log", text: line });
			}
		};
		child.stdout?.on("data", feed);
		child.stderr?.on("data", feed);

		child.on("error", (err) => {
			opts.onLine({ type: "error", message: err.message, code: null });
			resolve();
		});
		child.on("close", (code) => {
			if (code === 0) {
				opts.onLine({ type: "done", ok: true, code: 0 });
			} else {
				opts.onLine({ type: "error", message: `pi ${cmd} 退出码 ${code}`, code });
			}
			resolve();
		});
	});
}
