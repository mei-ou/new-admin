import { z } from "zod";
import {
	type ArticlePathConfig,
	FALLBACK_ARTICLE_PATH_CONFIG,
	parseArticlePath,
	resolveArticleTypeBasePath,
} from "../../../core/security/path-policy";
import type { GitDirectoryEntry, GitProvider } from "../../../providers/git/types";
import type { ArticleListResult, ArticleSummary, RemoteArticle } from "../../../types/article";
import type { FrontmatterCodec } from "../article-schema";
import {
	readFrontmatterBoolean,
	readFrontmatterDate,
	readFrontmatterNullableText,
	readFrontmatterText,
	readFrontmatterTextArray,
	requireFrontmatterDate,
} from "../frontmatter-readers";
import { readArticle } from "./read-article";

export const ARTICLE_LIST_MAX_SCAN = 100;
export const ARTICLE_LIST_READ_CONCURRENCY = 5;
export const ARTICLE_LIST_DEFAULT_PAGE_SIZE = 20;
export const ARTICLE_LIST_MAX_PAGE_SIZE = 50;

/**
 * 扁平策略下的目录遍历上限。
 *
 * 仓库内容是不可信外部输入。没有上限时，一棵深层嵌套目录树就能把一次列表请求放大成
 * 上千次 GitHub API 调用（进而撞上 Worker CPU 与上游限流），所以深度与访问节点数都要封顶。
 * 超限不抛错，而是把结果标记为 `truncated`，让调用方知道拿到的是子集而非全部。
 */
export const ARTICLE_LIST_MAX_DIRECTORY_DEPTH = 4;
export const ARTICLE_LIST_MAX_DIRECTORY_NODES = 500;

const articleListQuerySchema = z
	.object({
		page: z.coerce.number().int().min(1).max(10_000).default(1),
		pageSize: z.coerce
			.number()
			.int()
			.min(1)
			.max(ARTICLE_LIST_MAX_PAGE_SIZE)
			.default(ARTICLE_LIST_DEFAULT_PAGE_SIZE),
		query: z.string().trim().max(100).default(""),
		/**
		 * 内容类型标识。省略时由处理器回退到站点的唯一类型（单类型站点保持既有行为）。
		 * 这里只做形状约束——「是不是本站点登记的类型」由 `getContentType` 判定为 400，
		 * 两处各管一段，避免在列表层再维护一份类型清单。
		 */
		typeId: z.string().min(1).max(64).optional(),
	})
	.strict();

export interface ArticleListQuery {
	page?: unknown;
	pageSize?: unknown;
	query?: unknown;
	typeId?: unknown;
}

export type ValidatedArticleListQuery = z.infer<typeof articleListQuerySchema>;

/** 供 API 在限流和 Provider 初始化前复用同一份查询边界，避免校验顺序发生漂移。 */
export function parseArticleListQuery(input: ArticleListQuery): ValidatedArticleListQuery {
	return articleListQuerySchema.parse(input);
}

export interface ListArticlesDependencies {
	gitProvider: Pick<GitProvider, "listDirectory" | "getFile">;
	pathConfig?: ArticlePathConfig;
	/** 当前内容类型的 Front-matter codec，由调用方从运行时配置注入，并向下传给 `readArticle`。 */
	codec: FrontmatterCodec;
	maxScan?: number;
	readConcurrency?: number;
	/** 扁平策略的目录遍历深度上限，默认 `ARTICLE_LIST_MAX_DIRECTORY_DEPTH`。 */
	maxDirectoryDepth?: number;
	/** 扁平策略的目录访问节点上限，默认 `ARTICLE_LIST_MAX_DIRECTORY_NODES`。 */
	maxDirectoryNodes?: number;
}

function parseBoundedInteger(value: number | undefined, fallback: number, maximum: number): number {
	const candidate = value ?? fallback;
	if (!Number.isInteger(candidate) || candidate < 1 || candidate > maximum) {
		throw new TypeError("文章列表服务配置无效。");
	}
	return candidate;
}

