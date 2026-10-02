import { parseDocument, stringify } from "yaml";
import type {
	FrontmatterCodec,
	ValidatedArticleFrontmatter,
} from "../modules/articles/article-schema";
import { parseSlug } from "./slug-utils";

const FRONTMATTER_DELIMITER = "---";
const FRONTMATTER_MAX_LENGTH = 64 * 1024;
const DOCUMENT_MAX_LENGTH = 1_000_000;

export interface ParsedFrontmatter {
	frontmatter: ValidatedArticleFrontmatter;
	slug?: string;
}

export interface ParsedEditableFrontmatter extends ParsedFrontmatter {
	unknownFrontmatter: Readonly<Record<string, unknown>>;
}

export interface ParsedMarkdownDocument extends ParsedFrontmatter {
	markdown: string;
}

export interface ParsedEditableMarkdownDocument extends ParsedEditableFrontmatter {
	markdown: string;
}

/**
 * 本模块的每个公开函数都要求调用方传入 `codec`（`FrontmatterCodec`）。
 *
 * 这是刻意的显式依赖，而不是让函数自己去取「当前站点」：字段定义与校验随内容类型变化，
 * 一旦某处隐式套用 Firefly 的 schema 去解析另一类型的文章，严格 schema 会直接解析失败，
 * 而不是静默接受一份字段错位的文章。传错 codec 是失败关闭，不是数据损坏。
 */

const YAML_SERIALIZE_OPTIONS = {
	schema: "core" as const,
	customTags: [],
	merge: false,
	lineWidth: 0,
	simpleKeys: true,
};

/**
 * 把已验证 Frontmatter 落成可序列化对象。字段顺序**由 codec 的字段声明顺序决定**：
 * `codec.knownKeys` 是 `Set`，其迭代顺序就是 `contentType.fields` 的顺序。
 *
 * 这里刻意不再写一遍字段清单。硬编码顺序是「字段定义的又一份副本」：站点配置新增字段后
 * 它不会报错，只会让新字段排到 YAML 末尾，且因为不经过下面的日期归一化而写出
 * `2026-08-12T00:00:00.000Z` 之外的形态。派生顺序后，「改站点配置一处」即可完整决定
 * 序列化结果。Firefly 现有字段顺序与该派生结果一致，因此 YAML 输出逐字节不变。
 *
 * 两个字段级特例属于行为约定，不是字段清单：
 * - `slug` 并非 Front-matter 字段，但按既有习惯紧随 `title` 输出（空字符串视同未提供，
 *   与迁移前 `...(slug ? { slug } : {})` 的行为一致）；
 * - `Date` 一律先转 ISO 字符串，确保 Worker、GitHub 与 Firefly 构建环境结果一致。
 */
function createSerializableFrontmatter(
	codec: FrontmatterCodec,
	frontmatter: ValidatedArticleFrontmatter,
	slug?: string,
): Record<string, unknown> {
	const values = frontmatter as unknown as Record<string, unknown>;
	const serialized: Record<string, unknown> = {};
	for (const key of codec.knownKeys) {
		const value = values[key];
		// 可选字段未提供时整键省略，避免写出 `updated: null` 改变往返语义。
		if (value === undefined) continue;
		serialized[key] = value instanceof Date ? value.toISOString() : value;
		if (key === "title" && slug) {
			serialized.slug = slug;
		}
	}
	return serialized;
}

/**
 * 将已验证数据序列化为稳定字段顺序的 YAML。
 *
 * 所有值均交给 YAML 库完成引用和转义，禁止模板字符串拼接用户字段；日期先转 ISO
 * 字符串，以确保 Worker、GitHub 与 Firefly 构建环境得到一致结果。
 */
export function serializeFrontmatter(
	codec: FrontmatterCodec,
	frontmatterInput: unknown,
	slugInput?: unknown,
): string {
	const frontmatter = codec.schema.parse(frontmatterInput);
	const slug = slugInput === undefined ? undefined : parseSlug(slugInput);

	return stringify(createSerializableFrontmatter(codec, frontmatter, slug), YAML_SERIALIZE_OPTIONS);
}

