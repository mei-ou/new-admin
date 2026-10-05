import { z } from "zod";
import {
	type ArticlePathConfig,
	buildArticlePath,
	buildArticlePathAlias,
} from "../../core/security/path-policy";
import type { ArticleEditorConfig, EditorFieldConfig } from "../../modules/articles/editor-config";
import { parseSlug, parseStorageId, type StorageIdPolicy } from "../../utils/slug-utils";

export type EditorValues = Record<string, string | boolean>;
export function groupConfiguredEditorFields(config: ArticleEditorConfig) {
	function order(field: EditorFieldConfig): number {
		if (field.key === "title") return 0;
		if (field.kind === "tags") return 2;
		if (field.kind === "textarea") return 3;
		if (field.kind === "image") return 4;
		return 1;
	}
	const primary = config.fields
		.filter(
			(field) =>
				field.kind !== "boolean" &&
				(field.required || ["textarea", "tags", "image"].includes(field.kind)),
		)
		.sort((left, right) => order(left) - order(right));
	const toggles = config.fields.filter(
		(field) => field.kind === "boolean" && field.key !== "draft",
	);
	const advanced = config.fields.filter(
		(field) => field.key !== "draft" && !primary.includes(field) && !toggles.includes(field),
	);
	return { primary, toggles, advanced };
}
export interface ConfiguredPendingWrite {
	url: string;
	method: string;
	body: string;
	key: string;
	id: string;
	deletion: boolean;
}

export function parseConfiguredPending(
	input: unknown,
	config: ArticleEditorConfig,
	mode: "create" | "edit",
	storageId: string,
): ConfiguredPendingWrite {
	const pending = z
		.object({
			url: z.string(),
			method: z.enum(["POST", "PUT", "DELETE"]),
			body: z.string().max(1_100_000),
			key: z.uuid(),
			id: z.string(),
			deletion: z.boolean(),
		})
		.strict()
		.parse(input);
	validateEditorStorageId(pending.id, config.filenamePolicy, config.allowCategoryPath);
	const expectedMethod = pending.deletion ? "DELETE" : mode === "create" ? "POST" : "PUT";
	if (
		pending.method !== expectedMethod ||
		(mode === "create" && pending.deletion) ||
		(mode === "edit" && pending.id !== storageId) ||
		pending.url !==
			(mode === "create" ? "/api/articles" : articleRoute(pending.id, "/api/articles"))
	)
		throw new TypeError("待确认请求与当前编辑页面不一致。");
	const body = JSON.parse(pending.body);
	z.string()
		.regex(/^[a-f0-9]{40,64}$/)
		.parse(body.expectedHeadSha);
	if (mode === "edit")
		z.string()
			.regex(/^[a-f0-9]{40,64}$/)
			.parse(body.expectedSha);
	else if (body.storageSlug !== pending.id) throw new TypeError("待确认文章目标不一致。");
	if (!pending.deletion && (!body.article || !["draft", "publish"].includes(body.action)))
		throw new TypeError("待确认写入内容无效。");
	return pending;
}
const sha = z.string().regex(/^[a-f0-9]{40,64}$/);
const remoteSchema = z
	.object({
		storageSlug: z.string(),
		pathAlias: z.string(),
		sha,
		headSha: sha,
		frontmatter: z.record(z.string(), z.unknown()),
		markdown: z.string().max(1_000_000),
		format: z.literal("md"),
		slug: z.string().optional(),
		resources: z.array(z.unknown()).optional(),
		resourceReferenceAnalysis: z.unknown().optional(),
	})
	.strict();

export function editorPathConfig(
	config: Pick<ArticleEditorConfig, "filenamePolicy" | "allowCategoryPath" | "pathStrategy">,
): ArticlePathConfig {
	return {
		contentRoot: "content",
		usePageBundle: config.pathStrategy === "pageBundle",
		entryFilename: "index.md",
		filenamePolicy: config.filenamePolicy,
		allowCategoryPath: config.allowCategoryPath,
	};
}

export function articleRoute(storageId: string, prefix = "/articles"): string {
	return `${prefix}/${storageId.split("/").map(encodeURIComponent).join("/")}`;
}

export function validateEditorStorageId(
	input: string,
	policy: StorageIdPolicy,
	allowCategoryPath: boolean,
): string {
	const id = parseStorageId(input, policy);
	if (!allowCategoryPath && id.includes("/")) throw new TypeError("当前文章类型不允许分类子目录。");
	if (id.split("/").length > 5) throw new TypeError("分类目录最多支持四层。");
	return id;
}

