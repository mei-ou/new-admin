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
	try {
		const response = await fetcher(endpoint, {
			method: "POST",
			headers: { Authorization: `Bearer ${config.token}` },
			body,
			redirect: "error",
			signal: AbortSignal.timeout(30_000),
		});
		if (!response.ok) {
			await response.body?.cancel();
			throw new Error();
		}
		const bytes = await readBoundedBody(response.body, 64 * 1024);
		const payload: unknown = JSON.parse(new TextDecoder().decode(bytes));
		const result = Array.isArray(payload) && payload.length === 1 ? payload[0] : payload;
		if (
			!result ||
			typeof result !== "object" ||
			!("src" in result) ||
			typeof result.src !== "string"
		)
			throw new Error();
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
	} catch {
		throw new ApiError(502, "UPSTREAM_ERROR", "图床上传失败或返回链接无效，请稍后重试。");
	}
}
