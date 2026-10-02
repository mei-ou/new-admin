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
 * Front-matter 编解码上下文（codec）。
 *
 * 把「用哪套字段定义解析 / 序列化」从模块级常量提升为显式参数。`frontmatter-utils` 的每个
 * 公开函数都要求传入 codec，因此不存在「拿 Firefly 的 schema 去解析另一内容类型文章」的
 * 隐式路径；即便传错，严格 schema 也会直接解析失败（失败关闭），而不是静默接受字段错位的文章。
 */
export interface FrontmatterCodec {
	/** 服务端权威校验 schema，由内容类型的字段定义派生。 */
	readonly schema: z.ZodType<ArticleFrontmatter>;
	/** 已知字段键集合。迭代顺序即 `contentType.fields` 顺序，决定 YAML 字段顺序。 */
	readonly knownKeys: ReadonlySet<string>;
}

/**
 * 由内容类型派生 codec。
 *
 * 这里不再需要类型投影：`ArticleFrontmatter` 已是记录类型（`Readonly<Record<string, unknown>>`），
 * 动态组装的 Zod object 的输出形状与它天然兼容。此前必须投影，是因为当时
 * `ArticleFrontmatter` 是固定 17 字段的具名接口，而索引签名类型不可赋给具名接口。
 */
export function createFrontmatterCodec(contentType: ContentTypeConfig): FrontmatterCodec {
	return {
		schema: buildArticleFrontmatterSchema(contentType),
		knownKeys: getFieldKeys(contentType),
	};
}

/**
 * 过渡期的默认 codec = Firefly。
 *
 * 存在的唯一理由是「内容类型尚未贯穿到全部调用点」（Phase 1b-3 负责透传）。调用点**显式**
 * 引用它，而不是让函数参数静默兜底：这样 Phase 1b-3 只要 grep `fireflyFrontmatterCodec`
 * 就能拿到全部待替换位置，不会漏掉某个调用点，也不会把默认值永久遗忘在代码里。
 */
export const fireflyFrontmatterCodec: FrontmatterCodec = createFrontmatterCodec(fireflyPostsType);

/**
 * Firefly 内容类型的可写 Front-matter Schema（唯一来源：`src/sites/firefly.ts`）。
 *
 * 只是 `fireflyFrontmatterCodec.schema` 的具名别名，供既有消费点与测试直接使用；
 * 不在这里重新组装 schema，避免出现第二个实例而与 codec 漂移。
 */
export const articleFrontmatterSchema: z.ZodType<ArticleFrontmatter> =
	fireflyFrontmatterCodec.schema;

/**
 * 编辑输入边界。与 Front-matter 同源派生，避免信封字段出现第二份定义。
 *
 * 这里保留类型断言，但它**不是** Front-matter 形状的投影（那类投影已随 `ArticleFrontmatter`
 * 记录化一并移除）。原因只在信封字段：`exactOptionalPropertyTypes` 下 Zod 的 `.optional()`
 * 产出 `slug: string | undefined`，而 `ArticleEditorInput.slug?: string` 不允许显式 `undefined`。
 */
export const articleEditorInputSchema: z.ZodType<ArticleEditorInput> =
	buildArticleEditorInputSchema(fireflyPostsType) as unknown as z.ZodType<ArticleEditorInput>;

export type ValidatedArticleFrontmatter = ArticleFrontmatter;
export type ValidatedArticleEditorInput = ArticleEditorInput;

/** 在所有默认值与边界校验通过后，才允许文章数据进入路径和 Provider 层。 */
export function parseArticleEditorInput(input: unknown): ValidatedArticleEditorInput {
	return articleEditorInputSchema.parse(input);
}
