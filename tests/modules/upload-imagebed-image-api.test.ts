import { describe, expect, it, vi } from "vitest";
import { handleUploadImageBedImage } from "../../src/modules/media/api/upload-imagebed-image";
import { IMAGEBED_IMAGE_MAX_BYTES } from "../../src/modules/media/imagebed-config";
import type { RuntimeEnv } from "../../src/types/env";

const pngBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const principal = { sub: "subject-imagebed" };

function createFile(): File {
	return new File([pngBytes], "photo.png", { type: "image/png" });
}

function createRequest(file = createFile(), extra = false): Request {
	const body = new FormData();
	body.set("file", file);
	if (extra) body.set("uploadEndpoint", "https://evil.example/upload");
	return new Request("https://admin.example/api/images/upload", { method: "POST", body });
}

function createEnv(
	overrides: { [Key in keyof RuntimeEnv]?: RuntimeEnv[Key] | undefined } = {},
): RuntimeEnv {
	const env: RuntimeEnv = {
		FEATURE_IMAGEBED_UPLOAD: "true",
		IMAGEBED_BASE_URL: "https://pic.example.com",
		IMAGEBED_API_TOKEN: "test-only-token",
		RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: true }) },
	};
	for (const [key, value] of Object.entries(overrides)) {
		if (value === undefined) Reflect.deleteProperty(env, key);
		else Reflect.set(env, key, value);
	}
	return env;
}

function createFetcher() {
	return vi
		.fn<typeof fetch>()
		.mockImplementation(async () => Response.json([{ src: "/file/photo.png" }]));
}

describe("图床上传 API", () => {
	it("上传校验后的文件并只返回公网链接，不依赖 R2 或 GitHub", async () => {
		const fetcher = createFetcher();
		const auditWriter = vi.fn();
		const env = createEnv();
		const response = await handleUploadImageBedImage(
			{ request: createRequest(), requestId: "req-img", principal, env },
			{ fetch: fetcher, auditWriter },
		);
		expect(response.status).toBe(201);
		expect(response.headers.get("Cache-Control")).toBe("no-store");
		expect(await response.json()).toEqual({
			image: { url: "https://pic.example.com/file/photo.png" },
		});
		expect(env.RATE_LIMITER?.limit).toHaveBeenCalledWith({ key: "subject-imagebed:image-upload" });
		expect(JSON.stringify(auditWriter.mock.calls)).not.toContain("test-only-token");
		const call = fetcher.mock.calls[0];
		if (!call) throw new Error("未执行图床上传。");
		const [endpoint, options] = call;
		expect(String(endpoint)).toBe(
			"https://pic.example.com/upload?returnFormat=default&uploadFolder=blog",
		);
		expect(options?.headers).toEqual({ Authorization: "Bearer test-only-token" });
		expect(options?.redirect).toBe("error");
		if (!(options?.body instanceof FormData)) throw new Error("未发送上传表单。");
		const upload = options.body.get("file") as File;
		expect(upload.name).toMatch(/^[a-f0-9-]+\.png$/);
		expect(new Uint8Array(await upload.arrayBuffer())).toEqual(pngBytes);
	});

	it("匿名上传在读取配置和访问上游之前失败", async () => {
		const fetcher = createFetcher();
		await expect(
			handleUploadImageBedImage(
				{ request: createRequest(), requestId: "req", principal: undefined, env: {} },
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status: 401 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each([
		[{ FEATURE_IMAGEBED_UPLOAD: "false" }, 404],
		[{ IMAGEBED_API_TOKEN: undefined }, 503],
		[{ RATE_LIMITER: undefined }, 503],
	])("配置或保护不完整时失败关闭 %j", async (overrides, status) => {
		const fetcher = createFetcher();
		await expect(
			handleUploadImageBedImage(
				{ request: createRequest(), requestId: "req", principal, env: createEnv(overrides) },
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("限流时不上传", async () => {
		const fetcher = createFetcher();
		await expect(
			handleUploadImageBedImage(
				{
					request: createRequest(),
					requestId: "req",
					principal,
					env: createEnv({
						RATE_LIMITER: { limit: vi.fn().mockResolvedValue({ success: false }) },
					}),
				},
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status: 429 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it.each([
		new File(["fake"], "fake.png", { type: "image/png" }),
		new File([pngBytes], "fake.jpg", { type: "image/png" }),
		new File(["<svg/>"], "image.svg", { type: "image/svg+xml" }),
		new File(["%PDF-"], "file.pdf", { type: "application/pdf" }),
	])("拒绝格式伪装和非图片 $name", async (file) => {
		const fetcher = createFetcher();
		await expect(
			handleUploadImageBedImage(
				{ request: createRequest(file), requestId: "req", principal, env: createEnv() },
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status: 415 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("拒绝客户端额外指定上传端点", async () => {
		const fetcher = createFetcher();
		await expect(
			handleUploadImageBedImage(
				{
					request: createRequest(createFile(), true),
					requestId: "req",
					principal,
					env: createEnv(),
				},
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status: 400 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("没有 Content-Length 时也限制实际请求体", async () => {
		const fetcher = createFetcher();
		const oversized = new File(
			[new Uint8Array(IMAGEBED_IMAGE_MAX_BYTES + 65 * 1024)],
			"large.png",
			{ type: "image/png" },
		);
		await expect(
			handleUploadImageBedImage(
				{ request: createRequest(oversized), requestId: "req", principal, env: createEnv() },
				{ fetch: fetcher },
			),
		).rejects.toMatchObject({ status: 413 });
		expect(fetcher).not.toHaveBeenCalled();
	});

	it("支持配置渠道，不允许用户表单覆盖渠道", async () => {
		const fetcher = createFetcher();
		await handleUploadImageBedImage(
			{
				request: createRequest(),
				requestId: "req",
				principal,
				env: createEnv({ IMAGEBED_UPLOAD_CHANNEL: "cfr2", IMAGEBED_UPLOAD_FOLDER: "blog/posts" }),
			},
			{ fetch: fetcher, auditWriter: vi.fn() },
		);
		expect(new URL(String(fetcher.mock.calls[0]?.[0])).searchParams.get("uploadChannel")).toBe(
			"cfr2",
		);
	});
});
