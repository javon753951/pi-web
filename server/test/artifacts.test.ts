import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openDb, migrate, type Db } from "../src/db.js";
import {
	trackToolEvent,
	listArtifacts,
	deleteArtifact,
	artifactKind,
} from "../src/artifacts.js";

let db: Db;
let wsDir: string;
const SID = "sess-1";

beforeEach(() => {
	db = openDb(":memory:");
	migrate(db);
	wsDir = mkdtempSync(join(tmpdir(), "piweb-art-"));
});

afterEach(() => {
	db.close();
	rmSync(wsDir, { recursive: true, force: true });
});

describe("artifacts", () => {
	it("tracks write tool_execution_end", () => {
		mkdirSync(join(wsDir, "src"), { recursive: true });
		writeFileSync(join(wsDir, "src", "a.ts"), "export const a = 1;");
		const art = trackToolEvent(db, wsDir, SID, {
			type: "tool_execution_end",
			toolCallId: "tc1",
			toolName: "write",
			args: { path: "src/a.ts", content: "x" },
			result: { content: [{ type: "text", text: "ok" }] },
			isError: false,
		} as any);
		expect(art).not.toBeNull();
		expect(art!.path).toBe("src/a.ts");
		expect(art!.kind).toBe("code");
		expect(art!.size).toBeGreaterThan(0);
		expect(listArtifacts(db, SID)).toHaveLength(1);
	});

	it("dedupes by session+path", () => {
		writeFileSync(join(wsDir, "a.md"), "v1");
		trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t1", toolName: "write", args: { path: "a.md" } } as any);
		writeFileSync(join(wsDir, "a.md"), "v2-longer");
		trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t2", toolName: "edit", args: { path: "a.md" } } as any);
		const arts = listArtifacts(db, SID);
		expect(arts).toHaveLength(1);
		expect(arts[0]!.size).toBe(9); // "v2-longer"
		expect(arts[0]!.toolCallId).toBe("t2");
	});

	it("ignores non-write tools and out-of-workspace paths", () => {
		const r1 = trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t", toolName: "bash", args: {} } as any);
		expect(r1).toBeNull();
		const r2 = trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t", toolName: "write", args: { path: "../../evil.txt" } } as any);
		expect(r2).toBeNull();
	});

	it("skips missing files", () => {
		const r = trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t", toolName: "write", args: { path: "ghost.ts" } } as any);
		expect(r).toBeNull();
	});

	it("delete removes row + file", () => {
		writeFileSync(join(wsDir, "b.ts"), "x");
		const art = trackToolEvent(db, wsDir, SID, { type: "tool_execution_end", toolCallId: "t", toolName: "write", args: { path: "b.ts" } } as any)!;
		deleteArtifact({ workspaceDir: () => wsDir } as any, db, SID, art.id);
		expect(listArtifacts(db, SID)).toHaveLength(0);
		expect(existsSync(join(wsDir, "b.ts"))).toBe(false);
	});

	it("classifies kinds", () => {
		expect(artifactKind("a.ts")).toBe("code");
		expect(artifactKind("x.png")).toBe("image");
		expect(artifactKind("a.pdf")).toBe("data");
		expect(artifactKind("Makefile")).toBe("other");
	});
});
