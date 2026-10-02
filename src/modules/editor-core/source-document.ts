import {
	buildEditableMarkdownDocument,
	parseEditableMarkdownDocument,
} from "../../utils/frontmatter-utils";
import { fireflyFrontmatterCodec } from "../articles/article-schema";

export interface EditorSourceDocument {
	frontmatter: Readonly<Record<string, unknown>>;
	unknownFrontmatter: Readonly<Record<string, unknown>>;
	markdown: string;
	slug?: string;
}

/** Parses the complete source atomically; callers receive no partial document on failure. */
export function parseEditorSourceDocument(source: string): EditorSourceDocument {
	const parsed = parseEditableMarkdownDocument(fireflyFrontmatterCodec, source);
	return {
		frontmatter: { ...parsed.frontmatter },
		unknownFrontmatter: { ...parsed.unknownFrontmatter },
		markdown: parsed.markdown,
		...(parsed.slug === undefined ? {} : { slug: parsed.slug }),
	};
}

export interface BuildEditorSourceDocumentInput {
	frontmatter: Readonly<Record<string, unknown>>;
	unknownFrontmatter: Readonly<Record<string, unknown>>;
	markdown: string;
	slug?: string;
}

export function buildEditorSourceDocument(input: BuildEditorSourceDocumentInput): string {
	return buildEditableMarkdownDocument(
		fireflyFrontmatterCodec,
		input.frontmatter,
		input.unknownFrontmatter,
		input.markdown,
		input.slug,
	);
}

export type EditorSourceParseResult = { ok: true; document: EditorSourceDocument } | { ok: false };

export function tryParseEditorSourceDocument(source: string): EditorSourceParseResult {
	try {
		return { ok: true, document: parseEditorSourceDocument(source) };
	} catch {
		return { ok: false };
	}
}
