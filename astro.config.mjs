import cloudflare from "@astrojs/cloudflare";
import svelte from "@astrojs/svelte";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "astro/config";

export default defineConfig({
	output: "server",
	devToolbar: { enabled: false },
	// 身份状态由 Cloudflare Access 提供；P0 不使用 Astro Session，避免自动创建无用的 KV Binding。
	session: false,
	adapter: cloudflare({
		configPath: process.env.ADMIN_WRANGLER_CONFIG ?? "wrangler.jsonc",
		imageService: "compile",
	}),
	integrations: [svelte()],
	vite: {
		// 使用项目版本化缓存，锁文件升级时无需批量删除旧缓存目录。
		cacheDir: "node_modules/.vite-firefly-v3",
		plugins: [
			{
				name: "single-svelte-server-runtime",
				enforce: "pre",
				configEnvironment(name) {
					if (name === "client") return;
					return { optimizeDeps: { exclude: ["svelte", "@astrojs/svelte/server.js"] } };
				},
			},
			tailwindcss(),
		],
	},
});
