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
			message: "图床上传失败或返回链接无效，请稍后重试。",
		});
	});

	it("限制上游返回体大小", async () => {
		const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response("a".repeat(65 * 1024)));
		await expect(uploadImageToImageBed(file, config, fetcher)).rejects.toMatchObject({
			status: 502,
		});
	});
});