export function parseConfiguredArticle(
	input: unknown,
	config: ArticleEditorConfig,
	expectedId: string,
) {
	const article = z.object({ article: remoteSchema }).strict().parse(input).article;
	if (
		article.storageSlug !== expectedId ||
		article.pathAlias !== buildArticlePathAlias(expectedId, editorPathConfig(config))
	)
		throw new TypeError("文章响应与请求目标不一致。");
	validateEditorStorageId(article.storageSlug, config.filenamePolicy, config.allowCategoryPath);
	if (article.slug !== undefined) parseSlug(article.slug);
	return article;
}

function toLocalDate(value: unknown, kind: string): string {
	if (value === undefined || value === "") return "";
	const date = new Date(String(value));
	if (!Number.isFinite(date.getTime())) throw new TypeError("文章日期无效。");
	const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString();
	return local.slice(0, kind === "date" ? 10 : 16);
}

export function createEditorValues(
	config: ArticleEditorConfig,
	frontmatter?: Record<string, unknown>,
	now = new Date(),
): EditorValues {
	return Object.fromEntries(
		config.fields.map((field) => {
			const value = frontmatter?.[field.key] ?? field.defaultValue;
			if (field.kind === "boolean") return [field.key, value === true];
			if (field.kind === "tags") return [field.key, Array.isArray(value) ? value.join(", ") : ""];
			if (field.kind === "date" || field.kind === "datetime")
				return [
					field.key,
					toLocalDate(value === "" && field.required ? now.toISOString() : value, field.kind),
				];
			return [field.key, value === undefined ? "" : String(value)];
		}),
	);
}

export function buildConfiguredWrite(
	config: ArticleEditorConfig,
	storageIdInput: string,
	values: EditorValues,
	markdown: string,
	publicSlug: string,
) {
	const storageSlug = validateEditorStorageId(
		storageIdInput,
		config.filenamePolicy,
		config.allowCategoryPath,
	);
	buildArticlePath(storageSlug, editorPathConfig(config));
	const frontmatter: Record<string, unknown> = {};
	for (const field of config.fields) {
		const value = values[field.key];
		if (field.kind === "boolean") frontmatter[field.key] = value === true;
		else if (field.kind === "tags")
			frontmatter[field.key] = String(value ?? "")
				.split(",")
				.map((tag) => tag.trim())
				.filter(Boolean);
		else if (field.kind === "number") {
			if (String(value ?? "").trim() === "" || !Number.isFinite(Number(value)))
				throw new TypeError(`${field.label}必须是有效数字。`);
			frontmatter[field.key] = Number(value);
		} else if (field.kind === "datetime" || field.kind === "date") {
			if (!value && !field.required) continue;
			const date = new Date(String(value ?? ""));
			if (!Number.isFinite(date.getTime())) throw new TypeError(`${field.label}无效。`);
			frontmatter[field.key] = date.toISOString();
		} else frontmatter[field.key] = String(value ?? "").trim();
	}
	if (markdown.length > 1_000_000) throw new TypeError("正文超过长度限制。");
	return {
		storageSlug,
		article: {
			frontmatter,
			markdown,
			format: "md",
			...(publicSlug.trim() ? { slug: parseSlug(publicSlug.trim()) } : {}),
		},
	};
}

export function parseConfiguredCommit(
	input: unknown,
	config: ArticleEditorConfig,
	expectedId: string,
	deletion = false,
) {
	const resultSchema = z
		.object({
			storageSlug: z.literal(expectedId),
			pathAlias: z.literal(buildArticlePathAlias(expectedId, editorPathConfig(config))),
			commitSha: sha,
			commitUrl: z.url().refine((url) => new URL(url).origin === "https://github.com"),
			fileSha: sha.optional(),
			deletedFiles: z.array(z.string()).optional(),
			expectedArticleUrl: z.url().optional(),
		})
		.strict();
	const result = z
		.object({ [deletion ? "deletion" : "article"]: resultSchema })
		.strict()
		.parse(input)[deletion ? "deletion" : "article"];
	if (!result || (deletion ? !result.deletedFiles?.length : !result.fileSha))
		throw new TypeError("提交结果无效。");
	return result;
}
