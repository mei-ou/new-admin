import { slug } from "github-slugger";
import { createWikiLinkSource } from "../../modules/markdown-codec/wiki-link";
import { createMarkdownLink } from "./editor-commands";
import {
	parseExternalLinkTarget,
	parseHeadingLinkTarget,
	parseInternalLinkTarget,
} from "./markdown-target-validation";

export type LinkStyle = "text" | "wiki" | "card";
export interface LinkFields {
	style: LinkStyle;
	text: string;
	target: string;
	external: boolean;
	heading: string;
}
export function buildStyledLink(fields: LinkFields): string {
	if (fields.external) {
		if (fields.style !== "text") throw new Error("Wiki Link 和文章卡片仅支持站内文章。");
		return createMarkdownLink({
			text: fields.text,
			href: parseExternalLinkTarget(fields.target),
			title: "",
		});
	}
	if (fields.style !== "text") {
		if (fields.style === "card" && fields.heading)
			throw new Error("标题锚点链接不使用文章卡片，请选择文字链接或 Wiki Link。");
		const source = createWikiLinkSource(fields.target, fields.text.trim(), fields.heading.trim());
		return fields.style === "card" ? `\n\n${source}\n\n` : source;
	}
	const path = fields.target.split("/").map(encodeURIComponent).join("/");
	const href =
		parseInternalLinkTarget(`/posts/${path}/`) +
		(fields.heading
			? parseHeadingLinkTarget(`#${encodeURIComponent(slug(fields.heading.trim()))}`)
			: "");
	return createMarkdownLink({ text: fields.text, href, title: "" });
}
