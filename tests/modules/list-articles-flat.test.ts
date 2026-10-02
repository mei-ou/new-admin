import { describe, expect, it, vi } from "vitest";
import type { ArticlePathConfig } from "../../src/core/security/path-policy";
import { fireflyFrontmatterCodec } from "../../src/modules/articles/article-schema";
import { listArticles } from "../../src/modules/articles/services/list-articles";
import { readArticle } from "../../src/modules/articles/services/read-article";
import type { GitDirectoryEntry, GitProvider } from "../../src/providers/git/types";
import { buildMarkdownDocument } from "../../src/utils/frontmatter-utils";

/**
 * 扁平文件形态（`flat`）的文章列表扫描。
 *
 * 与 Page Bundle 的差异集中在这里：候选来自**递归目录遍历**而非一级子目录，
 * 存储标识可含分类子目录与 Unicode 文件名，且必须排除同目录下的非 `.md` 文件。
 */

const FILE_SHA = "a".repeat(40);
const TYPE_BASE = "src/content/posts";

const flatConfig: ArticlePathConfig = {
	contentRoot: "src/content",
	usePageBundle: false,
	entryFilename: "index.md",
	typeDirectory: "posts",
	extension: ".md",
	filenamePolicy: "unicode",
	allowCategoryPath: true,
};

function file(directory: string, name: string): GitDirectoryEntry {
	return { name, path: `${directory}/${name}`, sha: FILE_SHA, type: "file", size: 128 };
}

function directory(parent: string, name: string): GitDirectoryEntry {
	return { name, path: `${parent}/${name}`, sha: FILE_SHA, type: "directory", size: null };
}

function article(title: string): string {
	return buildMarkdownDocument(
		fireflyFrontmatterCodec,
		{ title, published: new Date("2026-08-12T00:00:00.000Z") },
		"正文\n",
	);
}

function createProvider(
	tree: Record<string, GitDirectoryEntry[]>,
	contents: Record<string, string>,
) {
	const listDirectory = vi
		.fn<GitProvider["listDirectory"]>()
		.mockImplementation(async (path: string) => {
			const entries = tree[path];
			if (entries === undefined) {
				throw new Error(`未知目录：${path}`);
			}
			return entries;
		});
	const getFile = vi.fn<GitProvider["getFile"]>().mockImplementation(async (path: string) => {
		const content = contents[path];
		if (content === undefined) {
			throw new Error(`未知文件：${path}`);
		}
		return { path, sha: FILE_SHA, encoding: "utf-8", content };
	});
	return { listDirectory, getFile };
}

/** 一棵含分类子目录、Unicode 文件名与干扰文件的扁平文章树。 */
function sampleTree() {
	return {
		[`${TYPE_BASE}`]: [
			file(TYPE_BASE, "我的文章.md"),
			file(TYPE_BASE, "_frontmatter.json"),
			file(TYPE_BASE, "cover.webp"),
			directory(TYPE_BASE, "旅行"),
			directory(TYPE_BASE, "notes"),
		],
		[`${TYPE_BASE}/旅行`]: [file(`${TYPE_BASE}/旅行`, "京都.md")],
		[`${TYPE_BASE}/notes`]: [directory(`${TYPE_BASE}/notes`, "deep")],
		[`${TYPE_BASE}/notes/deep`]: [file(`${TYPE_BASE}/notes/deep`, "深层.md")],
	};
}

const sampleContents: Record<string, string> = {
	[`${TYPE_BASE}/我的文章.md`]: article("我的文章"),
	[`${TYPE_BASE}/旅行/京都.md`]: article("京都"),
	[`${TYPE_BASE}/notes/deep/深层.md`]: article("深层"),
};

describe("扁平形态的文章列表扫描", () => {
	it("递归收集 .md，存储标识保留分类子目录与 Unicode 文件名", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles({}, { gitProvider: provider, pathConfig: flatConfig });

		expect(result.items.map((item) => item.storageSlug).sort()).toEqual(
			["我的文章", "旅行/京都", "notes/deep/深层"].sort(),
		);
		expect(result.skipped).toBe(0);
		expect(result.truncated).toBe(false);
	});

	it("跳过非 .md 文件，不把它们当成候选", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles({}, { gitProvider: provider, pathConfig: flatConfig });

		expect(result.candidateCount).toBe(3);
	});

	it("摘要字段按扁平形态的存储标识读取", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles({}, { gitProvider: provider, pathConfig: flatConfig });
		const item = result.items.find((entry) => entry.storageSlug === "旅行/京都");

		expect(item?.title).toBe("京都");
		expect(item?.published).toEqual(new Date("2026-08-12T00:00:00.000Z"));
	});

	it("超过目录深度上限时标记 truncated 并停止下钻", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles(
			{},
			{ gitProvider: provider, pathConfig: flatConfig, maxDirectoryDepth: 1 },
		);

		expect(result.truncated).toBe(true);
		expect(result.items.map((item) => item.storageSlug).sort()).toEqual(
			["我的文章", "旅行/京都"].sort(),
		);
	});

	it("超过节点数上限时标记 truncated 并停止遍历", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles(
			{},
			{ gitProvider: provider, pathConfig: flatConfig, maxDirectoryNodes: 2 },
		);

		expect(result.truncated).toBe(true);
		expect(result.items.length).toBeLessThan(3);
	});

	it("根目录列举失败直接抛出，因为无法建立可信候选集合", async () => {
		const provider = createProvider({}, {});

		await expect(
			listArticles({}, { gitProvider: provider, pathConfig: flatConfig }),
		).rejects.toThrow(`未知目录：${TYPE_BASE}`);
	});

	it("缺少分类子目录权限时，带分类段的文件不被列为候选", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const result = await listArticles(
			{},
			{
				gitProvider: provider,
				pathConfig: { ...flatConfig, allowCategoryPath: false },
			},
		);

		// `allowCategoryPath: false` 时 `parseArticlePath` 会拒绝多段标识，
		// 但根目录下的单段文件仍然可用。
		expect(result.items.map((item) => item.storageSlug)).toEqual(["我的文章"]);
	});
});

describe("扁平形态的文章读取", () => {
	it("路径别名按扁平策略派生，而不是硬编码 index.md", async () => {
		const provider = createProvider(sampleTree(), sampleContents);

		const article = await readArticle("旅行/京都", {
			gitProvider: provider,
			pathConfig: flatConfig,
		});

		expect(article.storageSlug).toBe("旅行/京都");
		expect(article.pathAlias).toBe("旅行/京都.md");
	});

	it("扁平策略下不列举「同目录资源」，避免把其他文章文件当成本文资源", async () => {
		const listDirectoryAtCommit = vi.fn(async () => {
			throw new Error("扁平策略不应列举同目录资源");
		});
		const provider = {
			...createProvider(sampleTree(), sampleContents),
			getHead: vi.fn(async () => ({ commitSha: FILE_SHA, treeSha: FILE_SHA })),
			getFileAtCommit: vi.fn(async (path: string) => ({
				path,
				sha: FILE_SHA,
				encoding: "utf-8" as const,
				content: article("京都"),
			})),
			listDirectoryAtCommit,
		};

		const result = await readArticle("旅行/京都", {
			gitProvider: provider,
			pathConfig: flatConfig,
			requireHeadSnapshot: true,
		});

		expect(result.resources).toBeUndefined();
		expect(listDirectoryAtCommit).not.toHaveBeenCalled();
	});
});
