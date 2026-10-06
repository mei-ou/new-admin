import { describe, expect, it, vi } from "vitest";
import {
	loadImageBedConfig,
	parseImageBedOrigin,
	uploadImageToImageBed,
} from "../../src/providers/images/imagebed-provider";

const config = { origin: "https://pic.example.com", token: "test-only-token", folder: "blog" };
const file = new File(["test"], "photo.png", { type: "image/png" });

describe("图床 Provider", () => {
	it("配置保留服务端来源和目录", () => {
		expect(
			loadImageBedConfig({
				IMAGEBED_BASE_URL: "https://pic.example.com/",
				IMAGEBED_API_TOKEN: config.token,
			}),
		).toEqual(config);
	});

	it.each([
		undefined,
		"",
		"http://pic.example.com",
		"https://user:pass@pic.example.com",
		"https://127.0.0.1",
		"https://localhost",
		"https://pic.example.com/upload",
		"https://pic.example.com/?token=secret",
		"https://pic.example.com/#hash",
	])("拒绝危险或非纯来源地址 %s", (input) => {
		expect(() => parseImageBedOrigin(input)).toThrow(expect.objectContaining({ status: 503 }));
	});

	it.each(["../blog", "/blog", "blog/../posts", "blog?auth=secret"])(
		"拒绝非法上传目录 %s",
		(folder) => {
			expect(() =>
				loadImageBedConfig({
					IMAGEBED_BASE_URL: config.origin,
					IMAGEBED_API_TOKEN: config.token,
					IMAGEBED_UPLOAD_FOLDER: folder,
				}),
			).toThrow();
		},
	);

	it.each(["/file/image.png", "https://pic.example.com/file/image.png"])(
		"统一解析官方响应链接 %s",
		async (src) => {
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ src }]));
			expect(await uploadImageToImageBed(file, config, fetcher)).toBe(
				"https://pic.example.com/file/image.png",
			);
		},
	);

	it.each([
		"javascript:alert(1)",
		"//evil.example/image.png",
		"https://evil.example/image.png",
		"https://user:pass@pic.example.com/file/image.png",
		"/file/image.png?token=secret",
		'/file/a"b.png',
		"image.png",
	])("拒绝不可信返回链接 %s", async (src) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ src }]));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			status: 502,
		});
	});

	it.each([[], [{ src: "/file/a.png" }, { src: "/file/b.png" }], { error: "secret" }, { src: 42 }])(
		"拒绝异常响应 %j",
		async (payload) => {
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(payload));
			await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
				status: 502,
			});
		},
	);

	it("上游错误内容和 Token 不返回客户端", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(new Response("test-only-token upstream secret", { status: 401 }));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			message: "图床上传接口返回 HTTP 401。请检查图床 API Token 是否有效并具有上传权限。",
		});
	});

	it.each([403, 413, 429, 500, 502])("安全显示上游 HTTP %s，不透传正文", async (status) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(config.token, { status }));
		const failure = await uploadImageToImageBed(file, config, fetcher).catch((error) => error);
		expect(failure).toMatchObject({
			status: 502,
			code: "UPSTREAM_ERROR",
			message: expect.stringContaining(`HTTP ${status}`),
		});
		expect(failure.message).not.toContain(config.token);
	});

	it.each(["TimeoutError", "AbortError"])("识别超时 %s", async (name) => {
		const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new DOMException(config.token, name));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			message: expect.stringContaining("超过 30 秒"),
		});
	});

	it("网络异常不透传凭据", async () => {
		const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error(config.token));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			message:
				"后台无法完成图床请求，可能是网络、TLS 或重定向被拒绝；请检查图床入口和前置访问验证。",
		});
	});

	it.each([301, 302, 303, 307, 308])(
		"拒绝跟随 HTTP %s 重定向，不泄露目标或 Token",
		async (status) => {
			const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
				new Response(config.token, {
					status,
					headers: { Location: `https://other.example/${config.token}` },
				}),
			);
			const failure = await uploadImageToImageBed(file, config, fetcher).catch((error) => error);
			expect(failure).toMatchObject({ status: 502, message: expect.stringContaining("重定向") });
			expect(failure.message).not.toContain(config.token);
			expect(failure.message).not.toContain("other.example");
			expect(fetcher).toHaveBeenCalledTimes(1);
			expect(fetcher.mock.calls[0]?.[1]?.redirect).toBe("manual");
		},
	);

	it.each([
		[new Error(config.token), "响应读取失败"],
		[new DOMException(config.token, "TimeoutError"), "超过 30 秒"],
	])("读取响应时保留安全故障分类 %#", async (error, message) => {
		const stream = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.error(error);
			},
		});
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(stream));
		const failure = await uploadImageToImageBed(file, config, fetcher).catch((error) => error);
		expect(failure).toMatchObject({ status: 502, message: expect.stringContaining(message) });
		expect(failure.message).not.toContain(config.token);
	});

	it.each([
		[new Response("<html>secret</html>"), "不是有效 JSON"],
		[Response.json({ error: "secret" }), "缺少单张图片的 src"],
		[Response.json([{ src: "https://other.example/file/a.png" }]), "未通过安全校验"],
		[new Response("a".repeat(65 * 1024)), "超过 64 KiB"],
	])("区分响应阶段错误 %#", async (response, message) => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			status: 502,
			message: expect.stringContaining(message),
		});
	});

	it("WebDAV 使用服务端渠道和 Bearer 鉴权", async () => {
		const fetcher = vi
			.fn<typeof fetch>()
			.mockResolvedValue(Response.json([{ src: "/file/blog/a.png" }]));
		await uploadImageToImageBed(file, { ...config, channel: "webdav" }, fetcher);
		const call = fetcher.mock.calls[0];
		if (!call) throw new Error("未执行上传");
		const [endpoint, options] = call;
		expect(new URL(String(endpoint)).searchParams.get("uploadChannel")).toBe("webdav");
		expect(options?.headers).toEqual({ Authorization: `Bearer ${config.token}` });
	});

	it("限制上游返回体大小", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("a".repeat(65 * 1024)));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			status: 502,
		});
	});
});
