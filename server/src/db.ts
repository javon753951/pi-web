import { createRequire } from "node:module";
import { join } from "node:path";

export type SqlValue = string | number | bigint | Uint8Array | null;

export interface Db {
	run(sql: string, ...params: SqlValue[]): void;
	get<T = any>(sql: string, ...params: SqlValue[]): T | undefined;
	all<T = any>(sql: string, ...params: SqlValue[]): T[];
	exec(sql: string): void;
	close(): void;
}

function sqliteName(): "node:sqlite" | "better-sqlite3" {
	try {
		createRequire(import.meta.url)("node:sqlite");
		return "node:sqlite";
	} catch {
		return "better-sqlite3";
	}
}

/**
 * Open the pi-web metadata database.
 *
 * Primary backend: node:sqlite (built into Node 22.5+, no native deps).
 * Fallback: better-sqlite3 (optionalDependency).
 */
export function openDb(dbPath: string): Db {
	const require = createRequire(import.meta.url);
	const name = sqliteName();
	if (name === "node:sqlite") {
		const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");
		const db = new DatabaseSync(dbPath);
		db.exec("PRAGMA journal_mode = WAL;");
		return {
			run(sql, ...params) {
				db.prepare(sql).run(...params);
			},
			get(sql, ...params) {
				return db.prepare(sql).get(...params) as any;
			},
			all(sql, ...params) {
				return db.prepare(sql).all(...params) as any[];
			},
			exec(sql) {
				db.exec(sql);
			},
			close() {
				db.close();
			},
		};
	}

	const Database = require("better-sqlite3") as new (path: string) => any;
	const db = new Database(dbPath);
	db.pragma("journal_mode = WAL");
	return {
		run(sql, ...params) {
			db.prepare(sql).run(...params);
		},
		get(sql, ...params) {
			return db.prepare(sql).get(...params);
		},
		all(sql, ...params) {
			return db.prepare(sql).all(...params);
		},
		exec(sql) {
			db.exec(sql);
		},
		close() {
			db.close();
		},
	};
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'stopped',
  engine TEXT NOT NULL DEFAULT 'pi',
  model TEXT,
  model_provider TEXT,
  thinking_level TEXT,
  has_history INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS mcp_servers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  command TEXT NOT NULL,
  args TEXT NOT NULL DEFAULT '',
  env TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS installed_packages (
  name TEXT PRIMARY KEY,
  spec TEXT NOT NULL,
  version TEXT,
  installed_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL,
  path TEXT NOT NULL,
  tool_call_id TEXT,
  kind TEXT NOT NULL DEFAULT 'other',
  size INTEGER,
  mtime INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(session_id, path)
);
CREATE INDEX IF NOT EXISTS idx_artifacts_session ON artifacts(session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_updated ON sessions(updated_at DESC);
`;

export function migrate(db: Db): void {
	db.exec(SCHEMA);
}

export function dbPath(dataDir: string): string {
	return join(dataDir, "pi-web.db");
}
