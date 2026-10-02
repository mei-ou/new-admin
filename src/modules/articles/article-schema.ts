import { z } from "zod";
import { getContentType, getSoleContentType, resolveSiteConfig } from "../../sites";
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
	/**
	 * 编辑器输入信封（Front-matter + slug + format + markdown）的同源校验。
	 *
	 * 放在 codec 里而不是让调用方另取一份：信封里的 `frontmatter` 必须与 `schema` 用同一套
	 * 字段定义，拆成两处就必然出现「信封按 A 类型校验、序列化按 B 类型」的错位。
	 */
	readonly editorInputSchema: z.ZodType<ArticleEditorInput>;
}

/**
 * 由内容类型派生 codec。
 *
 * `schema` 处不再需要类型投影：`ArticleFrontmatter` 已是记录类型
 * （`Readonly<Record<string, unknown>>`），动态组装的 Zod object 的输出形状与它天然兼容。
 * 此前必须投影，是因为当时 `ArticleFrontmatter` 是固定 17 字段的具名接口，
 * 而索引签名类型不可赋给具名接口。
 *
 * `editorInputSchema` 处的断言是另一回事：`exactOptionalPropertyTypes` 下 Zod 的 `.optional()`
 * 产出 `slug: string | undefined`，而 `ArticleEditorInput.slug?: string` 不允许显式 `undefined`。
 */
export function createFrontmatterCodec(contentType: ContentTypeConfig): FrontmatterCodec {
	return {
		schema: buildArticleFrontmatterSchema(contentType),
		knownKeys: getFieldKeys(contentType),
		editorInputSchema: buildArticleEditorInputSchema(
			contentType,
		) as unknown as z.ZodType<ArticleEditorInput>,
	};
}

/**
 * 过渡期的默认 codec = Firefly。
 *
 * 服务端链路已全部改为注入（`grep fireflyFrontmatterCodec` 可确认只剩两类**已知残留**）：
 * - 浏览器端（`ArticleEditor.svelte` / `editor-core/source-document.ts`）：运行在浏览器里，
 *   拿不到 Worker 环境变量，等编辑页按内容类型渲染时一并处理；
 * - 4 个媒体事务服务：已冻结的能力，且只服务 Page Bundle 站点。
 *
 * **不要新增对它的引用**，尤其不要用它替代注入进来的 codec。
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

/** Firefly 的编辑输入边界。同样是 codec 的具名别名，供测试直接使用。 */
export const articleEditorInputSchema: z.ZodType<ArticleEditorInput> =
	fireflyFrontmatterCodec.editorInputSchema;

export type ValidatedArticleFrontmatter = ArticleFrontmatter;
export type ValidatedArticleEditorInput = ArticleEditorInput;

/**
 * 按部署环境解析当前内容类型的 Front-matter codec。
 *
 * 处理器在请求边界用它取得 codec，再**显式**传给服务层；服务层自己不猜「当前站点」。
 * 这样「用哪套字段定义解析」永远由部署配置决定，且传错会因严格 schema 直接解析失败
 * （失败关闭），而不是静默接受一份字段错位的文章。
 *
 * `SITE_ID` 缺失或指向未登记站点 → 503；站点含多个内容类型时同样失败关闭——多类型需要
 * 按请求选定类型，属「按类型浏览」的后续步骤，在此之前宁可整体拒绝也不要随便挑一个。
 */
export function resolveArticleCodec(env: unknown): FrontmatterCodec {
	return createFrontmatterCodec(resolveArticleContentType(env, undefined));
}

/**
 * 解析请求选定的内容类型。
 *
 * 未指定 `typeId` 时回退到站点的**唯一**类型——单类型站点（Firefly）因此保持既有行为不变；
 * 站点含多个类型而请求未指定时失败关闭（`getSoleContentType` 会拒绝），**不猜一个**。
 * 未知 `typeId` 由 `getContentType` 拒绝为 400。
 */
export function resolveArticleContentType(env: unknown, typeId: unknown): ContentTypeConfig {
	const site = resolveSiteConfig(env);
	if (typeId === undefined) {
		return getSoleContentType(site);
	}
	return getContentType(site, typeId);
}