function toSummary(article: RemoteArticle): ArticleSummary {
	const updated = readFrontmatterDate(article.frontmatter, "updated");
	return {
		storageSlug: article.storageSlug,
		...(article.slug === undefined ? {} : { slug: article.slug }),
		title: readFrontmatterText(article.frontmatter, "title"),
		// 发布日期是列表排序依据，读不到说明数据异常，直接抛错而不是让 Invalid Date 传播。
		published: requireFrontmatterDate(article.frontmatter, "published"),
		...(updated === undefined ? {} : { updated }),
		// 读不到 draft 时按「草稿」处理：宁可保守，也不要误标为已发布。
		draft: readFrontmatterBoolean(article.frontmatter, "draft", true),
		description: readFrontmatterText(article.frontmatter, "description"),
		tags: readFrontmatterTextArray(article.frontmatter, "tags"),
		category: readFrontmatterNullableText(article.frontmatter, "category"),
		pinned: readFrontmatterBoolean(article.frontmatter, "pinned", false),
	};
}

function compareArticleSummaries(left: ArticleSummary, right: ArticleSummary): number {
	if (left.pinned !== right.pinned) {
		return left.pinned ? -1 : 1;
	}
	const dateDifference = right.published.getTime() - left.published.getTime();
	return dateDifference !== 0 ? dateDifference : left.storageSlug.localeCompare(right.storageSlug);
}

function matchesQuery(article: ArticleSummary, normalizedQuery: string): boolean {
	if (normalizedQuery.length === 0) {
		return true;
	}
	const searchableValues = [
		article.storageSlug,
		article.slug ?? "",
		article.title,
		article.description,
		article.category ?? "",
		...article.tags,
	];
	return searchableValues.some((value) =>
		value.normalize("NFKC").toLocaleLowerCase().includes(normalizedQuery),
	);
}

/**
 * 收集 Page Bundle 形态下的候选存储标识。
 *
 * 只接受「路径与名称一致」的目录条目，再用 `parseArticlePath` 反解出标识——反解会逐段执行
 * 当前站点的文件名策略校验，因此大小写、百分号编码、Windows 保留名等异常目录名会被自然
 * 排除，不需要在这里再维护一份平行校验。
 */
function collectPageBundleCandidates(
	entries: readonly GitDirectoryEntry[],
	base: string,
	config: ArticlePathConfig,
): string[] {
	const candidates: string[] = [];
	for (const entry of entries) {
		if (entry.type !== "directory" || entry.path !== `${base}/${entry.name}`) {
			continue;
		}
		try {
			candidates.push(parseArticlePath(`${entry.path}/${config.entryFilename}`, config).storageId);
		} catch {
			// 名称不满足当前站点文件名策略 → 不作为候选，也不向调用方暴露具体文件名。
		}
	}
	return candidates;
}

interface FlatTraversalResult {
	storageIds: string[];
	truncated: boolean;
}

/**
 * 递归收集扁平策略下的文章文件。
 *
 * 只有根目录列举失败才向上抛出（此时无法建立可信候选集合）；更深层的单目录失败只跳过，
 * 因为仓库是持续变化的，某个子目录消失不应让整个列表请求失败。
 */
async function collectFlatCandidates(
	gitProvider: Pick<GitProvider, "listDirectory">,
	base: string,
	config: ArticlePathConfig,
	limits: { maxDepth: number; maxNodes: number },
): Promise<FlatTraversalResult> {
	const storageIds = new Set<string>();
	const pending: Array<{ path: string; depth: number }> = [{ path: base, depth: 0 }];
	let visitedNodes = 0;
	let truncated = false;

	while (pending.length > 0) {
		const current = pending.shift();
		if (current === undefined) {
			break;
		}

		let entries: readonly GitDirectoryEntry[];
		try {
			entries = await gitProvider.listDirectory(current.path);
		} catch (error) {
			if (current.path === base) {
				throw error;
			}
			continue;
		}

		for (const entry of entries) {
			visitedNodes += 1;
			if (visitedNodes > limits.maxNodes) {
				truncated = true;
				break;
			}
			if (entry.path !== `${current.path}/${entry.name}`) {
				continue;
			}
			if (entry.type === "directory") {
				if (current.depth + 1 > limits.maxDepth) {
					truncated = true;
					continue;
				}
				pending.push({ path: entry.path, depth: current.depth + 1 });
				continue;
			}
			if (entry.type !== "file") {
				continue;
			}
			try {
				// 反解同时完成扩展名白名单、文件名策略与分类子目录开关三件事：
				// 非 `.md`、图片、`_frontmatter.json` 之类都会在这里被排除。
				storageIds.add(parseArticlePath(entry.path, config).storageId);
			} catch {
				// 不符合当前站点路径规则的条目直接跳过。
			}
		}

		if (truncated) {
			break;
		}
	}

	return { storageIds: [...storageIds], truncated };
}

