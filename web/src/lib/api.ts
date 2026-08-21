declare global {
	interface Window {
		__PI_WEB_TOKEN__?: string;
	}
}

export function getToken(): string {
	const injected = window.__PI_WEB_TOKEN__;
	if (injected && injected !== "__PI_WEB_TOKEN__") return injected;
	return localStorage.getItem("pi_web_token") ?? "";
}

export function setLocalToken(t: string): void {
	localStorage.setItem("pi_web_token", t);
}

export class ApiError extends Error {
	constructor(
		public status: number,
		message: string,
	) {
		super(message);
	}
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
	const headers: Record<string, string> = {
		...(init.headers as Record<string, string>),
	};
	const token = getToken();
	if (token) headers.Authorization = `Bearer ${token}`;
	const res = await fetch(path, { ...init, headers });
	if (!res.ok) {
		let msg = `HTTP ${res.status}`;
		try {
			const body = await res.json();
			if (body?.error) msg = body.error;
		} catch {
			/* ignore */
		}
		throw new ApiError(res.status, msg);
	}
	return (await res.json()) as T;
}

export const api = {
	get<T>(path: string): Promise<T> {
		return request<T>(path);
	},
	post<T = any>(path: string, body?: unknown): Promise<T> {
		return request<T>(path, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	},
	put<T = any>(path: string, body?: unknown): Promise<T> {
		return request<T>(path, {
			method: "PUT",
			headers: { "Content-Type": "application/json" },
			body: body === undefined ? undefined : JSON.stringify(body),
		});
	},
	del<T = any>(path: string): Promise<T> {
		return request<T>(path, { method: "DELETE" });
	},
	/** NDJSON 流式请求（安装日志）。返回逐行解析的可取消 reader。 */
	stream(path: string, body: unknown): { lines: AsyncIterable<Record<string, unknown>>; abort: () => void } {
		const ctrl = new AbortController();
		const token = getToken();
		const headers: Record<string, string> = { "Content-Type": "application/json" };
		if (token) headers.Authorization = `Bearer ${token}`;
		const resPromise = fetch(path, { method: "POST", headers, body: JSON.stringify(body), signal: ctrl.signal });

		async function* gen(): AsyncIterable<Record<string, unknown>> {
			const res = await resPromise;
			if (!res.ok || !res.body) {
				throw new ApiError(res.status, `HTTP ${res.status}`);
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buf = "";
			try {
				while (true) {
					const { done, value } = await reader.read();
					if (done) break;
					buf += decoder.decode(value, { stream: true });
					let idx: number;
					while ((idx = buf.indexOf("\n")) !== -1) {
						const line = buf.slice(0, idx).trim();
						buf = buf.slice(idx + 1);
						if (line) yield JSON.parse(line);
					}
				}
			} finally {
				reader.releaseLock();
			}
		}

		return { lines: gen(), abort: () => ctrl.abort() };
	},
};

/** 文件下载（带 token）。 */
export function downloadUrl(path: string): string {
	const url = new URL(path, window.location.origin);
	const token = getToken();
	if (token) url.searchParams.set("token", token);
	return url.toString();
}

export interface UploadResult {
	path: string;
	extracted?: string[];
}

/**
 * 上传单个文件到会话工作区（原始字节流，zip 自动解包）。
 * 用 XHR 拿上传进度；Promise 在完成时 resolve 落盘路径。
 */
export function uploadFile(sessionId: string, file: File, dir = ""): Promise<UploadResult> {
	return new Promise((resolve, reject) => {
		const xhr = new XMLHttpRequest();
		const params = new URLSearchParams({ name: file.name, unzip: "1" });
		if (dir) params.set("dir", dir);
		xhr.open("PUT", `/api/sessions/${sessionId}/files?${params.toString()}`);
		xhr.setRequestHeader("Content-Type", "application/octet-stream");
		const token = getToken();
		if (token) xhr.setRequestHeader("Authorization", `Bearer ${token}`);
		xhr.onload = () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				try {
					resolve(JSON.parse(xhr.responseText) as UploadResult);
				} catch {
					resolve({ path: file.name });
				}
			} else {
				let msg = `HTTP ${xhr.status}`;
				try {
					const body = JSON.parse(xhr.responseText);
					if (body?.error) msg = body.error;
				} catch {
					/* ignore */
				}
				reject(new ApiError(xhr.status, msg));
			}
		};
		xhr.onerror = () => reject(new ApiError(0, "网络错误，上传失败"));
		xhr.send(file);
	});
}
