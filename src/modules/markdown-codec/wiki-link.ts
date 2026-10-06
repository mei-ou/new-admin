import { parseStorageId } from "../../utils/slug-utils";
import type { MarkdownSourcePlaceholderNode, MarkdownSourceRange } from "./types";

export function createWikiLinkSource(target: string, alias = "", heading = ""): string {
	if (/[#[\]|]/.test(target)) throw new Error("Wiki Link 文章路径不能包含分隔符。");
	const path = parseStorageId(target, "unicode");
	for (const value of [alias, heading]) {
		if (
			value.length > 500 ||
			/[[\]|<>\\\r\n]/.test(value) ||
			Array.from(value).some(
				(character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
			)
		)
			throw new Error("Wiki Link 的显示文字或标题锚点格式无效。");
	}
	return `[[${path}${heading ? `#${heading}` : ""}${alias ? `|${alias}` : ""}]]`;
}

export function findNextWikiLink(
	source: string,
	range: MarkdownSourceRange,
): MarkdownSourcePlaceholderNode | undefined {
	for (let offset = range.from; offset < range.to; offset += 1) {
		if (source[offset] === "\\") {
			offset += 1;
			continue;
		}
		if (source[offset] === "`") {
			let length = 1;
			while (source[offset + length] === "`") length += 1;
			const end = source.indexOf("`".repeat(length), offset + length);
			if (end !== -1 && end < range.to) {
				offset = end + length - 1;
				continue;
			}
		}
		if (source[offset] !== "[") continue;
		if (source[offset + 1] !== "[") {
			const end = source.indexOf("](", offset);
			const targetEnd = end < 0 ? -1 : source.indexOf(")", end + 2);
			if (targetEnd >= 0 && targetEnd < range.to) offset = targetEnd;
			continue;
		}
		const match = /^\[\[([^[\]\r\n]{1,700})\]\]/.exec(source.slice(offset, range.to));
		if (!match || source[offset - 1] === "!") continue;
		const parts = (match[1] ?? "").split("|");
		if (parts.length > 2) continue;
		const destination = parts[0] ?? "";
		const hash = destination.indexOf("#");
		const target = hash < 0 ? destination : destination.slice(0, hash);
		const heading = hash < 0 ? "" : destination.slice(hash + 1);
		try {
			createWikiLinkSource(target, parts[1] ?? "", heading);
		} catch {
			continue;
		}
		return {
			category: "source-placeholder",
			kind: "wiki-link",
			dirty: false,
			range: { from: offset, to: offset + match[0].length },
			sourceSlice: match[0],
			metadata: { target, heading, alias: parts[1] ?? "" },
		};
	}
	return undefined;
}
