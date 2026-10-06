import { describe, expect, it } from "vitest";
import { buildStyledLink } from "../../src/components/articles/link-style";
import {
	flushMilkdownMarkdown,
	flushWikiLinkInsertion,
	projectCodecToMilkdownMarkdown,
} from "../../src/modules/editor-core/adapters/milkdown/bridge";
import { parseMarkdownDocument } from "../../src/modules/markdown-codec/parser";
import { createWikiLinkSource } from "../../src/modules/markdown-codec/wiki-link";

describe("独立链接样式", () => {
	it("手填标题锚点使用博客的标题 slug 规则", () => {
		expect(
			buildStyledLink({
				style: "text",
				text: "查看",
				target: "guide/post",
				heading: "中文 Title!",
				external: false,
			}),
		).toBe("[查看](/posts/guide/post/#%E4%B8%AD%E6%96%87-title)");
	});
	const base = {
		style: "text" as const,
		text: "中文标题",
		target: "博客指南/我的文章",
		heading: "",
		external: false,
	};
	it("普通站内链接逐段编码，不把目录斜杠编码成文件名", () => {
		expect(buildStyledLink(base)).toBe(
			`[中文标题](/posts/${encodeURIComponent("博客指南")}/${encodeURIComponent("我的文章")}/)`,
		);
	});
	it("Wiki 链接与卡片使用相对文章路径，不依赖域名", () => {
		expect(buildStyledLink({ ...base, style: "wiki" })).toBe("[[博客指南/我的文章|中文标题]]");
		expect(buildStyledLink({ ...base, style: "card" })).toBe(
			"\n\n[[博客指南/我的文章|中文标题]]\n\n",
		);
	});
	it("支持文字/Wiki 标题锚点，不生成带锚点的卡片", () => {
		expect(buildStyledLink({ ...base, style: "wiki", heading: "快速开始" })).toContain(
			"#快速开始|中文标题",
		);
		expect(buildStyledLink({ ...base, heading: "快速开始" })).toContain(
			`#${encodeURIComponent("快速开始")}`,
		);
		expect(() => buildStyledLink({ ...base, style: "card", heading: "标题" })).toThrow();
	});
	it("外链拒绝危险协议、凭据和 Wiki 样式", () => {
		for (const target of [
			"javascript:alert(1)",
			"https://user:password@example.com",
			"data:text/html,x",
		])
			expect(() => buildStyledLink({ ...base, external: true, target })).toThrow();
		expect(() => buildStyledLink({ ...base, style: "wiki", external: true })).toThrow();
	});
	it("Wiki Link 不解析代码、转义、图片或普通链接内部内容", () => {
		for (const source of [
			"`[[guide/post]]`",
			"\\[[guide/post]]",
			"![[guide/post]]",
			"[查看 [[guide/post]]](https://example.com)",
			"```md\n[[guide/post]]\n```\n",
		])
			expect(
				parseMarkdownDocument(source).document.nodes.some((node) => node.kind === "wiki-link"),
			).toBe(false);
	});
	it("非法 Wiki 目标与注入别名拒绝生成", () => {
		for (const target of ["../outside", "https://evil.example", "x|y", "x#heading", "x\\y"])
			expect(() => createWikiLinkSource(target)).toThrow();
		expect(() => createWikiLinkSource("guide/post", "<script>")).toThrow();
	});
	it("允许明确新增一个 Wiki Link，仍拒绝修改其他受保护源码", () => {
		const original = projectCodecToMilkdownMarkdown("正文\n\n<div>保留</div>\n");
		const inserted = "[[guide/post|标题]]";
		const next = `正文 ${inserted}\n\n<div>保留</div>\n`;
		expect(flushWikiLinkInsertion(original, next, inserted).source).toBe(next);
		expect(flushMilkdownMarkdown(projectCodecToMilkdownMarkdown(next), next).source).toBe(next);
		expect(() =>
			flushWikiLinkInsertion(original, next.replace("保留", "篡改"), inserted),
		).toThrow();
		expect(() =>
			flushWikiLinkInsertion(original, `${next}\n<script>x</script>\n`, inserted),
		).toThrow();
	});
});
