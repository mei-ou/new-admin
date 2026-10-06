import { Lexer } from "marked";
import {
	type ImageLayout,
	parseImageLayout,
	validateImageLayout,
} from "../../../integrations/newfirefly/image-layout.mjs";
import { parseMarkdownDocument } from "../../modules/markdown-codec/parser";
import type { MarkdownSourceRange } from "../../modules/markdown-codec/types";
import { createMarkdownImage } from "./editor-commands";

export interface ArticleImageBlock {
	format: "markdown" | "layout";
	range: MarkdownSourceRange;
	sourceSlice: string;
	fields: ImageLayout;
}

export function resolveArticleImageTarget(
	source: string,
	previous: readonly ArticleImageBlock[],
	index: number,
): ArticleImageBlock {
	const target = previous[index];
	if (!target) throw new Error("图片内容已变化，请重新选择图片。");
	const matches = (block: ArticleImageBlock) =>
		block.format === target.format && block.sourceSlice === target.sourceSlice;
	const before = previous.filter(matches);
	const after = listArticleImages(source).filter(matches);
	if (before.length !== after.length) throw new Error("图片内容已变化，请重新选择图片。");
	const resolved = after[before.indexOf(target)];
	if (!resolved) throw new Error("图片内容已变化，请重新选择图片。");
	return resolved;
}
export function readImageLayoutSource(source: string): ImageLayout | undefined {
	const lines = source.trim().split(/\r?\n/);
	return parseImageLayout(lines.slice(1, -1).join("\n"));
}
export function createImageLayoutSource(fields: ImageLayout): string {
	return `\u0060\u0060\u0060image-layout\n${JSON.stringify(validateImageLayout(fields), null, 2)}\n\u0060\u0060\u0060\n`;
}
export function listArticleImages(source: string): ArticleImageBlock[] {
	const blocks: ArticleImageBlock[] = [];
	for (const node of parseMarkdownDocument(source).document.nodes) {
		if (node.category === "source-placeholder" && node.kind === "image-layout") {
			const fields = readImageLayoutSource(node.sourceSlice);
			if (fields)
				blocks.push({ format: "layout", range: node.range, sourceSlice: node.sourceSlice, fields });
		} else if (
			node.category === "structured" &&
			node.kind !== "code-block" &&
			node.kind !== "inline-code"
		) {
			let offset = 0;
			for (const token of Lexer.lexInline(node.sourceSlice)) {
				const start = node.sourceSlice.indexOf(token.raw, offset);
				if (start < 0) break;
				offset = start + token.raw.length;
				if (token.type !== "image") continue;
				try {
					const fields = validateImageLayout({
						layout: "single",
						width: 100,
						align: "center",
						columns: 3,
						images: [{ src: token.href, alt: token.text, title: token.title ?? "" }],
					});
					blocks.push({
						format: "markdown",
						range: { from: node.range.from + start, to: node.range.from + offset },
						sourceSlice: token.raw,
						fields,
					});
				} catch {}
			}
		}
	}
	return blocks;
}
export function replaceArticleImage(
	source: string,
	block: ArticleImageBlock,
	replacement: string,
): string {
	if (source.slice(block.range.from, block.range.to) !== block.sourceSlice)
		throw new Error("图片内容已变化，请重新打开编辑窗口。");
	const content = replacement.startsWith("![") ? replacement : `\n\n${replacement}\n`;
	return `${source.slice(0, block.range.from)}${content}${source.slice(block.range.to)}`;
}

export function prepareImageReplacement(block: ArticleImageBlock, layoutSource: string): string {
	const fields = readImageLayoutSource(layoutSource);
	if (!fields) throw new Error("图片排版数据无效。");
	if (
		block.format === "markdown" &&
		fields.layout === "single" &&
		fields.width === 100 &&
		fields.align === "center"
	) {
		const image = fields.images[0];
		if (!image) throw new Error("缺少图片。");
		return createMarkdownImage({ src: image.src, alt: image.alt, title: image.title });
	}
	return layoutSource;
}
