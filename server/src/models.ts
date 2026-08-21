import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AppConfig } from "./config.js";

export interface ModelInfo {
	id: string;
	name: string;
	provider: string;
	api: string;
	baseUrl?: string;
	reasoning?: boolean;
	contextWindow?: number;
	maxTokens?: number;
}

export interface ProviderAuth {
	provider: string;
	configured: boolean;
	type?: string;
	keyPreview?: string;
}

export interface ModelsData {
	models: ModelInfo[];
	providers: ProviderAuth[];
	defaultModel?: string;
}

function readJsonSafe<T>(path: string): T | null {
	try {
		if (!existsSync(path)) return null;
		return JSON.parse(readFileSync(path, "utf8")) as T;
	} catch {
		return null;
	}
}

function maskKey(key: string): string {
	if (key.length <= 8) return "•".repeat(key.length);
	return `${key.slice(0, 4)}…${key.slice(-4)}`;
}

/**
 * Read models from models-store.json and auth status from auth.json
 * (same files pi itself uses under ~/.pi/agent).
 */
export function getModels(config: AppConfig): ModelsData {
	const modelsStore = readJsonSafe<Record<string, { models?: any[] }>>(
		join(config.agentDir, "models-store.json"),
	);
	const auth = readJsonSafe<Record<string, { type?: string; key?: string }>>(
		join(config.agentDir, "auth.json"),
	);

	const models: ModelInfo[] = [];
	const providers = new Map<string, ProviderAuth>();

	if (modelsStore) {
		for (const [provider, data] of Object.entries(modelsStore)) {
			if (!Array.isArray(data?.models)) continue;
			for (const m of data.models) {
				if (!m?.id) continue;
				models.push({
					id: m.id,
					name: m.name ?? m.id,
					provider: m.provider ?? provider,
					api: m.api,
					baseUrl: m.baseUrl,
					reasoning: !!m.reasoning,
					contextWindow: m.contextWindow,
					maxTokens: m.maxTokens,
				});
			}
			providers.set(provider, {
				provider,
				configured: !!auth?.[provider]?.key,
				type: auth?.[provider]?.type,
				keyPreview: auth?.[provider]?.key ? maskKey(auth[provider]!.key!) : undefined,
			});
		}
	}

	// Providers present in auth.json but missing from the store.
	if (auth) {
		for (const [provider, data] of Object.entries(auth)) {
			if (!providers.has(provider)) {
				providers.set(provider, {
					provider,
					configured: !!data?.key,
					type: data?.type,
					keyPreview: data?.key ? maskKey(data.key) : undefined,
				});
			}
		}
	}

	models.sort((a, b) => a.provider.localeCompare(b.provider) || a.name.localeCompare(b.name));

	// Default model = first configured provider's first model, else first model.
	const firstConfigured = [...providers.values()].find((p) => p.configured)?.provider;
	const defaultModel =
		models.find((m) => m.provider === firstConfigured)?.id ?? models[0]?.id;

	return {
		models,
		providers: [...providers.values()].sort((a, b) => a.provider.localeCompare(b.provider)),
		defaultModel,
	};
}

/** Write (merge) an API key into ~/.pi/agent/auth.json. */
export function setAuthKey(config: AppConfig, provider: string, apiKey: string): ProviderAuth {
	const path = join(config.agentDir, "auth.json");
	const auth = readJsonSafe<Record<string, any>>(path) ?? {};
	auth[provider] = { ...(auth[provider] ?? {}), type: "api_key", key: apiKey };
	writeFileSync(path, JSON.stringify(auth, null, 2) + "\n", "utf8");
	return { provider, configured: true, type: "api_key", keyPreview: maskKey(apiKey) };
}
