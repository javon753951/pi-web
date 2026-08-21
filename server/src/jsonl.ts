import type { Readable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

/**
 * Strict JSONL framing: records are split on LF only.
 *
 * Payload strings may contain other Unicode separators such as U+2028/U+2029,
 * so we intentionally do NOT use node:readline (which splits on those).
 * A trailing \r (from CRLF input) is stripped.
 *
 * Mirrors pi's own attachJsonlLineReader semantics.
 */
export function createJsonlParser(onLine: (line: string) => void): {
	write(chunk: Buffer | string): void;
	end(): void;
} {
	const decoder = new StringDecoder("utf8");
	let buffer = "";

	const emitLine = (line: string) => {
		onLine(line.endsWith("\r") ? line.slice(0, -1) : line);
	};

	return {
		write(chunk) {
			buffer += typeof chunk === "string" ? chunk : decoder.write(chunk);
			while (true) {
				const nl = buffer.indexOf("\n");
				if (nl === -1) return;
				emitLine(buffer.slice(0, nl));
				buffer = buffer.slice(nl + 1);
			}
		},
		end() {
			buffer += decoder.end();
			if (buffer.length > 0) emitLine(buffer);
			buffer = "";
		},
	};
}

/** Split a raw buffer/blob of JSONL into individual lines (test helper). */
export function splitJsonLines(input: Buffer | string): string[] {
	const lines: string[] = [];
	const parser = createJsonlParser((l) => lines.push(l));
	parser.write(input);
	parser.end();
	return lines;
}
