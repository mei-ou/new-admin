import { parseMarkdownDocument } from "../../modules/markdown-codec/parser";
import type { MarkdownSourcePlaceholderNode } from "../../modules/markdown-codec/types";
import { createMarkdownVideoSource } from "../../modules/markdown-codec/video";

export const SPECIAL_BLOCK_LABELS = {
	callout: "提示框",
	details: "折叠内容",
	"math-block": "数学公式",
	"math-inline": "行内公式",
	mermaid: "流程图（Mermaid）",
	video: "视频",
} as const;

export type SpecialBlockKind = keyof typeof SPECIAL_BLOCK_LABELS;
export interface SpecialBlockFields {
	kind: SpecialBlockKind;
	title: string;
	body: string;
	calloutType: string;
	open: boolean;
	provider: "youtube" | "bilibili";
	videoId: string;
}

export type SpecialBlockNode = MarkdownSourcePlaceholderNode & { kind: SpecialBlockKind };
export function listSpecialBlocks(source: string): SpecialBlockNode[] {
	return parseMarkdownDocument(source).document.nodes.filter(
		(node): node is SpecialBlockNode =>
			node.category === "source-placeholder" && node.kind in SPECIAL_BLOCK_LABELS,
	);
}

export function readSpecialBlock(node?: SpecialBlockNode): SpecialBlockFields {
	const metadata = node?.metadata ?? {};
	return {
		kind: node?.kind ?? "callout",
		title: String(metadata.title ?? metadata.summary ?? ""),
		body:
			node?.kind === "callout"
				? node.sourceSlice
						.replace(/\r\n/g, "\n")
						.split("\n")
						.slice(1)
						.filter((line) => line.startsWith("> ") || line === ">")
						.map((line) => line.replace(/^> ?/, ""))
						.join("\n")
				: node?.kind === "details"
					? String(metadata.bodyMarkdown ?? "").replace(/\r?\n$/, "")
					: String(metadata.tex ?? metadata.body ?? ""),
		calloutType: String(metadata.type ?? "note").toUpperCase(),
		open: metadata.open === true,
		provider: metadata.provider === "bilibili" ? "bilibili" : "youtube",
		videoId: String(metadata.videoId ?? ""),
	};
}

export function createSpecialBlock(fields: SpecialBlockFields): string {
	const body = fields.body.replace(/\r\n?/g, "\n");
	if (/[\r\n<>]/.test(fields.title)) throw new Error("标题不能包含换行或 HTML 标签。");
	let source: string;
	switch (fields.kind) {
		case "callout":
			if (/<\s*\/?[A-Za-z!][^>]*>/.test(body))
				throw new Error("提示框内容请使用普通文字或 Markdown，不支持 HTML 标签。");
			if (!/^(NOTE|TIP|IMPORTANT|WARNING|CAUTION)$/.test(fields.calloutType))
				throw new Error("请选择有效的提示类型。");
			source = `> [!${fields.calloutType}]${fields.title ? ` ${fields.title}` : ""}\n${body
				.split("\n")
				.map((line) => `> ${line}`)
				.join("\n")}\n`;
			break;
		case "details":
			source = `<details${fields.open ? " open" : ""}>\n<summary>${fields.title}</summary>\n\n${body}\n</details>\n`;
			break;
		case "math-block":
			source = `$$\n${body}\n$$\n`;
			break;
		case "math-inline":
			source = `$${body}$`;
			break;
		case "mermaid":
			source = `\u0060\u0060\u0060mermaid\n${body}\n\u0060\u0060\u0060\n`;
			break;
		case "video":
			if (
				!(fields.provider === "youtube" ? /^[A-Za-z0-9_-]{11}$/ : /^BV[A-Za-z0-9]{10}$/).test(
					fields.videoId.trim(),
				)
			)
				throw new Error("YouTube 视频号需为 11 位；B 站视频号需为 BV 加 10 位字符。");
			source = createMarkdownVideoSource(fields.provider, fields.videoId.trim());
			break;
	}
	const nodes = listSpecialBlocks(source);
	if (nodes.length !== 1 || nodes[0]?.kind !== fields.kind || nodes[0]?.sourceSlice !== source) {
		throw new Error("内容超出安全特殊块格式，请检查公式分隔符、代码围栏或 HTML 标签。");
	}
	return source;
}

export function replaceSpecialBlock(
	source: string,
	node: MarkdownSourcePlaceholderNode,
	replacement: string,
): string {
	if (source.slice(node.range.from, node.range.to) !== node.sourceSlice)
		throw new Error("正文已变化，请重新打开特殊块后编辑。");
	return source.slice(0, node.range.from) + replacement + source.slice(node.range.to);
}

export function insertSpecialBlock(
	source: string,
	from: number,
	to: number,
	block: string,
): string {
	if (
		!Number.isInteger(from) ||
		!Number.isInteger(to) ||
		from < 0 ||
		to < from ||
		to > source.length
	)
		throw new Error("插入位置无效，请重新选择正文位置。");
	const overlapsProtected = parseMarkdownDocument(source).document.nodes.some(
		(node) =>
			node.category !== "structured" &&
			(from === to
				? from > node.range.from && from < node.range.to
				: from < node.range.to && to > node.range.from),
	);
	if (overlapsProtected)
		throw new Error("光标或选区位于特殊块内，请使用已有特殊块的编辑按钮，或选择普通正文位置。");
	return `${source.slice(0, from)}\n\n${block}\n\n${source.slice(to)}`;
}
