import { describe, it, expect } from "vitest";
import { normalizeSpec } from "../src/marketplace/installer.js";
import { tokenMatches } from "../src/auth.js";

describe("installer spec normalization", () => {
	it("prefixes bare package names with npm:", () => {
		expect(normalizeSpec("@narumitw/pi-plan-mode")).toBe("npm:@narumitw/pi-plan-mode");
		expect(normalizeSpec("pi-chat")).toBe("npm:pi-chat");
	});
	it("passes through schemes", () => {
		expect(normalizeSpec("npm:@x/y")).toBe("npm:@x/y");
		expect(normalizeSpec("github:user/repo")).toBe("github:user/repo");
	});
	it("trims whitespace", () => {
		expect(normalizeSpec("  pi-x  ")).toBe("npm:pi-x");
	});
});

describe("auth token matching", () => {
	it("accepts exact match", () => {
		expect(tokenMatches("abc", "abc")).toBe(true);
	});
	it("rejects mismatches and missing", () => {
		expect(tokenMatches("abc", "abd")).toBe(false);
		expect(tokenMatches("abc", undefined)).toBe(false);
		expect(tokenMatches("abc", null)).toBe(false);
		expect(tokenMatches("abc", "")).toBe(false);
	});
	it("is length-sensitive (timing-safe)", () => {
		expect(tokenMatches("abc", "abcd")).toBe(false);
	});
});
