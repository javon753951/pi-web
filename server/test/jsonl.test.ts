import { describe, it, expect } from "vitest";
import { splitJsonLines } from "../src/jsonl.js";

describe("JSONL framing", () => {
	it("splits on LF only", () => {
		const input = '{"a":1}\n{"b":2}\n';
		expect(splitJsonLines(input)).toEqual(['{"a":1}', '{"b":2}']);
	});

	it("strips trailing CR (CRLF input)", () => {
		const input = '{"a":1}\r\n{"b":2}\r\n';
		expect(splitJsonLines(input)).toEqual(['{"a":1}', '{"b":2}']);
	});

	it("does NOT split on U+2028/U+2029 inside strings", () => {
		// U+2028 and U+2029 are valid inside JSON strings; naive readers
		// (node:readline) would split on them — we must not.
		const line = JSON.stringify({ text: "line1\u2028line2\u2029end" });
		const input = `${line}\n{"x":1}\n`;
		const out = splitJsonLines(input);
		expect(out).toHaveLength(2);
		expect(JSON.parse(out[0]!).text).toBe("line1\u2028line2\u2029end");
	});

	it("handles chunked input across buffer boundaries", async () => {
		const line1 = '{"type":"message_update","n":12345}';
		const line2 = '{"type":"response","id":"r1"}';
		const all = `${line1}\n${line2}\n`;
		// Feed one byte at a time.
		const lines: string[] = [];
		const parser = (await import("../src/jsonl.js")).createJsonlParser((l) => lines.push(l));
		for (let i = 0; i < all.length; i++) {
			parser.write(all[i]);
		}
		parser.end();
		expect(lines).toEqual([line1, line2]);
	});

	it("emits a trailing line without newline on end()", () => {
		expect(splitJsonLines('{"a":1}')).toEqual(['{"a":1}']);
	});

	it("parses real pi RPC payloads", () => {
		const input = [
			'{"id":"t1","type":"response","command":"get_state","success":true,"data":{"thinkingLevel":"max"}}',
			'{"type":"extension_ui_request","id":"u1","method":"notify","message":"hi"}',
		].join("\n") + "\n";
		const out = splitJsonLines(input);
		expect(JSON.parse(out[1]!).method).toBe("notify");
	});
});
