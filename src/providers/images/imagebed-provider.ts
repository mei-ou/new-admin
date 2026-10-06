import { readBoundedBody } from "../../core/http/bounded-body";
import { ApiError } from "../../core/http/errors";
import type { RuntimeEnv } from "../../types/env";

export interface ImageBedConfig {
	origin: string;
	token: string;
	folder: string;
	channel?: string;
}

export function parseImageBedOrigin(input: unknown): string {
	try {
		if (typeof input !== "string" || input !== input.trim()) throw new Error();
		const url = new URL(input);
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.port ||
			url.pathname !== "/" ||
			url.search ||
			url.hash ||
			!/^([a-z0-9-]+\.)+[a-z]{2,}$/i.test(url.hostname) ||
			url.hostname.endsWith(".localhost") ||
			url.hostname.endsWith(".local")
		)
			throw new Error();
		return url.origin;
	} catch {
		throw new ApiError(503, "CONFIGURATION_ERROR", "图床地址尚未正确配置。");
	}
}

export function loadImageBedConfig(env: RuntimeEnv): ImageBedConfig {
	const origin = parseImageBedOrigin(env.IMAGEBED_BASE_URL);
	const token = env.IMAGEBED_API_TOKEN;
	const folder = env.IMAGEBED_UPLOAD_FOLDER ?? "blog";
	const channel = env.IMAGEBED_UPLOAD_CHANNEL;
	if (
		typeof token !== "string" ||
		!token ||
		/\s/.test(token) ||
		token.length > 4096 ||
		!/^([A-Za-z0-9_-]+\/)*[A-Za-z0-9_-]+$/.test(folder) ||
		folder.length > 200 ||
		(channel !== undefined &&
			!["telegram", "cfr2", "s3", "discord", "huggingface", "webdav"].includes(channel))
	)
		throw new ApiError(503, "CONFIGURATION_ERROR", "图床上传尚未正确配置。");
	return { origin, token, folder, ...(channel === undefined ? {} : { channel }) };
}

export async function uploadImageToImageBed(
	file: File,
	config: ImageBedConfig,
	fetcher: typeof fetch = fetch,
): Promise<string> {
	const endpoint = new URL("/upload", config.origin);
	endpoint.searchParams.set("returnFormat", "default");
	endpoint.searchParams.set("uploadFolder", config.folder);
	if (config.channel) endpoint.searchParams.set("uploadChannel", config.channel);
	const body = new FormData();
	const extension = file.type === "image/jpeg" ? "jpg" : file.type === "image/png" ? "png" : "webp";
	body.set("file", file, `${crypto.randomUUID()}.${extension}`);
	let stage: "request" | "body" | "json" | "result" | "link" = "request";
	try {
		const response = await fetcher(endpoint, {
			method: "POST",
			headers: { Authorization: `Bearer ${config.token}` },
			body,
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			await response.body?.cancel().catch(() => undefined);
			const reason =
				response.status === 401
					? "请检查图床 API Token 是否有效并具有上传权限。"
					: response.status === 403
						? "请求被拒绝，请检查图床访问策略、IP 封禁或前置安全规则。"
						: response.status === 413
							? "图床或存储渠道拒绝了文件大小。"
							: response.status === 429
								? "图床请求过于频繁，请稍后重试。"
								: "请检查图床上传渠道、存储和数据库配置，具体原因需查看图床日志。";
			throw new ApiError(
				502,
				"UPSTREAM_ERROR",
				`图床上传接口返回 HTTP ${response.status}。${reason}`,
			);
		}
		stage = "body";
		const bytes = await readBoundedBody(response.body, 64 * 1024);
		stage = "json";
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
		stage = "result";
		const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
		if (
			!result ||
			typeof result !== "object" ||
			!("src" in result) ||
			typeof result.src !== "string"
		)
			throw new Error();
		stage = "link";
		const src = result.src;
		if (!src || src.length > 2048 || /[\s\\<>"'`]/.test(src) || src.startsWith("//"))
			throw new Error();
		const url = new URL(src, config.origin);
		if (
			url.origin !== config.origin ||
			url.username ||
			url.password ||
			url.pathname === "/" ||
			url.search ||
			url.hash ||
			!(src.startsWith("/") || src.startsWith("https://"))
		)
			throw new Error();
		return url.href;
	} catch (error) {
		if (error instanceof ApiError && error.code === "UPSTREAM_ERROR") throw error;
		if (error instanceof Error && ["TimeoutError", "AbortError"].includes(error.name)) {
			throw new ApiError(
				502,
				"UPSTREAM_ERROR",
				"图床上传或读取响应超过 30 秒，未确认上传成功；请先检查图床是否已有图片，避免重复上传。",
			);
		}
		const messages = {
			request:
				"后台无法完成图床请求，可能是网络、TLS 或重定向被拒绝；请检查图床入口和前置访问验证。",
			body: "图床响应读取失败或超过 64 KiB，未确认上传成功；请检查图床日志。",
			json: "图床返回的内容不是有效 JSON，可能返回了登录页或安全验证页；请检查图床前置访问验证。",
			result: "图床响应缺少单张图片的 src 链接，未确认上传成功；请检查图床接口版本。",
			link: "图床返回的图片链接未通过安全校验；可能已上传，请先检查图床记录。后台只接受同域名、无查询参数的 HTTPS 或站内绝对路径链接。",
		};
		throw new ApiError(502, "UPSTREAM_ERROR", messages[stage]);
	}
}
