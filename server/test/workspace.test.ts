import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, isAbsolute } from "node:path";
import {
	listDir,
	previewFile,
	resolveInWorkspace,
	WorkspaceError,
	IGNORED_DIRS,
} from "../src/workspace.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "piweb-ws-"));
	mkdirSync(join(root, "src", "api"), { recursive: true });
	mkdirSync(join(root, "node_modules"), { recursive: true });
	writeFileSync(join(root, "src", "index.ts"), "export const x = 1;\n");
	writeFileSync(join(root, "src", "api", "orders.ts"), "export const o = 2;\n");
	writeFileSync(join(root, "node_modules", "junk.js"), "junk");
	writeFileSync(join(root, "README.md"), "# hi\n".repeat(200_000)); // ~1MB > 512KB cap
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("resolveInWorkspace — path traversal", () => {
	it("rejects .. escapes", () => {
		expect(() => resolveInWorkspace(root, "../../etc/passwd")).toThrow(WorkspaceError);
		expect(() => resolveInWorkspace(root, "src/../../../etc/passwd")).toThrow(WorkspaceError);
	});
	it("rejects absolute paths outside root", () => {
		// 平台相关断言："C:/Windows/system32" 只在 Windows 上是绝对路径；
	// 在 Linux 上它只是一个以 "C:" 开头的普通相对目录名，守卫不该误伤。
	// 所以按本平台的 isAbsolute 分支期朌：绝对 → 拒绝，相对 → 放行。
		const winPath = "C:/Windows/system32";
		if (isAbsolute(winPath)) {
			expect(() => resolveInWorkspace(root, winPath)).toThrow(WorkspaceError);
		} else {
			expect(() => resolveInWorkspace(root, winPath)).not.toThrow();
		}
		expect(() => resolveInWorkspace(root, "/etc/passwd")).toThrow(WorkspaceError);
	});
	it("accepts paths inside root", () => {
		expect(resolveInWorkspace(root, "src/index.ts")).toBe(join(root, "src", "index.ts"));
		expect(resolveInWorkspace(root, ".")).toBe(root);
	});
});

describe("listDir", () => {
	it("ignores node_modules-like dirs", () => {
		const entries = listDir(root, "");
		const names = entries.map((e) => e.name);
		expect(names).toContain("src");
		expect(names).toContain("README.md");
		expect(names).not.toContain("node_modules");
	});
	it("sorts dirs first then files", () => {
		const entries = listDir(root, "");
		const first = entries[0]!;
		expect(first.type).toBe("dir");
		expect(first.name).toBe("src");
	});
	it("lists nested dirs lazily", () => {
		const entries = listDir(root, "src");
		expect(entries.map((e) => e.name)).toEqual(["api", "index.ts"]);
	});
	it("throws 404 for missing dir", () => {
		expect(() => listDir(root, "nope")).toThrow(WorkspaceError);
	});
});

describe("previewFile", () => {
	it("returns text content", () => {
		const p = previewFile(root, "src/index.ts");
		expect(p.kind).toBe("text");
		expect(p.content).toContain("export const x");
		expect(p.size).toBeGreaterThan(0);
	});
	it("truncates oversized text", () => {
		const p = previewFile(root, "README.md");
		expect(p.truncated).toBe(true);
	});
	it("rejects traversal in preview", () => {
		expect(() => previewFile(root, "../secret.txt")).toThrow(WorkspaceError);
	});
});
