import { z } from "zod";
import { requiredText, safeHttpsUrl, safeText } from "../../sites/field-validators";
import { fireflyPostsType } from "../../sites/firefly";
import type { ContentTypeConfig } from "../../sites/types";
import { safeCoverReference } from "./article-field-validators";

/**
 * 按内容类型构建可写 Frontmatter Schema。
 *
 * 字段与校验全部来自站点配置，这个函数本身不含任何字段清单——「字段定义只有一份」的关键。
 * 新增一个内容类型只需要写一份 `src/sites/<site>.ts`，不必碰这里。
 *
 * `strict()` 会拒绝未声明的字段，避免静默丢弃客户端试图写入的构建内部数据。
 * 编辑器源码模式需要保留未知字段时走 `frontmatter-utils` 的 editable 路径，那条路径
 * 不受这里的 strict 约束。
 */
export function buildArticleFrontmatterSchema(contentType: ContentTypeConfig) {
	const shape: Record<string, z.ZodTypeAny> = {};
	for (const field of contentType.fields) {
		shape[field.key] = field.validation;
	}
	const objectSchema = z.object(shape).strict();
	if (contentType.refine === undefined) {
		return objectSchema;
	}
	return objectSchema.superRefine(contentType.refine);
}

/**
 * 编辑输入 Schema。
 *
 * P1 只接受 Markdown：`format` 是字面量而非任意扩展名，防止客户端借此写入 MDX 或其他
 * 可影响构建执行面的文件类型。扩展名白名单在 `path-policy` 再独立收口一次。
 */
export function buildArticleEditorInputSchema(contentType: ContentTypeConfig) {
	return z
		.object({
			frontmatter: buildArticleFrontmatterSchema(contentType),
			slug: safeText(100).optional(),
			format: z.literal("md").default("md"),
			markdown: z.string().max(1_000_000),
		})
		.strict();
}

/**
 * 与 Firefly Content Collection 对齐的可写 Frontmatter Schema。
 *
 * 这是 **Phase 1a 的过渡形态**：字段清单暂时手写在这里，与 `src/sites/firefly.ts` 的声明
 * 并存。之所以不立刻改为由站点配置派生，是因为派生会把 schema 的输出类型退化成
 * `Record<string, unknown>`，牵连 `frontmatter-utils` 与编辑器表单的整套类型改造——那属于
 * Phase 1b 的范围，与「按类型渲染表头」是同一件事。
 *
 * 两份定义不会静默漂移：`tests/sites/firefly-config.test.ts` 会逐项核对字段键、默认值与
 * 接受/拒绝行为。Phase 1b 完成类型改造后，这份手写 schema 将被删除。
 */
export const articleFrontmatterSchema = z
	.object({
		title: requiredText(200),
		published: z.coerce.date(),
		updated: z.coerce.date().optional(),
		draft: z.boolean().default(true),
		description: safeText(500).default(""),
		image: safeCoverReference(2_048).default(""),
		tags: z.array(requiredText(50)).max(30).default([]),
		category: requiredText(100).nullable().default(null),
		lang: requiredText(20).default("zh_CN"),
		pinned: z.boolean().default(false),
		author: safeText(100).default(""),
		sourceLink: safeHttpsUrl(2_048).default(""),
		licenseName: safeText(100).default(""),
		licenseUrl: safeHttpsUrl(2_048).default(""),
		comment: z.boolean().default(true),
		password: safeText(200).default(""),
		passwordHint: safeText(200).default(""),
	})
	.strict();

/**
 * P1 编辑输入只接受 Markdown。format 是字面量而非任意扩展名，防止客户端借此
 * 写入 MDX 或其他可影响构建执行面的文件类型。
 */
export const articleEditorInputSchema = z
	.object({
		frontmatter: articleFrontmatterSchema,
		slug: safeText(100).optional(),
		format: z.literal("md").default("md"),
		markdown: z.string().max(1_000_000),
	})
	.strict();

export type ValidatedArticleFrontmatter = z.infer<typeof articleFrontmatterSchema>;
export type ValidatedArticleEditorInput = z.infer<typeof articleEditorInputSchema>;

/** 在所有默认值与边界校验通过后，才允许文章数据进入路径和 Provider 层。 */
export function parseArticleEditorInput(input: unknown): ValidatedArticleEditorInput {
	return articleEditorInputSchema.parse(input);
}

/** Phase 1b 将用它替换上面的手写 schema：内容类型贯穿到文章服务之后即可删除过渡定义。 */
export const fireflyFrontmatterSchema = buildArticleFrontmatterSchema(fireflyPostsType);