function parseYamlRecord(source: string): Record<string, unknown> {
	const document = parseDocument(source, {
		schema: "core",
		customTags: [],
		merge: false,
		uniqueKeys: true,
		stringKeys: true,
		strict: true,
	});
	if (document.errors.length > 0 || document.warnings.length > 0) {
		throw new TypeError("Frontmatter YAML 无效。");
	}

	const value = document.toJS({ maxAliasCount: 0 });
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new TypeError("Frontmatter 必须是对象。");
	}
	return { ...(value as Record<string, unknown>) };
}

/**
 * 使用 YAML 1.2 Core Schema 解析不可信 Frontmatter。
 *
 * 禁用 merge、自定义标签和 alias，要求唯一字符串键；解析完成后仍必须通过 strict
 * 文章 Schema。YAML 解析成功并不代表数据可以进入业务层。
 */
export function parseFrontmatter(codec: FrontmatterCodec, source: unknown): ParsedFrontmatter {
	if (typeof source !== "string" || source.length === 0 || source.length > FRONTMATTER_MAX_LENGTH) {
		throw new TypeError("Frontmatter 内容无效。");
	}

	const record = parseYamlRecord(source);
	const rawSlug = record.slug;
	delete record.slug;

	return {
		frontmatter: codec.schema.parse(record),
		...(rawSlug === undefined ? {} : { slug: parseSlug(rawSlug) }),
	};
}

/**
 * 编辑器源码模式允许未知 Front-matter 字段存在，但始终把它们与已验证字段分开保存。
 * 业务读取路径仍使用上面的严格解析，避免把编辑器的保真边界扩散到业务层。
 *
 * 「已知字段」完全由 `codec.knownKeys` 决定，本模块不再持有任何字段清单副本。
 */
export function parseEditableFrontmatter(
	codec: FrontmatterCodec,
	source: unknown,
): ParsedEditableFrontmatter {
	if (typeof source !== "string" || source.length === 0 || source.length > FRONTMATTER_MAX_LENGTH) {
		throw new TypeError("Frontmatter 内容无效。");
	}

	const record = parseYamlRecord(source);
	const rawSlug = record.slug;
	delete record.slug;
	const known: Record<string, unknown> = {};
	const unknownFrontmatter: Record<string, unknown> = {};
	for (const [key, value] of Object.entries(record)) {
		if (codec.knownKeys.has(key)) known[key] = value;
		else unknownFrontmatter[key] = value;
	}

	return {
		frontmatter: codec.schema.parse(known),
		unknownFrontmatter,
		...(rawSlug === undefined ? {} : { slug: parseSlug(rawSlug) }),
	};
}

/** Serializes the editor's split known/unknown representation without allowing key collisions. */
export function serializeEditableFrontmatter(
	codec: FrontmatterCodec,
	frontmatterInput: unknown,
	unknownFrontmatterInput: unknown,
	slugInput?: unknown,
): string {
	const frontmatter = codec.schema.parse(frontmatterInput);
	if (
		typeof unknownFrontmatterInput !== "object" ||
		unknownFrontmatterInput === null ||
		Array.isArray(unknownFrontmatterInput)
	) {
		throw new TypeError("未知 Frontmatter 必须是对象。");
	}

	const unknownFrontmatter = unknownFrontmatterInput as Record<string, unknown>;
	for (const key of Object.keys(unknownFrontmatter)) {
		// `slug` 由信封字段单独承载，不能被未知字段覆盖；其余受保护键来自当前 codec。
		if (key === "slug" || codec.knownKeys.has(key)) {
			throw new TypeError(`未知 Frontmatter 字段与受保护字段冲突：${key}。`);
		}
	}

	const slug = slugInput === undefined ? undefined : parseSlug(slugInput);
	return stringify(
		{ ...createSerializableFrontmatter(codec, frontmatter, slug), ...unknownFrontmatter },
		YAML_SERIALIZE_OPTIONS,
	);
}

