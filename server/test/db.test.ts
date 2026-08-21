import { describe, it, expect } from "vitest";
import { openDb, migrate, type Db } from "../src/db.js";

describe("db", () => {
	it("opens in-memory sqlite and migrates schema", () => {
		const db: Db = openDb(":memory:");
		migrate(db);
		const tables = db.all<{ name: string }>(
			"SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
		);
		const names = tables.map((t) => t.name);
		expect(names).toContain("sessions");
		expect(names).toContain("settings");
		expect(names).toContain("mcp_servers");
		expect(names).toContain("artifacts");
		expect(names).toContain("installed_packages");
		db.close();
	});

	it("round-trips sessions", () => {
		const db = openDb(":memory:");
		migrate(db);
		const now = Date.now();
		db.run(
			"INSERT INTO sessions (id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
			"s1", "测试", "running", now, now,
		);
		const row = db.get("SELECT * FROM sessions WHERE id = ?", "s1");
		expect(row.name).toBe("测试");
		expect(row.status).toBe("running");
		db.run("UPDATE sessions SET status = ? WHERE id = ?", "crashed", "s1");
		expect(db.get("SELECT status FROM sessions WHERE id = ?", "s1").status).toBe("crashed");
		db.close();
	});

	it("settings upsert", () => {
		const db = openDb(":memory:");
		migrate(db);
		db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "k", "1");
		db.run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", "k", "2");
		expect(db.get("SELECT value FROM settings WHERE key = ?", "k").value).toBe("2");
		db.close();
	});
});