/**
 * 以固定数量和固定并发读取文章摘要。扫描上限在读取任何文章文件前截断，因此一次列表
 * 请求不会随仓库规模无限放大；单篇缺失或格式损坏只计入 skipped，不让整个列表失败。
 * 根目录列表失败仍会直接抛出，因为此时无法建立可信候选集合。
 *
 * 扫描形态完全由 `pathConfig` 决定：Page Bundle 只列类型目录的一级子目录，扁平策略递归
 * 收集 `.md` 文件（深度与节点数有上限）。两种形态共用同一套 `parseArticlePath` 反解，
 * 因此候选集合与实际写入路径永远同源。
 */
export async function listArticles(
	queryInput: ArticleListQuery,
	dependencies: ListArticlesDependencies,
): Promise<ArticleListResult> {
	const query = parseArticleListQuery(queryInput);
	const pathConfig = dependencies.pathConfig ?? FALLBACK_ARTICLE_PATH_CONFIG;
	const maxScan = parseBoundedInteger(
		dependencies.maxScan,
		ARTICLE_LIST_MAX_SCAN,
		ARTICLE_LIST_MAX_SCAN,
	);
	const readConcurrency = parseBoundedInteger(
		dependencies.readConcurrency,
		ARTICLE_LIST_READ_CONCURRENCY,
		ARTICLE_LIST_READ_CONCURRENCY,
	);
	const maxDirectoryDepth = parseBoundedInteger(
		dependencies.maxDirectoryDepth,
		ARTICLE_LIST_MAX_DIRECTORY_DEPTH,
		ARTICLE_LIST_MAX_DIRECTORY_DEPTH,
	);
	const maxDirectoryNodes = parseBoundedInteger(
		dependencies.maxDirectoryNodes,
		ARTICLE_LIST_MAX_DIRECTORY_NODES,
		ARTICLE_LIST_MAX_DIRECTORY_NODES,
	);

	// 扫描起点由路径策略给出，调用方不需要（也不应该）自己拼内容根或类型目录。
	const typeBase = resolveArticleTypeBasePath(pathConfig);
	let candidates: string[];
	let traversalTruncated = false;
	if (pathConfig.usePageBundle) {
		const entries = await dependencies.gitProvider.listDirectory(typeBase);
		candidates = collectPageBundleCandidates(entries, typeBase, pathConfig);
	} else {
		const collected = await collectFlatCandidates(dependencies.gitProvider, typeBase, pathConfig, {
			maxDepth: maxDirectoryDepth,
			maxNodes: maxDirectoryNodes,
		});
		candidates = collected.storageIds;
		traversalTruncated = collected.truncated;
	}
	candidates.sort((left, right) => left.localeCompare(right));
	const selected = candidates.slice(0, maxScan);
	const summaries: ArticleSummary[] = [];
	let skipped = 0;
	let nextIndex = 0;

	const worker = async () => {
		while (nextIndex < selected.length) {
			const currentIndex = nextIndex;
			nextIndex += 1;
			const storageSlug = selected[currentIndex];
			if (storageSlug === undefined) {
				continue;
			}
			try {
				const article = await readArticle(storageSlug, {
					gitProvider: dependencies.gitProvider,
					pathConfig,
					codec: dependencies.codec,
				});
				summaries.push(toSummary(article));
			} catch {
				// 候选目录来自不可信远端仓库；列表只记录跳过数量，不暴露文件名和解析细节。
				skipped += 1;
			}
		}
	};
	await Promise.all(Array.from({ length: Math.min(readConcurrency, selected.length) }, worker));

	const normalizedQuery = query.query.normalize("NFKC").toLocaleLowerCase();
	const filtered = summaries.filter((article) => matchesQuery(article, normalizedQuery));
	filtered.sort(compareArticleSummaries);
	const total = filtered.length;
	const totalPages = total === 0 ? 0 : Math.ceil(total / query.pageSize);
	const start = (query.page - 1) * query.pageSize;

	return {
		items: filtered.slice(start, start + query.pageSize),
		page: query.page,
		pageSize: query.pageSize,
		total,
		totalPages,
		candidateCount: candidates.length,
		scanned: selected.length,
		skipped,
		truncated: traversalTruncated || candidates.length > selected.length,
	};
}
