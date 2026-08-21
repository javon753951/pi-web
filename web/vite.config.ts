import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 开发模式 token 注入：vite dev server 在本机读取网关生成的
 * data/.token（或 PI_WEB_TOKEN 环境变量），把 index.html 里的
 * __PI_WEB_TOKEN__ 占位符替换为真实 token。
 * 生产模式由网关在服务 dist/index.html 时做同样的替换。
 */
function injectToken(): Plugin {
	return {
		name: "pi-web-inject-token",
		// 只在 dev server 注入；build 产物保留占位符，由网关运行时替换，
		// 避免构建产物绑定构建机的 token（docker/多环境部署会鉴权错位）。
		apply: "serve",
		transformIndexHtml(html) {
			let token = process.env.PI_WEB_TOKEN ?? "";
			if (!token) {
				// token 实际落盘在仓库根 data/.token(网关 cwd 决定);兼容 server/data/.token 布局
				const p =
					[resolve(__dirname, "../data/.token"), resolve(__dirname, "../server/data/.token")].find((x) =>
						existsSync(x),
					) ?? resolve(__dirname, "../data/.token");
				try {
					if (existsSync(p)) token = readFileSync(p, "utf8").trim();
				} catch {
					token = "";
				}
			}
			if (!token) return html;
			return html.replace('"__PI_WEB_TOKEN__"', JSON.stringify(token));
		},
	};
}

export default defineConfig({
	plugins: [react(), tailwindcss(), injectToken()],
	server: {
		port: 5188,
		// 局域网扫码访问需要 dev server 监听所有网卡（二维码指向 5188）。
		host: "0.0.0.0",
		proxy: {
			"/api": {
				target: "http://127.0.0.1:8787",
				changeOrigin: false,
			},
			"/ws": {
				target: "ws://127.0.0.1:8787",
				ws: true,
			},
		},
	},
	build: {
		outDir: "dist",
		sourcemap: false,
		chunkSizeWarningLimit: 1200,
	},
});
