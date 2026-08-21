import { describe, it, expect } from "vitest";
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { createJsonlParser } from "../../src/jsonl.js";

/**
 * 真实 pi 冒烟测试：spawn `pi --mode rpc --no-session`，验证
 * get_state / get_available_models 往返。无需 API key。
 * 运行：npm run smoke （SMOKE=1 时启用）
 */

const CLI_CANDIDATES = [
	process.env.PI_CLI_PATH,
	join(homedir(), ".pi", "agent", "npm", "node_modules", "@earendil-works", "pi-coding-agent", "dist", "cli.js"),
	"pi",
].filter(Boolean) as string[];

function findCli(): string | null {
	for (const c of CLI_CANDIDATES) {
		if (c === "pi" || existsSync(c)) return c;
	}
	return null;
}

const cli = findCli();
const enabled = !!process.env.SMOKE && !!cli;

function rpcRoundtrip(commands: object[]): Promise<any[]> {
	return new Promise((resolve, reject) => {
		const args = ["--mode", "rpc", "--no-session", "--no-extensions", "--no-skills", "--no-themes", "--no-prompt-templates"];
		const command = cli!.endsWith(".js") ? process.execPath : cli!;
		const pre = cli!.endsWith(".js") ? [cli!] : [];
		const child = spawn(command, [...pre, ...args], {
			stdio: ["pipe", "pipe", "pipe"],
			windowsHide: true,
		});
		const responses: any[] = [];
		const stderr: string[] = [];
		const parser = createJsonlParser((line) => {
			try {
				const msg = JSON.parse(line);
				if (msg.type === "response") responses.push(msg);
			} catch {
				/* ignore */
			}
		});
		child.stdout!.on("data", (c: Buffer) => parser.write(c));
		child.stderr!.on("data", (c: Buffer) => stderr.push(c.toString("utf8")));
		const timer = setTimeout(() => {
			child.kill();
			reject(new Error(`timeout; stderr: ${stderr.slice(-5).join("")}`));
		}, 45_000);
		child.on("error", (err) => {
			clearTimeout(timer);
			reject(err);
		});
		child.on("close", () => {
			clearTimeout(timer);
			resolve(responses);
		});
		for (const cmd of commands) {
			child.stdin!.write(JSON.stringify(cmd) + "\n");
		}
		setTimeout(() => {
			try {
				child.stdin!.end();
			} catch {
				/* ignore */
			}
		}, 10_000);
	});
}

describe.skipIf(!enabled)("pi RPC integration smoke (SMOKE=1)", () => {
	it("get_state roundtrip", { timeout: 60_000 }, async () => {
		const responses = await rpcRoundtrip([{ id: "s1", type: "get_state" }]);
		const resp = responses.find((r) => r.id === "s1");
		expect(resp).toBeTruthy();
		expect(resp.success).toBe(true);
		expect(resp.data).toHaveProperty("sessionId");
		expect(resp.data).toHaveProperty("thinkingLevel");
	});

	it("get_available_models returns models", { timeout: 60_000 }, async () => {
		const responses = await rpcRoundtrip([{ id: "m1", type: "get_available_models" }]);
		const resp = responses.find((r) => r.id === "m1");
		expect(resp).toBeTruthy();
		expect(resp.success).toBe(true);
		expect(Array.isArray(resp.data.models)).toBe(true);
	});

	it("unknown command returns success:false", { timeout: 60_000 }, async () => {
		const responses = await rpcRoundtrip([{ id: "x1", type: "definitely_not_a_command" }]);
		const resp = responses.find((r) => r.id === "x1");
		expect(resp?.success).toBe(false);
	});
});
