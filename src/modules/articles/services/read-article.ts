import { ApiError } from "../../../core/http/errors";
import {
	type ArticlePathConfig,
	buildArticlePath,
	buildArticlePathAlias,
	FALLBACK_ARTICLE_PATH_CONFIG,
	parseArticlePath,
} from "../../../core/security/path-policy";
import type { GitProvider } from "../../../providers/git/types";
import type { RemoteArticle } from "../../../types/article";
import { parseMarkdownDocument } from "../../../utils/frontmatter-utils";
import { summarizeArticleAssets } from "../../media/services/summarize-article-assets";
import { fireflyFrontmatterCodec } from "../article-schema";
import { readFrontmatterText } from "../frontmatter-readers";

export interface ReadArticleDependencies {
	gitProvider: Pick<GitProvider, "getFile"> &
		Partial<Pick<GitProvider, "getFileAtCommit" | "getHead" | "listDirectoryAtCommit">>;
	pathConfig?: ArticlePathConfig;
	requireHeadSnapshot?: boolean;
	includeAssetDetails?: boolean;
}

/**
 * 从 Git Provider 读取文章，并在业务层重新建立文章数据边界。
 *
 * 输入只允许存储标识，不能接收仓库路径；Provider 返回的路径也必须与服务端计算值
 * 完全一致。即便具体 Provider 或未来测试替身出现错误，也不会把其他仓库文件当成文章。
 *
 * 标识先构造路径、再由路径反解出来，而不是单独校验：反解与构造共用同一份归一化配置，
 * 因此扁平策略下的分类子目录与 Unicode 文件名都能正确通过，也不会出现「构造得出、
 * 反解不回」的标识。
 */
export async function readArticle(
	storageSlugInput: unknown,
	dependencies: ReadArticleDependencies,
): Promise<RemoteArticle> {
	const pathConfig = dependencies.pathConfig ?? FALLBACK_ARTICLE_PATH_CONFIG;
	const path = buildArticlePath(storageSlugInput, pathConfig);
	const storageSlug = parseArticlePath(path, pathConfig).storageId;
	let headSha: string | undefined;
	let snapshotEntries: Awaited<ReturnType<GitProvider["listDirectoryAtCommit"]>> | undefined;
	let file: Awaited<ReturnType<GitProvider["getFile"]>>;
	if (dependencies.requireHeadSnapshot) {
		if (
			!dependencies.gitProvider.getHead ||
			!dependencies.gitProvider.getFileAtCommit ||
			!dependencies.gitProvider.listDirectoryAtCommit
		) {
			throw new ApiError(503, "CONFIGURATION_ERROR", "Git Provider 缺少一致性读取能力。");
		}
		const head = await dependencies.gitProvider.getHead();
		headSha = head.commitSha;
		const snapshotFile = await dependencies.gitProvider.getFileAtCommit(path, headSha);
		file = snapshotFile;
		// 只有 Page Bundle 才有「同目录资源」这一概念。扁平策略下文章是单文件，其父目录
		// 存放的是**其他文章**；若照旧列举，会把同目录的其他文章文件误当成本文资源。
		if (pathConfig.usePageBundle && dependencies.includeAssetDetails !== false) {
			const bundlePath = path.slice(0, -(pathConfig.entryFilename.length + 1));
			const entries = await dependencies.gitProvider.listDirectoryAtCommit(bundlePath, headSha);
			snapshotEntries = entries.filter((entry) => entry.name !== pathConfig.entryFilename);
		}
	} else {
		file = await dependencies.gitProvider.getFile(path);
	}

	if (file.path !== path || file.encoding !== "utf-8") {
		throw new ApiError(502, "UPSTREAM_ERROR", "Git 服务返回了无效文章文件。");
	}

	let parsed: ReturnType<typeof parseMarkdownDocument>;
	try {
		parsed = parseMarkdownDocument(fireflyFrontmatterCodec, file.content);
	} catch {
		// 仓库内容属于不可信外部数据，不能把 Zod/YAML 解析细节直接暴露给 API 调用者。
		throw new ApiError(422, "ARTICLE_INVALID", "远端文章格式无效，无法安全打开。");
	}
	const summarizedAssets =
		snapshotEntries === undefined
			? undefined
			: summarizeArticleAssets({
					storageSlug,
					frontmatterImage: readFrontmatterText(parsed.frontmatter, "image"),
					markdown: parsed.markdown,
					entries: snapshotEntries,
					pathConfig,
				});
	const { updated, ...requiredFrontmatter } = parsed.frontmatter;
	return {
		storageSlug,
		// API 可返回稳定别名供编辑器展示，但不暴露仓库根目录或允许客户端回传完整路径。
		// 别名由路径策略派生，扁平策略下是 `<storageId>.md` 而不是硬编码的 `index.md`。
		pathAlias: buildArticlePathAlias(storageSlug, pathConfig),
		sha: file.sha,
		...(headSha === undefined ? {} : { headSha }),
		...(summarizedAssets === undefined
			? {}
			: {
					resources: summarizedAssets.resources,
					resourceReferenceAnalysis: summarizedAssets.referenceAnalysis,
				}),
		// exactOptionalPropertyTypes 下，可选日期缺失时必须省略字段，不能显式返回 undefined。
		frontmatter: updated === undefined ? requiredFrontmatter : { ...requiredFrontmatter, updated },
		...(parsed.slug === undefined ? {} : { slug: parsed.slug }),
		format: "md",
		markdown: parsed.markdown,
	};
}
