import { z } from "zod";
import { safeText } from "../../sites/field-validators";
import { fireflyPostsType } from "../../sites/firefly";
import type { ContentTypeConfig } from "../../sites/types";
import { getFieldKeys } from "../../sites/types";
import type { ArticleEditorInput, ArticleFrontmatter } from "../../types/article";

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
 * 当前生效内容类型的 Front-matter 键集合。
 *
 * `frontmatter-utils` 用它区分「已知字段」与「编辑器要原样保留的未知字段」。键集合与
 * 字段校验同源（都来自站点配置），因此不会出现「schema 认某个键、键集合不认」的错位。
 *
 * 过渡形态说明：内容类型参数化尚未贯穿到全部调用点，所以这里先固定按 Firefly 内容类型
 * 派生。Phase 1b 完成内容类型贯穿后，该集合改由调用方按 `contentType` 传入，这个常量即可删除。
 */
export const ARTICLE_FRONTMATTER_KEYS: ReadonlySet<string> = getFieldKeys(fireflyPostsType);

/**
 * Firefly 内容类型的可写 Front-matter Schema（唯一来源：`src/sites/firefly.ts`）。
 *
 * 这里不再重复声明字段清单：新增或修改字段只需改站点配置一处，不存在两份定义漂移的可能。
 *
 * 显式标注 `z.ZodType<ArticleFrontmatter>` 是**刻意的类型投影**。按站点配置动态组装的
 * Zod object 只能推出 `Record<string, unknown>`；若任由它退化，`read-article`、
 * `list-articles`、编辑器表单等消费点会立刻失去字段类型（已用 TS 探针确认：索引签名
 * 类型不可赋给具名接口）。投影把 Firefly 构建真实读取的字段形状重新贴回来，而等价性
 * 由运行时测试逐项核对：`tests/modules/article-schema.test.ts` 覆盖默认值、必填、
 * 未知字段拒绝、标签上限、控制字符与 URL 安全，`tests/sites/firefly-config.test.ts`
 * 核对「派生结果由站点声明的字段驱动」。
 */
export const articleFrontmatterSchema: z.ZodType<ArticleFrontmatter> =
	buildArticleFrontmatterSchema(fireflyPostsType) as unknown as z.ZodType<ArticleFrontmatter>;

/** 编辑输入边界。与 Front-matter 同源派生，避免信封字段出现第二份定义。 */
export const articleEditorInputSchema: z.ZodType<ArticleEditorInput> =
	buildArticleEditorInputSchema(fireflyPostsType) as unknown as z.ZodType<ArticleEditorInput>;

export type ValidatedArticleFrontmatter = ArticleFrontmatter;
export type ValidatedArticleEditorInput = ArticleEditorInput;

/** 在所有默认值与边界校验通过后，才允许文章数据进入路径和 Provider 层。 */
export function parseArticleEditorInput(input: unknown): ValidatedArticleEditorInput {
	return articleEditorInputSchema.parse(input);
}
