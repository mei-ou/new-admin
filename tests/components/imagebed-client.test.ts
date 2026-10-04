import { afterEach, describe, expect, it, vi } from "vitest";
import { uploadImageBedImage } from "../../src/components/articles/imagebed-client";

const file = new File(["test"], "photo.png", { type: "image/png" });
afterEach(() => vi.unstubAllGlobals());

describe("浏览器图床上传", () => {
	it("只调用同源后端并解析图片链接", async () => {
		const fetcher = vi
			.fn()
			.mockResolvedValue(
				Response.json(
					{ image: { url: "https://pic.example.com/file/photo.png" } },
					{ status: 201 },
				),
			);
		vi.stubGlobal("fetch", fetcher);
		const controller = new AbortController();
		expect(await uploadImageBedImage(file, controller.signal)).toBe(
			"https://pic.example.com/file/photo.png",
		);
		expect(fetcher).toHaveBeenCalledWith(
			"/api/images/upload",
			expect.objectContaining({
				method: "POST",
				headers: { "X-Firefly-Admin": "1" },
				signal: controller.signal,
			}),
		);
		const options = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
		if (!(options?.body instanceof FormData)) throw new Error("未发送上传表单。");
		expect(options.body.get("file")).toBeInstanceOf(File);
	});

	it("明确展示缺失图床配置错误", async () => {
		vi.stubGlobal(
			"fetch",
			vi
				.fn()
				.mockResolvedValue(
					Response.json({ error: { message: "图床上传尚未正确配置。" } }, { status: 503 }),
				),
		);
		await expect(uploadImageBedImage(file)).rejects.toThrow("图床上传尚未正确配置。");
	});

	it("拒绝危险返回链接", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(Response.json({ image: { url: "javascript:alert(1)" } })),
		);
		await expect(uploadImageBedImage(file)).rejects.toThrow();
	});

	it("文件校验失败时不发请求", async () => {
		const fetcher = vi.fn();
		vi.stubGlobal("fetch", fetcher);
		await expect(
			uploadImageBedImage(new File(["svg"], "image.svg", { type: "image/svg+xml" })),
		).rejects.toThrow();
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("处理非 JSON 响应", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn().mockResolvedValue(new Response("gateway failure", { status: 502 })),
		);
		await expect(uploadImageBedImage(file)).rejects.toThrow("图床上传响应无效");
	});
});
