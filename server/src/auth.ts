import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";

export function tokenMatches(expected: string, provided: string | undefined | null): boolean {
	if (!provided) return false;
	const a = Buffer.from(expected);
	const b = Buffer.from(provided);
	if (a.length !== b.length) return false;
	return timingSafeEqual(a, b);
}

/** Extract a bearer token from header, cookie, or query (?token=). */
export function extractToken(req: FastifyRequest): string | undefined {
	const header = req.headers.authorization;
	if (header && header.startsWith("Bearer ")) return header.slice(7).trim();
	const cookie = req.cookies?.pi_web_token;
	if (cookie) return cookie;
	const q = (req.query as Record<string, string | undefined>)?.token;
	return q;
}

export interface AuthPluginOptions {
	token: string;
	/** Paths exempt from auth (prefix match). */
	exempt?: string[];
}

const DEFAULT_EXEMPT = ["/api/health"];

export function registerAuth(app: FastifyInstance, opts: AuthPluginOptions): void {
	const exempt = opts.exempt ?? DEFAULT_EXEMPT;

	app.addHook("onRequest", async (req, reply) => {
		const url = req.url.split("?")[0] ?? req.url;
		if (exempt.some((p) => url === p || url.startsWith(p + "/"))) return;
		if (url.startsWith("/api/") || url.startsWith("/ws")) {
			if (tokenMatches(opts.token, extractToken(req))) return;
			reply.code(401).send({ error: "unauthorized", message: "Missing or invalid token" });
			return reply;
		}
	});
}

declare module "fastify" {
	interface FastifyRequest {
		cookies?: Record<string, string>;
	}
}
