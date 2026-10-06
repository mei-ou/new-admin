import { slug } from "github-slugger";
import { describe, expect, it } from "vitest";
import { transformWikiLinks } from "../../integrations/newfirefly/wiki-link-transform.mjs";

const posts = [
	{
		path: "博客指南/原始文件",
		slug: "custom/post",
		title: "文章标题",
		description: "摘要",
		tags: ["测试"],
		category: "博客指南",
		image: "https://example.com/cover.png",
	},
	{ path: "另一个目录/重复", slug: "duplicate/one", title: "重复一" },
	{ path: "目录/重复", slug: "duplicate/two", title: "重复二" },
	{ path: "草稿", slug: "draft", title: "未公开标题", draft: true },
];
function render(value: string) {
	const tree = {
		type: "root",
		children: [{ type: "paragraph", children: [{ type: "text", value }] }],
	};
	transformWikiLinks(tree, posts, { slugify: slug });
	return tree as unknown as {
		children: {
			type: string;
			url?: string;
			children?: { type: string; url?: string; value?: string }[];
			data?: { hProperties: { href: string }; hChildren: unknown[] };
		}[];
	};
}
describe("参考博客 Wiki Link 渲染", () => {
	it.each(["custom/post", "博客指南/原始文件", "原始文件"])(
		"支持 slug、路径或唯一文件名：%s",
		(target) => {
			expect(render(`[[${target}]]`).children[0]?.data?.hProperties.href).toBe(
				"/posts/custom/post/",
			);
		},
	);
	it("行内和标题锚点生成普通链接", () => {
		expect(render("查看 [[custom/post|自定义标题]] 继续").children[0]?.children?.[1]?.url).toBe(
			"/posts/custom/post/",
		);
		expect(render("[[custom/post#标题|定位]]").children[0]?.url).toBe(
			`/posts/custom/post/#${encodeURIComponent("标题")}`,
		);
	});
	it("不猜测重名文件，不公开草稿，不转换未知目标", () => {
		for (const target of ["重复", "draft", "../outside", "https://evil.example", "missing"])
			expect(render(`[[${target}]]`).children[0]?.data).toBeUndefined();
	});
	it("卡片 metadata 作为 AST 文本，不使用可执行 HTML", () => {
		const tree = {
			type: "root",
			children: [{ type: "paragraph", children: [{ type: "text", value: "[[safe/post]]" }] }],
		};
		transformWikiLinks(
			tree,
			[
				{
					path: "safe/post",
					slug: "safe/post",
					title: "<script>alert(1)</script>",
					image: "javascript:alert(1)",
				},
			],
			{ slugify: slug },
		);
		const rendered = JSON.stringify(tree);
		expect(rendered).toContain('"type":"text"');
		expect(rendered).not.toContain("javascript:");
	});
	it("不处理代码、已存在链接、转义或图片嵌入", () => {
		for (const type of ["code", "inlineCode", "link", "html"]) {
			const tree = {
				type: "root",
				children: [{ type, children: [{ type: "text", value: "[[custom/post]]" }] }],
			};
			const before = JSON.stringify(tree);
			transformWikiLinks(tree, posts, { slugify: slug });
			expect(JSON.stringify(tree)).toBe(before);
		}
		expect(render("![[custom/post]]").children[0]?.data).toBeUndefined();
		const tree = {
			type: "root",
			children: [{ type: "paragraph", children: [{ type: "text", value: "[[custom/post]]" }] }],
		};
		transformWikiLinks(tree, posts, { slugify: slug, source: "\\[[custom/post]]" });
		expect(JSON.stringify(tree)).not.toContain("hProperties");
	});
});