/** 将 Frontmatter 与 Markdown 正文组合为可提交到 GitHub 的完整 `.md` 文档。 */
export function buildMarkdownDocument(
	codec: FrontmatterCodec,
	frontmatterInput: unknown,
	markdownInput: unknown,
	slugInput?: unknown,
): string {
	if (typeof markdownInput !== "string" || markdownInput.length > DOCUMENT_MAX_LENGTH) {
		throw new TypeError("Markdown 正文无效。");
	}

	const yaml = serializeFrontmatter(codec, frontmatterInput, slugInput).trimEnd();
	return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${markdownInput}`;
}

/** Builds the complete editor source while retaining fields unknown to the article schema. */
export function buildEditableMarkdownDocument(
	codec: FrontmatterCodec,
	frontmatterInput: unknown,
	unknownFrontmatterInput: unknown,
	markdownInput: unknown,
	slugInput?: unknown,
): string {
	if (typeof markdownInput !== "string" || markdownInput.length > DOCUMENT_MAX_LENGTH) {
		throw new TypeError("Markdown 正文无效。");
	}

	const yaml = serializeEditableFrontmatter(
		codec,
		frontmatterInput,
		unknownFrontmatterInput,
		slugInput,
	).trimEnd();
	return `${FRONTMATTER_DELIMITER}\n${yaml}\n${FRONTMATTER_DELIMITER}\n${markdownInput}`;
}

/**
 * 拆分导入或从 GitHub 读取的 Markdown 文档。
 * 仅把文档开头第一组独立 `---` 行视为 Frontmatter，正文内的分隔线不会被误切分。
 */
export function parseMarkdownDocument(
	codec: FrontmatterCodec,
	source: unknown,
): ParsedMarkdownDocument {
	if (
		typeof source !== "string" ||
		source.length === 0 ||
		source.length > DOCUMENT_MAX_LENGTH + FRONTMATTER_MAX_LENGTH
	) {
		throw new TypeError("Markdown 文档无效。");
	}

	const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
	if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
		throw new TypeError("Markdown 文档缺少 Frontmatter。");
	}

	const closingDelimiter = `\n${FRONTMATTER_DELIMITER}\n`;
	const closingIndex = normalized.indexOf(closingDelimiter, FRONTMATTER_DELIMITER.length + 1);
	if (closingIndex < 0) {
		throw new TypeError("Markdown Frontmatter 未闭合。");
	}

	const yamlStart = FRONTMATTER_DELIMITER.length + 1;
	const yaml = normalized.slice(yamlStart, closingIndex);
	const markdown = normalized.slice(closingIndex + closingDelimiter.length);
	return { ...parseFrontmatter(codec, yaml), markdown };
}

/** Splits a complete editor source document atomically, including unknown Front-matter fields. */
export function parseEditableMarkdownDocument(
	codec: FrontmatterCodec,
	source: unknown,
): ParsedEditableMarkdownDocument {
	if (
		typeof source !== "string" ||
		source.length === 0 ||
		source.length > DOCUMENT_MAX_LENGTH + FRONTMATTER_MAX_LENGTH
	) {
		throw new TypeError("Markdown 文档无效。");
	}

	const normalized = source.replace(/^\uFEFF/, "").replaceAll("\r\n", "\n");
	if (!normalized.startsWith(`${FRONTMATTER_DELIMITER}\n`)) {
		throw new TypeError("Markdown 文档缺少 Frontmatter。");
	}

	const closingDelimiter = `\n${FRONTMATTER_DELIMITER}\n`;
	const closingIndex = normalized.indexOf(closingDelimiter, FRONTMATTER_DELIMITER.length + 1);
	if (closingIndex < 0) {
		throw new TypeError("Markdown Frontmatter 未闭合。");
	}

	const yamlStart = FRONTMATTER_DELIMITER.length + 1;
	const yaml = normalized.slice(yamlStart, closingIndex);
	const markdown = normalized.slice(closingIndex + closingDelimiter.length);
	return { ...parseEditableFrontmatter(codec, yaml), markdown };
}

/**
 * 把任意可接受的 Markdown 文档转换为稳定提交形式。Frontmatter 重新按固定字段顺序
 * 序列化，正文只做 UTF-8 BOM 与 CRLF 归一化，不修剪空格或补写结尾换行。
 */
export function canonicalizeMarkdownDocument(codec: FrontmatterCodec, source: unknown): string {
	const parsed = parseMarkdownDocument(codec, source);
	return buildMarkdownDocument(codec, parsed.frontmatter, parsed.markdown, parsed.slug);
}

export function canonicalizeEditableMarkdownDocument(
	codec: FrontmatterCodec,
	source: unknown,
): string {
	const parsed = parseEditableMarkdownDocument(codec, source);
	return buildEditableMarkdownDocument(
		codec,
		parsed.frontmatter,
		parsed.unknownFrontmatter,
		parsed.markdown,
		parsed.slug,
	);
}
