import { describe, expect, it, vi } from "vitest";
import {
	articleRoute,
	buildConfiguredWrite,
	createEditorValues,
	groupConfiguredEditorFields,
	parseConfiguredArticle,
	parseConfiguredCommit,
	parseConfiguredPending,
	validateEditorStorageId,
} from "../../src/components/articles/configured-editor-state";
import { loadGitHubConfig } from "../../src/core/config/github-config";
import { ApiError } from "../../src/core/http/errors";
import { createFrontmatterCodec } from "../../src/modules/articles/article-schema";
import { createArticleEditorConfig } from "../../src/modules/articles/editor-config";
import {
	commitArticleDelete,
	prepareArticleDelete,
} from "../../src/modules/articles/services/delete-article";
import { readArticle } from "../../src/modules/articles/services/read-article";
import { recoverDeletedArticle } from "../../src/modules/articles/services/recover-deleted-article";
import { createArticle, updateArticle } from "../../src/modules/articles/services/write-article";
import type { GitProvider } from "../../src/providers/git/types";
import { getSoleContentType, resolveSiteConfig, toArticlePathConfig } from "../../src/sites";
import { parseEditableMarkdownDocument } from "../../src/utils/frontmatter-utils";

const site = resolveSiteConfig({ SITE_ID: "newfirefly" });
const type = getSoleContentType(site);
const codec = createFrontmatterCodec(type);
const pathConfig = toArticlePathConfig(type, site.contentRoot);
const config = createArticleEditorConfig(site.id, type);
const id = "博客指南/博客使用指南";
const path = `${site.contentRoot}/${id}.md`;
const base = "a".repeat(40);
const blob = "b".repeat(40);
const commit = "c".repeat(40);
const source =
	"---\ntitle: 博客使用指南\npublished: 2026-04-18\ndescription: 使用指南\ntags: [使用文档]\nupdated: 2026-04-21\ndescriptionSource: manual\nprev: ../上一篇\n---\n# 你好\n";
const file = { path, sha: blob, content: source, encoding: "utf-8" as const };
const checkpointCandidateCommit = vi.fn().mockResolvedValue(undefined);
function writeInput() {
	const values = createEditorValues(config, undefined, new Date("2026-04-18T00:00:00Z"));
	values.title = "新版使用指南";
	values.tags = "使用文档, 博客";
	return buildConfiguredWrite(config, id, values, "# 新正文\n", "").article;
}
function writer(deletion = false) {
	return vi.fn<GitProvider["commitFilesAtomically"]>().mockImplementation(async (request) => ({
		commitSha: commit,
		commitUrl: `https://github.com/owner/blog/commit/${commit}`,
		files: request.files.map((entry) => ({ path: entry.path, fileSha: deletion ? null : blob })),
	}));
}

