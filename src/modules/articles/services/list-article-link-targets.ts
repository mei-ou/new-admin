import { slug as slugify } from "github-slugger";
import { z } from "zod";
import { buildExpectedArticleUrl } from "../../../core/config/article-url";
import type { ArticlePathConfig } from "../../../core/security/path-policy";
import type { GitProvider } from "../../../providers/git/types";
import { parseSlug, parseStorageId } from "../../../utils/slug-utils";
import type { FrontmatterCodec } from "../article-schema";
import {
	readFrontmatterNullableText,
	readFrontmatterText,
	readFrontmatterTextArray,
} from "../frontmatter-readers";
import { type ArticleHeadingTarget, extractArticleHeadings } from "./extract-article-headings";
import {
	ARTICLE_LIST_MAX_PAGE_SIZE,
	ARTICLE_LIST_MAX_SCAN,
	ARTICLE_LIST_READ_CONCURRENCY,
	listArticles,
} from "./list-articles";
import { readArticle } from "./read-article";

export interface ArticleLinkTarget {
	storageSlug: string;
	slug: string;
	title: string;
	href: string;
	description: string;
	category: string | null;
	tags: string[];
	headings: ArticleHeadingTarget[];
}

const linkTargetQuerySchema = z.object({ query: z.string().trim().max(100).default("") }).strict();

export interface ListArticleLinkTargetsDependencies {
	gitProvider: Pick<GitProvider, "listDirectory" | "getFile">;
	pathConfig: ArticlePathConfig;
	/** 当前内容类型的 Front-matter codec，由调用方从运行时配置注入。 */
	codec: FrontmatterCodec;
	articleUrlTemplate?: string;
}

function buildArticleHref(template: string | undefined, slug: string): string {
	const expectedUrl = buildExpectedArticleUrl(template, slug);
	if (!expectedUrl) return `/posts/${slug.split("/").map(encodeURIComponent).join("/")}/`;
	const url = new URL(expectedUrl);
	return `${url.pathname}${url.search}`;
}

async function mapWithConcurrency<TInput, TOutput>(
	items: readonly TInput[],
	concurrency: number,
	mapper: (item: TInput) => Promise<TOutput>,
): Promise<TOutput[]> {
	const results = new Array<TOutput>(items.length);
	let nextIndex = 0;
	const worker = async () => {
		while (nextIndex < items.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			const item = items[currentIndex];
			if (item === undefined) continue;
			results[currentIndex] = await mapper(item);
		}
	};
	await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
	return results;
}

/**
 * 链接选择器复用受限文章扫描，不新增无上限的仓库放大器。返回 `truncated` 时前端明确
 * 提示搜索范围受限；后续文章索引可替换数据源而保持 API 响应结构稳定。
 */
export async function listArticleLinkTargets(
	queryInput: unknown,
	dependencies: ListArticleLinkTargetsDependencies,
): Promise<{ items: ArticleLinkTarget[]; truncated: boolean }> {
	const query = linkTargetQuerySchema.parse(queryInput);
	const articles = await listArticles(
		{ page: 1, pageSize: ARTICLE_LIST_MAX_PAGE_SIZE, query: query.query },
		{
			gitProvider: dependencies.gitProvider,
			pathConfig: dependencies.pathConfig,
			codec: dependencies.codec,
			maxScan: ARTICLE_LIST_MAX_SCAN,
		},
	);
	const items = (
		await mapWithConcurrency(
			articles.items,
			ARTICLE_LIST_READ_CONCURRENCY,
			async (summary): Promise<ArticleLinkTarget | null> => {
				try {
					const article = await readArticle(summary.storageSlug, {
						gitProvider: dependencies.gitProvider,
						pathConfig: dependencies.pathConfig,
						codec: dependencies.codec,
					});
					const slug =
						dependencies.pathConfig.filenamePolicy === "unicode"
							? parseStorageId(
									article.slug ??
										article.storageSlug
											.split("/")
											.map((segment) => slugify(segment))
											.join("/")
											.replace(/\/index$/, ""),
									"unicode",
								)
							: parseSlug(article.slug ?? article.storageSlug);
					return {
						storageSlug: article.storageSlug,
						slug,
						title: readFrontmatterText(article.frontmatter, "title"),
						href: buildArticleHref(dependencies.articleUrlTemplate, slug),
						description: readFrontmatterText(article.frontmatter, "description"),
						category: readFrontmatterNullableText(article.frontmatter, "category"),
						tags: readFrontmatterTextArray(article.frontmatter, "tags"),
						headings: extractArticleHeadings(article.markdown),
					};
				} catch {
					// 仓库可能在列表和详情读取之间变化；单篇失效不应拖垮整个链接选择器。
					return null;
				}
			},
		)
	).filter((item): item is ArticleLinkTarget => item !== null);
	return { items, truncated: articles.truncated };
}
