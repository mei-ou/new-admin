import { describe, expect, it } from "vitest";
import {
	type ImageLayout,
	parseImageLayout,
	remarkImageLayout,
	validateImageLayout,
} from "../../integrations/newfirefly/image-layout.mjs";
import {
	createImageLayoutSource,
	listArticleImages,
	prepareImageReplacement,
	replaceArticleImage,
	resolveArticleImageTarget,
} from "../../src/components/articles/image-layout-state";
import {
	flushMilkdownMarkdown,
	projectCodecToMilkdownMarkdown,
} from "../../src/modules/editor-core/adapters/milkdown/bridge";
import { parseMarkdownDocument } from "../../src/modules/markdown-codec/parser";

const sampleImage = { src: "https://example.com/图片.png", alt: "原说明", title: "原标题" };
const fields: ImageLayout = {
	layout: "single",
	width: 50,
	align: "center",
	columns: 3,
	images: [sampleImage],
};
function requireImageBlock(source: string, index = 0) {
	const block = listArticleImages(source)[index];
	if (!block) throw new Error("缺少测试图片块");
	return block;
}
describe("图片排版和已有图片换图", () => {
	it("画布刷新加入前置图片后，换图仍对应点击的原图片", () => {
		const source = createImageLayoutSource(fields);
		const previous = listArticleImages(source);
		const next = `![新增](https://example.com/new.png)\n\n${source}`;
		expect(resolveArticleImageTarget(next, previous, 0).sourceSlice).toBe(previous[0]?.sourceSlice);
		expect(resolveArticleImageTarget(next, previous, 0).format).toBe("layout");
	});
	it("重复图片按原顺序定位，数量变化时拒绝猜测", () => {
		const source = "![相同](https://example.com/a.png)\n\n![相同](https://example.com/a.png)";
		const previous = listArticleImages(source);
		const next = `前置文字\n\n${source}`;
		expect(resolveArticleImageTarget(next, previous, 1).range.from).toBeGreaterThan(
			resolveArticleImageTarget(next, previous, 0).range.from,
		);
		expect(() =>
			resolveArticleImageTarget(`${next}\n\n![相同](https://example.com/a.png)`, previous, 1),
		).toThrow();
	});
	it("普通图片只换地址时保留段落结构，不强制转换成排版块", () => {
		const source = '前文 ![说明](https://example.com/old.png "标题") 后文';
		const block = requireImageBlock(source);
		const image = block.fields.images[0];
		if (!image) throw new Error("缺少测试图片");
		image.src = "https://example.com/new.png";
		const replacement = prepareImageReplacement(block, createImageLayoutSource(block.fields));
		expect(replaceArticleImage(source, block, replacement)).toBe(
			'前文 ![说明](https://example.com/new.png "标题") 后文',
		);
	});
	it("识别已有普通 Markdown 图片，保留说明和悬停标题", () => {
		const source = '前文\n\n![原说明](https://example.com/a.png "原标题")\n\n后文\n';
		const images = listArticleImages(source);
		expect(images).toHaveLength(1);
		expect(images[0]?.fields.images[0]).toEqual({
			src: "https://example.com/a.png",
			alt: "原说明",
			title: "原标题",
		});
		const block = requireImageBlock(source);
		expect(source.slice(block.range.from, block.range.to)).toBe(block.sourceSlice);
	});
	it("代码、转义、链接嵌套和受保护内容里的示例不误识别", () => {
		for (const source of [
			"`![x](https://example.com/a.png)`",
			"\\![x](https://example.com/a.png)",
			"```md\n![x](https://example.com/a.png)\n```",
			"[![x](https://example.com/a.png)](https://example.com)",
			"<div>![x](https://example.com/a.png)</div>",
		])
			expect(listArticleImages(source)).toHaveLength(0);
	});
	it("重复图片按各自源范围编辑，不误替换另一张", () => {
		const image = "![图](https://example.com/a.png)";
		const source = `前文\n\n${image}\n\n中间\n\n${image}\n\n后文\n`;
		const replacement = createImageLayoutSource(fields);
		const next = replaceArticleImage(source, requireImageBlock(source, 1), replacement);
		expect(next.startsWith(`前文\n\n${image}\n\n中间`)).toBe(true);
		expect(next.endsWith("后文\n")).toBe(true);
		expect(listArticleImages(next)).toHaveLength(2);
	});
	it.each(["single", "grid", "swipe", "adaptive"] as const)(
		"%s 源码往返和保护签名保持",
		(layout) => {
			const config = { ...fields, layout };
			const source = createImageLayoutSource(config);
			expect(parseMarkdownDocument(source).document.nodes[0]?.kind).toBe("image-layout");
			expect(listArticleImages(source)[0]?.fields).toEqual(config);
			const projection = projectCodecToMilkdownMarkdown(source);
			expect(flushMilkdownMarkdown(projection, source).source).toBe(source);
			expect(() => flushMilkdownMarkdown(projection, source.replace("原说明", "被修改"))).toThrow();
		},
	);
	it("换图只更新地址，保留排版与文字，拒绝过期范围", () => {
		const original = createImageLayoutSource(fields);
		const block = requireImageBlock(original);
		const image = block.fields.images[0];
		if (!image) throw new Error("缺少测试图片");
		image.src = "https://example.com/new.png";
		const next = replaceArticleImage(original, block, createImageLayoutSource(block.fields));
		expect(listArticleImages(next)[0]?.fields).toEqual({
			...fields,
			images: [{ ...sampleImage, src: "https://example.com/new.png" }],
		});
		expect(() => replaceArticleImage(`前文${original}`, block, original)).toThrow();
	});
	it("非法布局保持 opaque，不执行任意 JSON 或危险图片地址", () => {
		for (const src of [
			"javascript:alert(1)",
			"data:image/png,x",
			"//evil.example/a.png",
			"https://user:password@example.com/a.png",
			"https://example.com:444/a.png",
			"https://example.com/\nfoo",
		])
			expect(() =>
				validateImageLayout({ ...fields, images: [{ src, alt: "", title: "" }] }),
			).toThrow();
		expect(parseImageLayout('{"layout":"unsafe"}')).toBeUndefined();
		expect(
			parseMarkdownDocument('```image-layout\n{"layout":"unsafe"}\n```\n').document.nodes[0]
				?.category,
		).toBe("opaque");
		expect(() =>
			validateImageLayout({ ...fields, images: Array(21).fill(fields.images[0]) }),
		).toThrow();
		expect(() =>
			validateImageLayout({ ...fields, images: [fields.images[0], fields.images[0]] }),
		).toThrow();
	});
	it("渲染为静态图片布局，说明仅作为文本，不拼接可执行 HTML", () => {
		const tree = {
			type: "root",
			children: [
				{
					type: "code",
					lang: "image-layout",
					value: JSON.stringify({
						...fields,
						images: [{ ...fields.images[0], alt: "<script>alert(1)</script>" }],
					}),
				},
			],
		};
		remarkImageLayout()(tree);
		const result = JSON.stringify(tree);
		expect(result).toContain("admin-images-single");
		expect(result).toContain('"type":"text"');
		expect(result).toContain('"data-admin-layout-image":true');
	});
});
