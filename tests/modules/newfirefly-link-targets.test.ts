import { describe, expect, it } from "vitest";
import { createFrontmatterCodec } from "../../src/modules/articles/article-schema";
import { listArticleLinkTargets } from "../../src/modules/articles/services/list-article-link-targets";
import { newfireflySite } from "../../src/sites/newfirefly";
import { buildMarkdownDocument } from "../../src/utils/frontmatter-utils";

describe("参考博客的链接路径与 slug", () => {
	it("中文目录、Astro 自动 slug 和自定义多层 slug 都可列出", async () => {
		const type = newfireflySite.types[0];
		if (!type) throw new Error("缺少文章类型");
		const codec = createFrontmatterCodec(type);
		const root = "src/content/posts";
		const files = new Map([
			[
				`${root}/博客指南/Hello Post.md`,
				buildMarkdownDocument(
					codec,
					{ title: "默认地址", published: new Date("2026-10-05"), tags: [] },
					"## 标题",
					undefined,
				),
			],
			[
				`${root}/博客指南/自定义地址.md`,
				buildMarkdownDocument(
					codec,
					{ title: "自定义地址", published: new Date("2026-10-05"), tags: [] },
					"正文",
					"public/custom-post",
				),
			],
		]);
		const result = await listArticleLinkTargets(
			{},
			{
				codec,
				pathConfig: {
					contentRoot: root,
					usePageBundle: false,
					entryFilename: "index.md",
					filenamePolicy: "unicode",
					allowCategoryPath: true,
				},
				gitProvider: {
					async listDirectory(path) {
						return path === root
							? [
									{
										name: "博客指南",
										path: `${root}/博客指南`,
										sha: "a".repeat(40),
										type: "directory",
										size: null,
									},
								]
							: [...files.keys()].map((path) => ({
									name: path.split("/").at(-1) ?? "",
									path,
									sha: "a".repeat(40),
									type: "file",
									size: 100,
								}));
					},
					async getFile(path) {
						const content = files.get(path);
						if (!content) throw new Error("未找到测试文件");
						return { path, sha: "a".repeat(40), encoding: "utf-8", content };
					},
				},
			},
		);
		expect(result.items).toHaveLength(2);
		expect(result.items.find((item) => item.title === "默认地址")?.href).toBe(
			`/posts/${encodeURIComponent("博客指南")}/hello-post/`,
		);
		expect(result.items.find((item) => item.title === "自定义地址")?.href).toBe(
			"/posts/public/custom-post/",
		);
	});
});
