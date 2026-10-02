import type { ArticleAssetSummary } from "../modules/media/article-asset";
import type { ArticleAssetReferenceAnalysisSummary } from "../modules/media/services/summarize-article-assets";

export type ArticleFormat = "md";

/**
 * 文章 Front-matter：按内容类型驱动的记录类型。
 *
 * **字段清单的唯一来源是站点配置**（`src/sites/<site>.ts`），所以这里刻意不再声明
 * Firefly 的 17 个具名字段——那个接口每加一个内容类型就是错的，而本文件本该站点无关。
 *
 * 代价是「字段一定存在、类型一定正确」不再由类型系统保证。需要具名值的地方一律走
 * `src/modules/articles/frontmatter-readers.ts` 的读取辅助：它们在读取时收窄类型，
 * 把「缺失 / 类型不符」当作不可信输入处理。**不要在这里用 `as` 把值断言成具体类型**——
 * Front-matter 来自仓库，属于外部数据。
 *
 * 值域刻意留成 `unknown` 而不是收窄成标量联合：站点配置允许 `arrayOfObject` 与 `json`
 * 降级字段（如 tsh520 的 `life.meals` / `ziyuan`），任何标量联合都覆盖不全，
 * 收窄只会制造「类型说安全、运行时不是」的假象。
 */
export type ArticleFrontmatter = Readonly<Record<string, unknown>>;

/**
 * 编辑器提交到业务层的文章数据。slug 与 Frontmatter 分离，以便服务端独立执行
 * URL、冲突和路径策略；客户端不能通过该结构指定仓库文件路径。
 */
export interface ArticleEditorInput {
	frontmatter: ArticleFrontmatter;
	slug?: string;
	format: ArticleFormat;
	markdown: string;
}

/**
 * 从远端仓库打开并交给编辑器的数据。`storageSlug` 是服务端路径别名，`slug` 是文章
 * Frontmatter 可选声明；二者不能混为同一个值，否则自定义 URL 会破坏文件定位。
 */
export type RemoteArticleResource = ArticleAssetSummary;

export interface RemoteArticle extends ArticleEditorInput {
	storageSlug: string;
	pathAlias: string;
	sha: string;
	headSha?: string;
	/** 仅详情快照返回；每项都与 headSha 指向的不可变 Commit 一致。 */
	resources?: RemoteArticleResource[];
	/** 未完整识别所有本地引用时，资源不得被解释为“未引用”或低风险。 */
	resourceReferenceAnalysis?: ArticleAssetReferenceAnalysisSummary;
}

export interface ArticleSummary {
	storageSlug: string;
	slug?: string;
	title: string;
	published: Date;
	updated?: Date;
	draft: boolean;
	description: string;
	tags: string[];
	category: string | null;
	pinned: boolean;
}

export interface ArticleListResult {
	items: ArticleSummary[];
	page: number;
	pageSize: number;
	total: number;
	totalPages: number;
	candidateCount: number;
	scanned: number;
	skipped: number;
	truncated: boolean;
}

/** 写入远端仓库成功后的安全返回值，不暴露仓库根目录、分支或 Provider 原始响应。 */
export interface ArticleCommitResult {
	storageSlug: string;
	pathAlias: string;
	commitSha: string;
	commitUrl: string;
	fileSha: string;
}

/** 删除成功后不再存在文章 Blob，只返回已核对的删除路径集合和 Commit 身份。 */
export interface ArticleDeleteResult {
	storageSlug: string;
	pathAlias: string;
	commitSha: string;
	commitUrl: string;
	deletedFiles: string[];
}
