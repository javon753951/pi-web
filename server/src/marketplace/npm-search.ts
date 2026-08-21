const REGISTRY_SEARCH = "https://registry.npmjs.org/-/v1/search";
const REGISTRY_PACKAGE = "https://registry.npmjs.org";

// Node's global fetch (undici) does not honor HTTP_PROXY/HTTPS_PROXY by
// default. Wire it up once so marketplace search works behind a local proxy
// (e.g. Clash). EnvHttpProxyAgent honors NO_PROXY for localhost bypasses.
try {
	const undici = process.getBuiltinModule("undici") as any;
	undici.setGlobalDispatcher(new undici.EnvHttpProxyAgent());
} catch {
	/* no proxy support needed */
}

export interface SearchHit {
	name: string;
	version: string;
	description: string;
	author?: string;
	keywords?: string[];
	piField?: Record<string, unknown>;
	hasPiField: boolean;
}

const cache = new Map<string, { at: number; hits: SearchHit[] }>();
const CACHE_TTL_MS = 5 * 60_000;

/**
 * Search npm for pi extensions.
 *
 * The registry search API does not expose the package.json `pi` field, so we
 * fetch the top-N package docs in parallel and keep only those with a `pi`
 * field (the official extension marker). Results are cached for 5 minutes.
 */
export async function searchNpm(query: string, size = 12, timeoutMs = 8000): Promise<SearchHit[]> {
	const key = `${query}|${size}`;
	const cached = cache.get(key);
	if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.hits;

	const searchUrl = `${REGISTRY_SEARCH}?text=${encodeURIComponent(query)}&size=${size}`;
	const searchRes = await fetchWithTimeout(searchUrl, timeoutMs);
	if (!searchRes.ok) throw new Error(`npm search failed: ${searchRes.status}`);

	const body = (await searchRes.json()) as { objects?: Array<{ package: { name: string } }> };
	const names = (body.objects ?? []).map((o) => o.package.name).slice(0, size);

	const hits: SearchHit[] = [];
	await Promise.all(
		names.map(async (name) => {
			try {
				const res = await fetchWithTimeout(`${REGISTRY_PACKAGE}/${encodeURIComponent(name)}`, timeoutMs);
				if (!res.ok) return;
				const doc = (await res.json()) as any;
				const latest = doc["dist-tags"]?.latest;
				const meta = doc.versions?.[latest] ?? {};
				const piField = meta.pi;
				if (!piField) return; // not a pi extension
				hits.push({
					name,
					version: latest,
					description: meta.description ?? doc.description ?? "",
					author: typeof meta.author === "string" ? meta.author : meta.author?.name,
					keywords: meta.keywords,
					piField,
					hasPiField: true,
				});
			} catch {
				/* drop unreachable packages */
			}
		}),
	);

	hits.sort((a, b) => a.name.localeCompare(b.name));
	cache.set(key, { at: Date.now(), hits });
	return hits;
}

async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
	const ctrl = new AbortController();
	const timer = setTimeout(() => ctrl.abort(), timeoutMs);
	try {
		return await fetch(url, { signal: ctrl.signal });
	} finally {
		clearTimeout(timer);
	}
}
