import { describe, expect, it } from "vitest";
import { parseArticleListPayload } from "../../src/components/articles/article-list-state";
import {
	articleRoute,
	parseConfiguredArticle,
	parseConfiguredCommit,
} from "../../src/components/articles/configured-editor-state";
import { resolveAdminCapabilities } from "../../src/core/config/capabilities";
import { createConfiguredLocalPreview } from "../../src/core/configured-local-preview";
import { handleLocalPreviewApiRequest } from "../../src/core/local-preview";
import { createArticleEditorConfig } from "../../src/modules/articles/editor-config";
import { getSoleContentType, resolveSiteConfig } from "../../src/sites";

const site = resolveSiteConfig({ SITE_ID: "newfirefly" });
const config = createArticleEditorConfig(site.id, getSoleContentType(site));
const capabilities = resolveAdminCapabilities({ FEATURE_IMAGEBED_UPLOAD: "true" });
const origin = "http://127.0.0.1:4322";
function request(
	path: string,
	method = "GET",
	body?: unknown,
	key = "preview-write-key-123456789",
) {
	return new Request(`${origin}${path}`, {
		method,
		...(body === undefined
			? {}
			: {
					body: JSON.stringify(body),
					headers: {
						Origin: origin,
						"Sec-Fetch-Site": "same-origin",
						"X-Firefly-Admin": "1",
						"Content-Type": "application/json",
						"Idempotency-Key": key,
					},
				}),
	});
}
async function read(preview: ReturnType<typeof createConfiguredLocalPreview>, id: string) {
	return parseConfiguredArticle(
		await (await preview(request(articleRoute(id, "/api/articles")), capabilities)).json(),
		config,
		id,
	);
}
describe("参考版离线预览", () => {
	it("链接候选使用真实模型，支持中文目录、搜索并执行能力开关", async () => {
		const preview = createConfiguredLocalPreview(site);
		const response = await preview(request("/api/articles/link-targets?query=本地"), capabilities);
		expect(response.status).toBe(200);
		const payload = (await response.json()) as {
			targets: { items: { storageSlug: string; href: string }[] };
		};
		expect(payload.targets.items.some((item) => item.storageSlug === "博客指南/本地预览文章")).toBe(
			true,
		);
		expect(payload.targets.items[0]?.href).toContain("/posts/");
		await expect(
			preview(request("/api/articles/link-targets"), { ...capabilities, articleLinks: false }),
		).rejects.toMatchObject({ code: "NOT_FOUND" });
		await expect(
			preview(request("/api/articles/link-targets?extra=x"), capabilities),
		).rejects.toMatchObject({ code: "INVALID_REQUEST" });
	});
	it("列表和中文分类详情使用真实模型，只提供内存文章", async () => {
		const preview = createConfiguredLocalPreview(site);
		const payload = parseArticleListPayload(
			await (await preview(request("/api/articles"), capabilities)).json(),
			"unicode",
			true,
		);
		expect(payload.items).toHaveLength(2);
		expect(payload.items[0]?.category).toBe("博客指南");
		const detail = await read(preview, "博客指南/本地预览文章");
		expect(detail.pathAlias).toBe("博客指南/本地预览文章.md");
		expect(detail.resources).toBeUndefined();
	});
	it("新建、相同幂等键回放、更新重开、删除只影响目标", async () => {
		const preview = createConfiguredLocalPreview(site);
		const original = await read(preview, "博客指南/本地预览文章");
		const id = "测试分类/网页验收文章";
		const available = await preview(
			request(articleRoute(id, "/api/articles"), "HEAD"),
			capabilities,
		);
		expect(available.status).toBe(404);
		expect(available.headers.get("X-Repository-Head-Sha")).toBe(original.headSha);
		const body = {
			storageSlug: id,
			expectedHeadSha: original.headSha,
			article: {
				format: "md",
				frontmatter: { ...original.frontmatter, title: "网页验收", draft: true },
				markdown: "# 新文章",
			},
			action: "draft",
		};
		const created = await (
			await preview(request("/api/articles", "POST", body), capabilities)
		).json();
		expect(
			await (await preview(request("/api/articles", "POST", body), capabilities)).json(),
		).toEqual(created);
		const loaded = await read(preview, id);
		expect(loaded.markdown).toBe("# 新文章");
		await preview(
			request(
				articleRoute(id, "/api/articles"),
				"PUT",
				{
					expectedHeadSha: loaded.headSha,
					expectedSha: loaded.sha,
					article: {
						format: "md",
						frontmatter: { ...loaded.frontmatter, draft: false },
						markdown: "# 已发布",
					},
					action: "publish",
				},
				"preview-update-key-123456",
			),
			capabilities,
		);
		const updated = await read(preview, id);
		expect(updated.markdown).toBe("# 已发布");
		expect(updated.frontmatter.draft).toBe(false);
		const deleted = await (
			await preview(
				request(
					articleRoute(id, "/api/articles"),
					"DELETE",
					{ expectedHeadSha: updated.headSha, expectedSha: updated.sha },
					"preview-delete-key-123456",
				),
				capabilities,
			)
		).json();
		expect(parseConfiguredCommit(deleted, config, id, true).deletedFiles).toEqual([`${id}.md`]);
		expect((await read(preview, "博客指南/邻接文章")).frontmatter.title).toBe("邻接文章");
		await expect(read(preview, id)).rejects.toMatchObject({ status: 404 });
	});
	it("旧版本和跨目标复用幂等键失败关闭", async () => {
		const preview = createConfiguredLocalPreview(site);
		const id = "博客指南/本地预览文章";
		const original = await read(preview, id);
		const body = {
			expectedHeadSha: original.headSha,
			expectedSha: original.sha,
			article: {
				format: "md",
				frontmatter: { ...original.frontmatter, draft: true },
				markdown: "# 更新",
			},
			action: "draft",
		};
		await preview(request(articleRoute(id, "/api/articles"), "PUT", body), capabilities);
		await expect(
			preview(
				request(articleRoute(id, "/api/articles"), "PUT", body, "preview-other-key-123456"),
				capabilities,
			),
		).rejects.toMatchObject({ status: 409, code: "CONFLICT" });
		await expect(
			preview(
				request(articleRoute("博客指南/邻接文章", "/api/articles"), "PUT", body),
				capabilities,
			),
		).rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT" });
	});
	it("生产、外网和转发请求不能开启参考版预览", async () => {
		const env = { SITE_ID: "newfirefly", APP_ENV: "development", LOCAL_PREVIEW: "true" };
		expect(
			await handleLocalPreviewApiRequest(request("/api/articles"), capabilities, {
				...env,
				APP_ENV: "production",
			}),
		).toBeNull();
		expect(
			await handleLocalPreviewApiRequest(
				new Request("https://example.com/api/articles"),
				capabilities,
				env,
			),
		).toBeNull();
		expect(
			await handleLocalPreviewApiRequest(
				new Request(`${origin}/api/articles`, { headers: { "X-Forwarded-For": "1.1.1.1" } }),
				capabilities,
				env,
			),
		).toBeNull();
	});
	it("本地预览拒绝真实图床上传", async () => {
		const result = await handleLocalPreviewApiRequest(
			request("/api/images/upload", "POST", {}),
			capabilities,
			{ SITE_ID: "newfirefly", APP_ENV: "development", LOCAL_PREVIEW: "true" },
		);
		expect(result?.status).toBe(503);
		expect(await result?.text()).toContain("不会上传真实图床");
	});
});
