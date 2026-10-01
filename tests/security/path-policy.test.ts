import { describe, expect, it } from "vitest";
import {
	buildArticlePath,
	buildArticleResourcePath,
	buildControlledArticleResourceReference,
	getArticleResourceFilenameConflictKey,
	parseArticlePath,
	parseArticleResourceFilename,
	parseArticleResourceReference,
	parseCategoryPath,
	parseControlledArticleResourceReference,
	parseTypeDirectory,
} from "../../src/core/security/path-policy";

const validConfig = {
	contentRoot: "src/content/posts",
	usePageBundle: true,
	entryFilename: "index.md",
};

/** tsh520 形态：站点根为 `src/content`，类型目录区分集合，扁平文件 + 中文文件名。 */
const flatConfig = {
	contentRoot: "src/content",
	usePageBundle: false,
	entryFilename: "index.md",
	typeDirectory: "posts",
	filenamePolicy: "unicode",
	allowCategoryPath: true,
} as const;

describe("文章仓库路径策略", () => {
	it("构造唯一允许的 Page Bundle Markdown 路径", () => {
		expect(buildArticlePath("firefly-admin")).toBe("src/content/posts/firefly-admin/index.md");
	});

	it("允许经过校验的自定义内容根目录", () => {
		expect(
			buildArticlePath("hello-world", {
				...validConfig,
				contentRoot: "content/blog-posts",
			}),
		).toBe("content/blog-posts/hello-world/index.md");
	});

	it("关闭 Page Bundle 后产出扁平文件路径，而不是退化路径", () => {
		expect(buildArticlePath("hello", { ...validConfig, usePageBundle: false })).toBe(
			"src/content/posts/hello.md",
		);
	});

	it("拒绝客户端 slug 中的路径穿越与分隔符", () => {
		for (const slug of ["../secret", "child\\path", "%2e%2e", "a..b"]) {
			expect(() => buildArticlePath(slug, validConfig), slug).toThrow("存储标识校验失败");
		}
	});

	it("未开启分类目录时拒绝多段存储标识", () => {
		expect(() => buildArticlePath("child/path", validConfig)).toThrow("不允许分类子目录");
	});

	it("未知路径策略与非法配置失败关闭", () => {
		expect(() =>
			buildArticlePath("hello", {
				...validConfig,
				usePageBundle: "pageBundle" as unknown as boolean,
			}),
		).toThrow("文章路径策略配置无效");
		expect(() =>
			buildArticlePath("hello", { ...validConfig, filenamePolicy: "anything" as never }),
		).toThrow("文件名策略配置无效");
	});

	it("扩展名白名单只允许 .md", () => {
		for (const extension of [".mdx", ".json", ".yaml", "md", "", ".md.bak"]) {
			expect(
				() => buildArticlePath("hello", { ...validConfig, usePageBundle: false, extension }),
				extension,
			).toThrow("文章扩展名配置无效");
		}
	});

	it("拒绝绝对、Windows 和穿越形式的内容根目录", () => {
		for (const contentRoot of [
			"/src/content/posts",
			"C:/src/content/posts",
			"src\\content\\posts",
			"src/content/../secrets",
			"src//content/posts",
			"src/content/posts/",
		]) {
			expect(() => buildArticlePath("hello", { ...validConfig, contentRoot }), contentRoot).toThrow(
				"内容根目录配置无效",
			);
		}
	});

	it("拒绝编码、控制字符和 Unicode 混淆的内容根目录", () => {
		for (const contentRoot of [
			"src/content/%2e%2e/posts",
			"src/content/po\u0000sts",
			"ｓｒｃ/content/posts",
		]) {
			expect(() => buildArticlePath("hello", { ...validConfig, contentRoot }), contentRoot).toThrow(
				"内容根目录配置无效",
			);
		}
	});

	it("入口文件固定为安全 Markdown 文件名", () => {
		for (const entryFilename of [
			"../index.md",
			"nested/index.md",
			"index.mdx",
			"index.html",
			"C:index.md",
			"ｉｎｄｅｘ.md",
		]) {
			expect(
				() => buildArticlePath("hello", { ...validConfig, entryFilename }),
				entryFilename,
			).toThrow("入口文件配置无效");
		}
	});

	it("构造 Page Bundle 直接子资源路径和相对引用", () => {
		expect(parseArticleResourceFilename("cover-abc123.webp")).toBe("cover-abc123.webp");
		expect(parseArticleResourceReference("./cover-abc123.webp")).toBe("./cover-abc123.webp");
		expect(buildArticleResourcePath("hello", "cover-abc123.webp", validConfig)).toBe(
			"src/content/posts/hello/cover-abc123.webp",
		);
	});

	it("资源文件名拒绝目录、编码分隔符、控制字符和入口文件冲突", () => {
		for (const filename of [
			"../cover.webp",
			"images/cover.webp",
			"images\\cover.webp",
			"a%2Fb.webp",
			"C:cover.webp",
			"cover\u0000.webp",
			"ｃｏｖｅｒ.webp",
			"index.md",
			".",
			"..",
		]) {
			expect(() => buildArticleResourcePath("hello", filename, validConfig), filename).toThrow();
		}
	});

	it("资源文件名拒绝隐藏文件、Windows 保留名和双扩展伪装", () => {
		for (const filename of [
			".hidden.pdf",
			"CON.pdf",
			"prn.PNG",
			"com1.txt",
			"LPT9.zip",
			"cover.png.exe",
			"archive.tar.gz",
			"no-extension",
			"trailing.",
		]) {
			expect(() => parseArticleResourceFilename(filename), filename).toThrow("资源文件名无效");
		}
	});

	it("使用规范化大小写冲突键并拒绝入口文件大小写变体", () => {
		expect(getArticleResourceFilenameConflictKey("Cover.PNG")).toBe("cover.png");
		expect(getArticleResourceFilenameConflictKey("cover.png")).toBe("cover.png");
		expect(() => buildArticleResourcePath("hello", "INDEX.MD", validConfig)).toThrow(
			"不能覆盖入口文件",
		);
		expect(() => parseArticleResourceReference("./INDEX.MD")).toThrow("不能覆盖入口文件");
	});

	it("资源相对引用固定为当前 Page Bundle 的直接子文件", () => {
		for (const reference of [
			"cover.webp",
			"../cover.webp",
			"../other/cover.webp",
			"./images/cover.webp",
			"./a%2Fb.webp",
			"./index.md",
		]) {
			expect(() => parseArticleResourceReference(reference), reference).toThrow();
		}
	});

	it("为媒体事务构造并解析规范的跨 Page Bundle 资源引用", () => {
		expect(buildControlledArticleResourceReference("source-post", "source-post", "cover.png")).toBe(
			"./cover.png",
		);
		expect(buildControlledArticleResourceReference("source-post", "target-post", "cover.png")).toBe(
			"../target-post/cover.png",
		);
		expect(
			parseControlledArticleResourceReference(
				"source-post",
				"../target-post/cover.png",
				validConfig,
			),
		).toEqual({
			reference: "../target-post/cover.png",
			storageSlug: "target-post",
			filename: "cover.png",
			repositoryPath: "src/content/posts/target-post/cover.png",
		});
	});

	it("受控跨 Bundle 引用拒绝逃逸、子目录、编码和非规范自引用", () => {
		for (const reference of [
			"../../secret/cover.png",
			"../target-post/images/cover.png",
			"../target-post/a%2Fb.png",
			"..\\target-post\\cover.png",
			"../source-post/cover.png",
			"../target-post/index.md",
			"../target-post/cover.png?raw=1",
			"../target-post/cover.png#preview",
		]) {
			expect(
				() => parseControlledArticleResourceReference("source-post", reference, validConfig),
				reference,
			).toThrow();
		}
	});

	it("API 形态不接受客户端完整路径", () => {
		const maliciousInput = {
			slug: "hello",
			path: "../../secrets/token",
		};
		expect(() => buildArticlePath(maliciousInput, validConfig)).toThrow("存储标识校验失败");
	});

	it("错误消息不回显恶意路径", () => {
		const malicious = "../../secret-token";
		try {
			buildArticlePath(malicious, validConfig);
		} catch (error) {
			expect(String(error)).not.toContain(malicious);
		}
	});
});

