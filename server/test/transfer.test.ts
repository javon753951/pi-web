import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import AdmZip from "adm-zip";
import { WorkspaceError } from "../src/workspace.js";
import { buildWorkspaceZip, extractZip, sanitizeName, saveUpload } from "../src/transfer.js";

let root: string;
beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), "piweb-tr-"));
});
afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe("sanitizeName", () => {
	it("takes basename only", () => {
		expect(sanitizeName("C:\\Users\\a\\报表.xlsx")).toBe("报表.xlsx");
		expect(sanitizeName("../../etc/passwd")).toBe("passwd");
	});
	it("rejects empty / dot names", () => {
		expect(sanitizeName("..")).toBeNull();
		expect(sanitizeName(".")).toBeNull();
		expect(sanitizeName("")).toBeNull();
		expect(sanitizeName("a/b/")).toBeNull();
	});
});

describe("saveUpload", () => {
	it("writes into workspace root and returns rel path", () => {
		const r = saveUpload(root, "", "data.csv", Buffer.from("a,b\n1,2\n"));
		expect(r.path).toBe("data.csv");
		expect(readFileSync(join(root, "data.csv"), "utf8")).toBe("a,b\n1,2\n");
	});
	it("creates subdirectories on demand", () => {
		const r = saveUpload(root, "uploads/2026", "a.txt", Buffer.from("x"));
		expect(r.path).toBe("uploads/2026/a.txt");
		expect(existsSync(join(root, "uploads", "2026", "a.txt"))).toBe(true);
	});
	it("auto-renames on conflict instead of overwriting", () => {
		saveUpload(root, "", "a.txt", Buffer.from("first"));
		const r = saveUpload(root, "", "a.txt", Buffer.from("second"));
		expect(r.path).toBe("a (1).txt");
		expect(readFileSync(join(root, "a.txt"), "utf8")).toBe("first");
		expect(readFileSync(join(root, "a (1).txt"), "utf8")).toBe("second");
	});
	it("rejects dir outside workspace", () => {
		expect(() => saveUpload(root, "../escape", "a.txt", Buffer.from("x"))).toThrow(WorkspaceError);
	});
	it("unzips .zip uploads into a stem directory and keeps the zip", () => {
		const zip = new AdmZip();
		zip.addFile("inner/one.txt", Buffer.from("one"));
		zip.addFile("two.txt", Buffer.from("two"));
		const buf = zip.toBuffer();
		const r = saveUpload(root, "", "pack.zip", buf, { unzip: true });
		expect(r.path).toBe("pack.zip");
		expect(r.extracted).toEqual(expect.arrayContaining(["pack/inner/one.txt", "pack/two.txt"]));
		expect(readFileSync(join(root, "pack", "inner", "one.txt"), "utf8")).toBe("one");
		expect(existsSync(join(root, "pack.zip"))).toBe(true);
	});
});

describe("extractZip — zip-slip 防护", () => {
	it("adm-zip 写入时会清洗 ../ 前缀，解包落点仍在目标目录内", () => {
		// 上游 sanitize 把 "../evil.txt" 存为 "evil.txt"；我们的 split("/").includes("..")
		// 守卫是对手工构造的恶意 zip 的纵深防御（resolveInWorkspace 再兜一层）。
		const zip = new AdmZip();
		zip.addFile("../evil.txt", Buffer.from("boom"));
		const zipAbs = join(root, "slip.zip");
		writeFileSync(zipAbs, zip.toBuffer());
		const out = extractZip(root, zipAbs, join(root, "dest"));
		expect(out).toEqual(["dest/evil.txt"]);
		expect(existsSync(join(root, "dest", "evil.txt"))).toBe(true);
		expect(existsSync(join(root, "evil.txt"))).toBe(false);
	});
});

describe("buildWorkspaceZip", () => {
	beforeEach(() => {
		writeFileSync(join(root, "b.md"), "b");
		writeFileSync(join(root, "a.txt"), "a");
		mkdirSync(join(root, "sub"));
		writeFileSync(join(root, "sub", "c.log"), "c");
		mkdirSync(join(root, "node_modules"));
		writeFileSync(join(root, "node_modules", "junk.js"), "junk");
	});
	function entriesOf(buf: Buffer): string[] {
		return new AdmZip(buf).getEntries().filter((e) => !e.isDirectory).map((e) => e.entryName);
	}
	it("zips explicit files", () => {
		const buf = buildWorkspaceZip(root, ["a.txt", "b.md"]);
		expect(entriesOf(buf).sort()).toEqual(["a.txt", "b.md"]);
	});
	it("recurses directories and skips ignored dirs", () => {
		const buf = buildWorkspaceZip(root, ["sub"]);
		expect(entriesOf(buf)).toEqual(["sub/c.log"]);
		const whole = buildWorkspaceZip(root, []);
		expect(entriesOf(whole).sort()).toEqual(["a.txt", "b.md", "sub/c.log"]);
	});
	it("throws 404 when nothing to pack", () => {
		expect(() => buildWorkspaceZip(root, ["missing.txt"])).toThrow(WorkspaceError);
	});
});
