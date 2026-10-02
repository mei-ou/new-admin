import { describe, expect, it } from "vitest";
import { loadGitHubConfig } from "../../src/core/config/github-config";

const validEnv = {
	SITE_ID: "firefly",
	GITHUB_OWNER: "firefly-owner",
	GITHUB_REPO: "firefly-blog",
	GITHUB_BRANCH: "master",
	GITHUB_CONTENT_ROOT: "src/content/posts",
	GITHUB_TOKEN: "test-token",
};

describe("GitHub 运行配置", () => {
	it("按 SITE_ID 从站点配置派生路径策略，而不是硬编码 Page Bundle", () => {
		const config = loadGitHubConfig({ ...validEnv, UNUSED: "ignored" });

		expect(config.owner).toBe("firefly-owner");
		expect(config.repo).toBe("firefly-blog");
		expect(config.branch).toBe("master");
		expect(config.token).toBe("test-token");
		expect(config.contentRoot).toBe("src/content/posts");

		// 路径策略来自 `SITE_ID` → 站点配置 → 内容类型，不再是写死的 index.md / pageBundle。
		expect(config.usePageBundle).toBe(true);
		expect(config.entryFilename).toBe("index.md");
		expect(config.typeDirectory).toBe("");
		expect(config.extension).toBe(".md");
		expect(config.filenamePolicy).toBe("ascii-slug");
		expect(config.allowCategoryPath).toBe(false);
		expect(config.typeId).toBe("posts");
	});

	it("codec 与站点配置同源，能校验 Firefly 的 Front-matter", () => {
		const { frontmatterCodec } = loadGitHubConfig(validEnv);

		expect(
			frontmatterCodec.schema.safeParse({ title: "标题", published: new Date() }).success,
		).toBe(true);
		expect(frontmatterCodec.schema.safeParse({ title: "缺日期" }).success).toBe(false);
		// 已知字段集合必须覆盖 Firefly 的完整字段清单，否则源码模式会把它们误判为未知字段。
		expect(frontmatterCodec.knownKeys.has("passwordHint")).toBe(true);
		expect(frontmatterCodec.knownKeys.has("prevTitle")).toBe(false);
	});

	it("SITE_ID 缺失、为空或指向未登记站点时失败关闭", () => {
		for (const siteId of [undefined, "", "tsh520", " firefly"]) {
			expect(() => loadGitHubConfig({ ...validEnv, SITE_ID: siteId })).toThrow(
				expect.objectContaining({ status: 503, code: "CONFIGURATION_ERROR" }),
			);
		}
	});

	it("缺少 Token 时失败关闭", () => {
		expect(() => loadGitHubConfig({ ...validEnv, GITHUB_TOKEN: undefined })).toThrow(
			expect.objectContaining({ status: 503, code: "CONFIGURATION_ERROR" }),
		);
	});

	it("拒绝危险仓库标识和分支", () => {
		for (const patch of [
			{ GITHUB_OWNER: "../owner" },
			{ GITHUB_REPO: "repo/name" },
			{ GITHUB_BRANCH: "feature//post" },
			{ GITHUB_BRANCH: "refs/heads/../secret" },
			{ GITHUB_BRANCH: "branch.lock" },
		]) {
			expect(() => loadGitHubConfig({ ...validEnv, ...patch })).toThrow(
				expect.objectContaining({ status: 503, code: "CONFIGURATION_ERROR" }),
			);
		}
	});

	it("拒绝越界的内容根目录", () => {
		for (const contentRoot of [
			"/src/content/posts",
			"src/content/../secret",
			"src\\content\\posts",
			"src/content/%2e%2e/secret",
		]) {
			expect(() => loadGitHubConfig({ ...validEnv, GITHUB_CONTENT_ROOT: contentRoot })).toThrow(
				expect.objectContaining({ status: 503, code: "CONFIGURATION_ERROR" }),
			);
		}
	});

	it("配置错误不泄露 Token 或具体字段", () => {
		let thrown: unknown;
		try {
			loadGitHubConfig({ ...validEnv, GITHUB_OWNER: "invalid/owner" });
		} catch (error) {
			thrown = error;
		}

		expect((thrown as Error).message).not.toContain("test-token");
		expect((thrown as Error).message).not.toContain("GITHUB_OWNER");
	});
});