describe("扁平文件路径策略（tsh520 形态）", () => {
	it("按类型目录构造扁平文件路径", () => {
		expect(buildArticlePath("2024-01-01-新年", { ...flatConfig, typeDirectory: "moments" })).toBe(
			"src/content/moments/2024-01-01-新年.md",
		);
	});

	it("允许分类子目录形成多段存储标识", () => {
		expect(buildArticlePath("旅行/我的文章", flatConfig)).toBe(
			"src/content/posts/旅行/我的文章.md",
		);
	});

	it("支持多段类型目录（notebooks 嵌在 life 之下）", () => {
		expect(buildArticlePath("我的日记本", { ...flatConfig, typeDirectory: "life/notebooks" })).toBe(
			"src/content/life/notebooks/我的日记本.md",
		);
	});

	it("未开启分类目录时拒绝多段标识", () => {
		expect(() =>
			buildArticlePath("旅行/我的文章", { ...flatConfig, allowCategoryPath: false }),
		).toThrow("不允许分类子目录");
	});

	it("扁平策略下不提供文章资源路径", () => {
		expect(() => buildArticleResourcePath("我的文章", "cover.webp", flatConfig)).toThrow(
			"扁平文件策略不支持文章资源路径",
		);
	});

	it("反解扁平路径回到存储标识", () => {
		expect(parseArticlePath("src/content/posts/旅行/我的文章.md", flatConfig)).toEqual({
			storageId: "旅行/我的文章",
		});
	});

	it("构造与反解可以往返", () => {
		for (const storageId of ["我的文章", "旅行/我的文章", "2024-01-01-新年"]) {
			const path = buildArticlePath(storageId, flatConfig);
			expect(parseArticlePath(path, flatConfig).storageId).toBe(storageId);
		}
	});

	it("反解拒绝越界路径、穿越与错误扩展名", () => {
		for (const path of [
			"src/content/moments/我的文章.md",
			"src/other/posts/我的文章.md",
			"src/content/posts/我的文章.mdx",
			"src/content/posts/../我的文章.md",
		]) {
			expect(() => parseArticlePath(path, flatConfig), path).toThrow();
		}
	});
});

