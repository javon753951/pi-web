import { existsSync, statSync, unlinkSync } from "node:fs";
import { extname, join } from "node:path";
import type { Db } from "./db.js";
import type { BridgeMessage } from "./rpc-bridge.js";
import type { SessionManager } from "./session-manager.js";
import { resolveInWorkspace, WorkspaceError } from "./workspace.js";

export interface Artifact {
	id: number;
	sessionId: string;
	path: string;
	toolCallId: string | null;
	kind: "code" | "image" | "data" | "other";
	size: number | null;
	mtime: number | null;
	createdAt: number;
}

const WRITE_TOOLS = new Set(["write", "edit", "truncate"]);

const CODE_EXT = new Set([
	".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx", ".txt",
	".html", ".css", ".scss", ".yaml", ".yml", ".toml", ".xml", ".sql", ".py",
	".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp", ".cs",
	".php", ".sh", ".bash", ".zsh", ".ps1", ".bat", ".vue", ".svelte", ".env",
]);
const IMAGE_EXT = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".svg"]);

export function artifactKind(path: string): Artifact["kind"] {
	const ext = extname(path).toLowerCase();
	if (CODE_EXT.has(ext)) return "code";
	if (IMAGE_EXT.has(ext)) return "image";
	if (ext) return "data";
	return "other";
}

/**
 * Track artifacts from RPC tool events. write/edit/truncate tools with a
 * `path` arg are recorded into the artifacts table (deduped per session+path)
 * and the caller broadcasts the new artifact row.
 */
export function trackToolEvent(db: Db, workspaceDir: string, sessionId: string, msg: BridgeMessage): Artifact | null {
	if (msg.type !== "tool_execution_end") return null;
	const toolName = String(msg.toolName);
	if (!WRITE_TOOLS.has(toolName)) return null;
	const args = (msg as any)._args ?? (msg as any).args ?? {};
	const rawPath = typeof args.path === "string" ? args.path : typeof args.file_path === "string" ? args.file_path : null;
	if (!rawPath) return null;

	let abs: string;
	try {
		abs = resolveInWorkspace(workspaceDir, rawPath);
	} catch {
		return null; // outside workspace — not an artifact
	}
	if (!existsSync(abs)) return null;

	let size: number | null = null;
	let mtime: number | null = null;
	try {
		const st = statSync(abs);
		size = st.size;
		mtime = Math.floor(st.mtimeMs);
	} catch {
		/* keep nulls */
	}

	const now = Date.now();
	db.run(
		`INSERT INTO artifacts (session_id, path, tool_call_id, kind, size, mtime, created_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?)
		 ON CONFLICT(session_id, path) DO UPDATE SET
		   tool_call_id = excluded.tool_call_id, size = excluded.size,
		   mtime = excluded.mtime, created_at = excluded.created_at`,
		sessionId, rawPath, String(msg.toolCallId ?? ""), artifactKind(rawPath), size, mtime, now,
	);
	const row = db.get("SELECT * FROM artifacts WHERE session_id = ? AND path = ?", sessionId, rawPath);
	return row ? rowToArtifact(row) : null;
}

function rowToArtifact(row: any): Artifact {
	return {
		id: Number(row.id),
		sessionId: row.session_id,
		path: row.path,
		toolCallId: row.tool_call_id,
		kind: row.kind,
		size: row.size ?? null,
		mtime: row.mtime ?? null,
		createdAt: Number(row.created_at),
	};
}

export function listArtifacts(db: Db, sessionId: string): Artifact[] {
	return db
		.all("SELECT * FROM artifacts WHERE session_id = ? ORDER BY created_at DESC", sessionId)
		.map(rowToArtifact);
}

/** Delete an artifact row + its file (only inside the workspace). */
export function deleteArtifact(sm: SessionManager, db: Db, sessionId: string, artifactId: number): void {
	const row = db.get("SELECT * FROM artifacts WHERE id = ? AND session_id = ?", artifactId, sessionId);
	if (!row) throw new WorkspaceError(404, "产物不存在");
	const workspaceDir = sm.workspaceDir(sessionId);
	try {
		const abs = resolveInWorkspace(workspaceDir, row.path);
		if (existsSync(abs)) unlinkSync(abs);
	} catch {
		/* file already gone or outside — still remove the row */
	}
	db.run("DELETE FROM artifacts WHERE id = ?", artifactId);
}

export function deleteArtifactsForSession(db: Db, sessionId: string): void {
	db.run("DELETE FROM artifacts WHERE session_id = ?", sessionId);
}

/** Re-scan a session's workspace dir into the artifacts table (boot recovery). */
export function rescanWorkspaceArtifacts(db: Db, sessionId: string, workspaceDir: string): number {
	// Only files already tracked are re-validated; full rescan is intentionally
	// not automatic (would flood the table with unrelated files).
	const rows = db.all("SELECT * FROM artifacts WHERE session_id = ?", sessionId);
	let removed = 0;
	for (const row of rows) {
		try {
			const abs = resolveInWorkspace(workspaceDir, row.path);
			if (!existsSync(abs)) {
				db.run("DELETE FROM artifacts WHERE id = ?", row.id);
				removed++;
			}
		} catch {
			db.run("DELETE FROM artifacts WHERE id = ?", row.id);
			removed++;
		}
	}
	return removed;
}
