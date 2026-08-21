import { closeSync, createReadStream, existsSync, openSync, readFileSync, readSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";
import type { FastifyReply } from "fastify";

/** Directories skipped by the file tree (node_modules 类). */
export const IGNORED_DIRS = new Set([
	"node_modules", ".git", ".hg", ".svn", ".idea", ".vscode",
	"dist", "build", "out", "target", "coverage", ".next", ".nuxt",
	".turbo", ".cache", ".parcel-cache", ".pytest_cache", "__pycache__",
	".venv", "venv", "env", ".tox", ".mypy_cache", ".DS_Store",
]);

export const MAX_ENTRIES_PER_DIR = 800;
export const MAX_TREE_ENTRIES = 20_000;

export class WorkspaceError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

/** Resolve a user-supplied path against the workspace root; reject escapes. */
export function resolveInWorkspace(root: string, relPath: string): string {
	const resolved = resolve(root, relPath || ".");
	if (resolved !== root && !resolved.startsWith(root + sep)) {
		throw new WorkspaceError(400, "路径越界：不允许访问工作区之外的目录");
	}
	return resolved;
}

export interface TreeEntry {
	name: string;
	path: string; // relative to workspace root, "/" separated
	type: "dir" | "file";
	size: number | null;
}

function fmtRel(root: string, abs: string): string {
	return relative(root, abs).split(sep).join("/");
}

function dirSize(abs: string, budget: { remaining: number }): number | null {
	let total = 0;
	try {
		const entries = readdirSync(abs, { withFileTypes: true });
		for (const e of entries) {
			if (budget.remaining <= 0) return null;
			budget.remaining--;
			const p = join(abs, e.name);
			if (e.isDirectory()) {
				if (IGNORED_DIRS.has(e.name)) continue;
				const s = dirSize(p, budget);
				if (s === null) return null;
				total += s;
			} else {
				try {
					total += statSync(p).size;
				} catch {
					/* skip */
				}
			}
		}
	} catch {
		return null;
	}
	return total;
}

/** List one directory level (lazy expansion; the frontend fetches children on demand). */
export function listDir(root: string, relPath: string): TreeEntry[] {
	const abs = resolveInWorkspace(root, relPath);
	if (!existsSync(abs)) throw new WorkspaceError(404, "目录不存在");
	const budget = { remaining: MAX_TREE_ENTRIES };
	const entries: TreeEntry[] = [];
	let dirCount = 0;
	for (const e of readdirSync(abs, { withFileTypes: true })) {
		if (entries.length >= MAX_ENTRIES_PER_DIR) break;
		const absPath = join(abs, e.name);
		const rel = fmtRel(root, absPath);
		if (e.isDirectory()) {
			if (IGNORED_DIRS.has(e.name)) continue;
			const size = dirSize(absPath, budget);
			entries.push({ name: e.name, path: rel, type: "dir", size });
			dirCount++;
		} else if (e.isFile()) {
			let size: number | null = null;
			try {
				size = statSync(absPath).size;
			} catch {
				/* skip */
			}
			entries.push({ name: e.name, path: rel, type: "file", size });
		}
	}
	entries.sort((a, b) => {
		if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
		return a.name.localeCompare(b.name);
	});
	return entries;
}

// ------------------------------------------------------------------ preview

const TEXT_EXT = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt",
	".html", ".htm", ".css", ".scss", ".less", ".yaml", ".yml", ".toml", ".xml",
	".sql", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp",
	".cs", ".php", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".env", ".gitignore",
	".lock", ".log", ".csv", ".tsv", ".ini", ".cfg", ".conf", ".vue", ".svelte",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg", ".ico"]);

export const MAX_PREVIEW_TEXT = 512 * 1024;
export const MAX_PREVIEW_IMAGE = 5 * 1024 * 1024;

export interface FilePreview {
	name: string;
	path: string;
	kind: "text" | "image" | "binary" | "notfound";
	content?: string;
	dataUrl?: string;
	size: number;
	truncated?: boolean;
}

function extOf(name: string): string {
	return extname(name).toLowerCase();
}

export function previewKind(path: string): "text" | "image" | "binary" {
	const ext = extOf(path);
	if (TEXT_EXT.has(ext)) return "text";
	if (IMAGE_EXT.has(ext)) return "image";
	return "binary";
}

function basename(p: string): string {
	return p.split(/[\\/]/).pop() ?? p;
}

function mimeOf(ext: string): string {
	const map: Record<string, string> = {
		".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
		".gif": "image/gif", ".webp": "image/webp", ".bmp": "image/bmp",
		".svg": "image/svg+xml", ".ico": "image/x-icon",
	};
	return map[ext] ?? "application/octet-stream";
}

function readFileCap(abs: string, cap: number): Buffer {
	const st = statSync(abs);
	if (st.size > cap) {
		const fd = openSync(abs, "r");
		try {
			const buf = Buffer.alloc(cap);
			readSync(fd, buf, 0, cap, 0);
			return buf;
		} finally {
			closeSync(fd);
		}
	}
	return readFileSync(abs);
}

export function previewFile(root: string, relPath: string): FilePreview {
	const abs = resolveInWorkspace(root, relPath);
	if (!existsSync(abs)) throw new WorkspaceError(404, "文件不存在");
	const st = statSync(abs);
	if (!st.isFile()) throw new WorkspaceError(400, "不是文件");
	const kind = previewKind(abs);
	const base: FilePreview = { name: basename(abs), path: relPath, kind, size: st.size };
	if (kind === "text") {
		const buf = readFileCap(abs, MAX_PREVIEW_TEXT);
		const truncated = buf.length < st.size;
		return { ...base, content: buf.toString("utf8"), truncated };
	}
	if (kind === "image") {
		if (st.size > MAX_PREVIEW_IMAGE) return { ...base, kind: "binary" };
		const buf = readFileCap(abs, MAX_PREVIEW_IMAGE);
		return { ...base, dataUrl: `data:${mimeOf(extOf(abs))};base64,${buf.toString("base64")}` };
	}
	return base;
}

// ------------------------------------------------------------------ download

export function sendDownload(reply: FastifyReply, root: string, relPath: string): void {
	const abs = resolveInWorkspace(root, relPath);
	if (!existsSync(abs)) throw new WorkspaceError(404, "文件不存在");
	const st = statSync(abs);
	if (!st.isFile()) throw new WorkspaceError(400, "不是文件");
	const name = basename(abs);
	reply
		.header("Content-Type", "application/octet-stream")
		.header("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(name)}`)
		.send(createReadStream(abs));
}