describe("Unicode 文件名边界", () => {
	it("允许中文、日文、韩文与常见标点", () => {
		for (const storageId of ["我的文章", "旅行/我的文章", "2024-01-01-新年", "テスト", "제목"]) {
			expect(() => buildArticlePath(storageId, flatConfig), storageId).not.toThrow();
		}
	});

	it("拒绝控制字符、编码分隔符与反斜杠", () => {
		for (const storageId of ["我的\u0000文章", "我的%2F文章", "我的\\文章", "我的/../文章"]) {
			expect(() => buildArticlePath(storageId, flatConfig), storageId).toThrow();
		}
	});

	it("拒绝 Windows 保留名与首尾点或空白", () => {
		for (const storageId of [
			"CON",
			"con.md",
			"prn",
			"aux",
			"nul",
			"com1",
			"lpt9",
			".hidden",
			"trailing.",
			" 前导",
			"尾随 ",
		]) {
			expect(() => buildArticlePath(storageId, flatConfig), storageId).toThrow();
		}
	});

	it("拒绝零宽与双向控制字符", () => {
		for (const storageId of ["我\u200b的文章", "我\u202e的文章", "\ufeff我的文章"]) {
			expect(() => buildArticlePath(storageId, flatConfig), storageId).toThrow();
		}
	});

	it("拒绝非 NFKC 归一的全角混淆输入", () => {
		expect(() => buildArticlePath("我的／文章", flatConfig)).toThrow();
	});

	it("ascii-slug 策略拒绝中文", () => {
		expect(() => buildArticlePath("我的文章", validConfig)).toThrow("存储标识校验失败");
	});
});

describe("类型目录与分类路径校验", () => {
	it("接受空类型目录与多段目录", () => {
		expect(parseTypeDirectory("")).toBe("");
		expect(parseTypeDirectory("posts")).toBe("posts");
		expect(parseTypeDirectory("life/notebooks")).toBe("life/notebooks");
	});

	it("拒绝越界与穿越的类型目录", () => {
		for (const directory of ["/posts", "posts/", "posts/../secrets", "posts//x", "..", "."]) {
			expect(() => parseTypeDirectory(directory), directory).toThrow();
		}
	});

	it("分类路径接受中文与多段，拒绝穿越", () => {
		expect(parseCategoryPath("")).toBe("");
		expect(parseCategoryPath("旅行")).toBe("旅行");
		expect(parseCategoryPath("生活/旅行")).toBe("生活/旅行");
		for (const category of ["/旅行", "旅行/", "../secrets", "旅行/../x", "旅\u0000行"]) {
			expect(() => parseCategoryPath(category), category).toThrow("分类路径无效");
		}
	});
});