describe("参考博客单文件适配", () => {
	it("表单按基本信息、紧凑开关和更多设置分组，不丢字段或修改配置顺序", () => {
		const original = config.fields.map((field) => field.key);
		const groups = groupConfiguredEditorFields(config);
		expect(groups.primary.map((field) => field.key)).toEqual([
			"title",
			"published",
			"tags",
			"description",
			"image",
		]);
		expect(groups.toggles.map((field) => field.key)).toEqual(["pinned", "comment"]);
		expect(groups.advanced.map((field) => field.key)).toContain("updated");
		const rendered = [...groups.primary, ...groups.toggles, ...groups.advanced].map(
			(field) => field.key,
		);
		expect(new Set(rendered).size).toBe(rendered.length);
		expect(rendered.sort()).toEqual(original.filter((key) => key !== "draft").sort());
		expect(config.fields.map((field) => field.key)).toEqual(original);
	});
	it("待确认请求保留同一键和原始内容，拒绝跨文章或异域恢复", () => {
		const pending = {
			url: articleRoute(id, "/api/articles"),
			method: "PUT",
			body: JSON.stringify({
				expectedHeadSha: base,
				expectedSha: blob,
				article: writeInput(),
				action: "draft",
			}),
			key: "123e4567-e89b-42d3-a456-426614174000",
			id,
			deletion: false,
		};
		expect(parseConfiguredPending(pending, config, "edit", id)).toEqual(pending);
		expect(() => parseConfiguredPending(pending, config, "edit", "其他文章")).toThrow();
		expect(() =>
			parseConfiguredPending({ ...pending, url: "https://example.com" }, config, "edit", id),
		).toThrow();
	});
	it("真实部署工厂配置选择中文分类策略，不需要另建后台代码仓库", () => {
		expect(
			loadGitHubConfig({
				SITE_ID: "newfirefly",
				GITHUB_OWNER: "owner",
				GITHUB_REPO: "blog",
				GITHUB_BRANCH: "main",
				GITHUB_CONTENT_ROOT: site.contentRoot,
				GITHUB_TOKEN: "secret",
			}),
		).toMatchObject({ usePageBundle: false, filenamePolicy: "unicode", allowCategoryPath: true });
		expect(config.fields.map((field) => field.key)).not.toContain("password");
		expect(config.fields.map((field) => field.key)).toContain("order");
	});
	it("读取真实格式文章，未知元数据不导致无法打开，目录不会当作资源", async () => {
		const listDirectoryAtCommit = vi.fn();
		const article = await readArticle(id, {
			codec,
			pathConfig,
			requireHeadSnapshot: true,
			gitProvider: {
				getFile: vi.fn(),
				getHead: vi.fn().mockResolvedValue({ commitSha: base }),
				getFileAtCommit: vi.fn().mockResolvedValue(file),
				listDirectoryAtCommit,
			},
		});
		expect(article.pathAlias).toBe(`${id}.md`);
		expect(article.frontmatter.title).toBe("博客使用指南");
		expect(article.frontmatter.draft).toBe(false);
		expect(article.frontmatter.lang).toBe("");
		expect(listDirectoryAtCommit).not.toHaveBeenCalled();
		expect(parseConfiguredArticle({ article }, config, id).sha).toBe(blob);
	});
	it("创建只提交中文分类下的 md 文件并返回准确别名", async () => {
		const commitFilesAtomically = writer();
		const result = await createArticle(id, base, writeInput(), {
			codec,
			pathConfig,
			checkpointCandidateCommit,
			gitProvider: { commitFilesAtomically },
		});
		expect(commitFilesAtomically.mock.calls[0]?.[0].files).toMatchObject([
			{ path, expectedSha: null },
		]);
		expect(parseConfiguredCommit({ article: result }, config, id).pathAlias).toBe(`${id}.md`);
	});
	it("更新从原始 HEAD 读取并保留 descriptionSource 和 prev", async () => {
		const getFileAtCommit = vi.fn().mockResolvedValue(file);
		const commitFilesAtomically = writer();
		await updateArticle(id, base, blob, writeInput(), {
			codec,
			pathConfig,
			checkpointCandidateCommit,
			gitProvider: { getFileAtCommit, commitFilesAtomically },
		});
		expect(getFileAtCommit).toHaveBeenCalledWith(path, base);
		const content = commitFilesAtomically.mock.calls[0]?.[0].files[0];
		expect(
			content &&
				"content" in content &&
				parseEditableMarkdownDocument(codec, content.content).unknownFrontmatter,
		).toEqual({ descriptionSource: "manual", prev: "../上一篇" });
	});
	it("原始文件 SHA 不匹配时停止写入", async () => {
		const commitFilesAtomically = writer();
		await expect(
			updateArticle(id, base, blob, writeInput(), {
				codec,
				pathConfig,
				checkpointCandidateCommit,
				gitProvider: {
					getFileAtCommit: vi.fn().mockResolvedValue({ ...file, sha: commit }),
					commitFilesAtomically,
				},
			}),
		).rejects.toMatchObject({ status: 409 });
		expect(commitFilesAtomically).not.toHaveBeenCalled();
	});
	it("删除只触及当前文件，不扫描分类、不删除同目录文章和图片", async () => {
		const listDirectoryAtCommit = vi.fn();
		const plan = await prepareArticleDelete(id, base, blob, {
			pathConfig,
			gitProvider: { getFileAtCommit: vi.fn().mockResolvedValue(file), listDirectoryAtCommit },
		});
		const commitFilesAtomically = writer(true);
		const result = await commitArticleDelete(plan, {
			gitProvider: { commitFilesAtomically },
			checkpointCandidateCommit,
		});
		expect(commitFilesAtomically.mock.calls[0]?.[0].files).toEqual([
			{ operation: "delete", path, expectedSha: blob },
		]);
		expect(listDirectoryAtCommit).not.toHaveBeenCalled();
		expect(parseConfiguredCommit({ deletion: result }, config, id, true).deletedFiles).toEqual([
			`${id}.md`,
		]);
	});
	it("删除恢复仅检查目标文件不存在，分类仍存在也能恢复", async () => {
		const getFileAtCommit = vi
			.fn()
			.mockResolvedValueOnce(file)
			.mockRejectedValueOnce(new ApiError(404, "NOT_FOUND", "not found"));
		const listDirectoryAtCommit = vi.fn();
		const result = await recoverDeletedArticle(id, base, commit, {
			pathConfig,
			gitProvider: {
				getFileAtCommit,
				listDirectoryAtCommit,
				getHead: vi.fn().mockResolvedValue({
					commitSha: commit,
					commitUrl: `https://github.com/owner/blog/commit/${commit}`,
				}),
			},
		});
		expect(result?.deletedFiles).toEqual([`${id}.md`]);
		expect(listDirectoryAtCommit).not.toHaveBeenCalled();
	});
	it("路径按段编码，拒绝穿越和过深分类", () => {
		expect(articleRoute(id)).toBe(`/articles/${id.split("/").map(encodeURIComponent).join("/")}`);
		for (const unsafe of ["../文章", "分类/../文章", "a/b/c/d/e/f", "分类/CON"])
			expect(() => validateEditorStorageId(unsafe, "unicode", true)).toThrow();
		expect(() => validateEditorStorageId(id, "unicode", false)).toThrow();
	});
	it("只提交声明字段，数字和标签正确转换，异常响应目标失败关闭", () => {
		const input = writeInput();
		expect(input.frontmatter.tags).toEqual(["使用文档", "博客"]);
		expect(input.frontmatter.order).toBe(0);
		expect(input.frontmatter.published).toMatch(/^2026-04-18/);
		expect(() =>
			parseConfiguredCommit({ article: { storageSlug: "other" } }, config, id),
		).toThrow();
	});
});
