import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import AdmZip from "adm-zip";
import * as iconv from "iconv-lite";
import { IGNORED_DIRS, MAX_TREE_ENTRIES, WorkspaceError, resolveInWorkspace } from "./workspace.js";

// ------------------------------------------------------------------ upload

/** 单文件上传体积上限（与路由 bodyLimit 保持一致）。 */
export const MAX_UPLOAD_BYTES = 256 * 1024 * 1024;
/** 打包下载的总字节上限，防止把宿主磁盘拖进内存。 */
export const MAX_ZIP_TOTAL_BYTES = 1024 * 1024 * 1024;

function fmtRel(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

/**
 * 清洗用户提供的文件名：只取 basename、去控制字符、限长。
 * 返回 null 表示这个名字没法安全使用。
 */
export function sanitizeName(name: string): string | null {
	let n = name.split(/[\\/]/).pop() ?? "";
	n = Array.from(n).filter((c) => c.charCodeAt(0) >= 32 && c.charCodeAt(0) !== 127).join("").trim();
	if (!n || n === "." || n === "..") return null;
	if (n.length > 255) n = n.slice(0, 255);
	return n;
}

/** 目标已存在时自动改名：data.xlsx → data (1).xlsx → data (2).xlsx … */
export function uniquePath(abs: string): string {
	if (!existsSync(abs)) return abs;
	const dir = dirname(abs);
	const ext = extname(abs);
	const base = ext ? basename(abs.slice(0, -ext.length)) : basename(abs);
	for (let i = 1; i < 1000; i++) {
		const candidate = join(dir, `${base} (${i})${ext}`);
		if (!existsSync(candidate)) return candidate;
	}
	throw new WorkspaceError(409, "同名文件过多，请先清理工作区");
}

export interface SaveResult {
	/** 落盘后的相对路径（"/" 分隔）。 */
	path: string;
	/** zip 解包出来的文件相对路径（仅 unzip 时有值）。 */
	extracted?: string[];
}

/**
 * 保存一个上传文件到工作区。
 * - dir 为工作区内相对目录（不存在则创建），name 经清洗后自动改名防覆盖
 * - opts.unzip 且是 .zip 时，解包到同名目录（zip 原文件保留）
 */
export function saveUpload(root: string, dir: string, name: string, buf: Buffer, opts?: { unzip?: boolean }): SaveResult {
	if (buf.length > MAX_UPLOAD_BYTES) throw new WorkspaceError(413, "文件超过 256MB 上限");
	const clean = sanitizeName(name);
	if (!clean) throw new WorkspaceError(400, "非法文件名");

	const targetDir = resolveInWorkspace(root, dir || ".");
	mkdirSync(targetDir, { recursive: true });
	const abs = uniquePath(join(targetDir, clean));
	writeFileSync(abs, buf);

	const result: SaveResult = { path: fmtRel(root, abs) };
	if (opts?.unzip && /\.zip$/i.test(clean)) {
		const stem = clean.replace(/\.zip$/i, "");
		const destAbs = uniquePath(join(targetDir, stem));
		mkdirSync(destAbs, { recursive: true });
		result.extracted = extractZip(root, abs, destAbs);
	}
	return result;
}

// -------------------------------------------------------------------- unzip

/** zip 条目名解码：UTF-8 标志位优先，否则按 GBK（Windows 压缩中文默认）。 */
function decodeEntryName(raw: Buffer, utf8Flag: boolean): string {
	if (utf8Flag) return raw.toString("utf8");
	try {
		return iconv.decode(raw, "gbk");
	} catch {
		return raw.toString("utf8");
	}
}

/**
 * 把 zip 解包到 destDir（工作区内绝对路径），返回解出的相对路径列表。
 * 拒绝绝对路径 / `..` 越界条目（zip-slip）；目录条目自动创建。
 */
export function extractZip(root: string, zipAbs: string, destDir: string): string[] {
	const zip = new AdmZip(zipAbs);
	const out: string[] = [];
	for (const entry of zip.getEntries()) {
		const utf8 = (entry.header.flags & 0x800) !== 0;
		const entryName = decodeEntryName(entry.rawEntryName, utf8).replace(/\\/g, "/");
		if (!entryName || entryName.startsWith("/") || entryName.split("/").includes("..")) {
			throw new WorkspaceError(400, `zip 内含不安全路径：${entryName}`);
		}
		const abs = resolveInWorkspace(destDir, entryName);
		if (entry.isDirectory) {
			mkdirSync(abs, { recursive: true });
			continue;
		}
		mkdirSync(dirname(abs), { recursive: true });
		writeFileSync(abs, entry.getData());
		out.push(fmtRel(root, abs));
	}
	return out;
}

// --------------------------------------------------------------- zip export

interface WalkBudget {
	entries: number;
	bytes: number;
}

/** 递归收集目录下所有文件（跳过 IGNORED_DIRS），返回 [abs, zipEntryName] 列表。 */
function walkDir(absDir: string, prefix: string, budget: WalkBudget, out: Array<[string, string]>): void {
	let names: string[];
	try {
		names = readdirSync(absDir);
	} catch {
		return;
	}
	for (const n of names) {
		if (budget.entries <= 0 || budget.bytes > MAX_ZIP_TOTAL_BYTES) return;
		if (IGNORED_DIRS.has(n) || n === ".DS_Store") continue;
		const abs = join(absDir, n);
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		const entryName = prefix ? `${prefix}/${n}` : n;
		if (st.isDirectory()) {
			walkDir(abs, entryName, budget, out);
		} else if (st.isFile()) {
			budget.entries--;
			budget.bytes += st.size;
			if (budget.bytes > MAX_ZIP_TOTAL_BYTES) {
				throw new WorkspaceError(413, "打包内容超过 1GB 上限");
			}
			out.push([abs, entryName]);
		}
	}
}

/**
 * 把工作区内多个路径（文件或目录，目录递归）打包为 zip Buffer。
 * relPaths 为 "/" 分隔的工作区相对路径；空数组表示整个工作区。
 */
export function buildWorkspaceZip(root: string, relPaths: string[]): Buffer {
	const budget: WalkBudget = { entries: MAX_TREE_ENTRIES, bytes: 0 };
	const files: Array<[string, string]> = [];
	const seen = new Set<string>();

	for (const rel of relPaths.length > 0 ? relPaths : ["."]) {
		const abs = resolveInWorkspace(root, rel);
		if (!existsSync(abs)) continue; // 单个路径不存在时跳过而非整体失败
		let st;
		try {
			st = statSync(abs);
		} catch {
			continue;
		}
		const base = rel === "." || rel === "" ? "" : rel.replace(/\/+$/, "");
		if (st.isDirectory()) {
			walkDir(abs, base, budget, files);
		} else if (st.isFile()) {
			if (seen.has(abs)) continue;
			seen.add(abs);
			budget.entries--;
			budget.bytes += st.size;
			if (budget.bytes > MAX_ZIP_TOTAL_BYTES) throw new WorkspaceError(413, "打包内容超过 1GB 上限");
			files.push([abs, base]);
		}
	}
	if (files.length === 0) throw new WorkspaceError(404, "没有可打包的文件");

	const zip = new AdmZip();
	for (const [abs, entryName] of files) zip.addFile(entryName, readFileSync(abs));
	return zip.toBuffer();
}
