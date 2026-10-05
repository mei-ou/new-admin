import { ApiError } from "../../../core/http/errors";
import {
	type ArticlePathConfig,
	buildArticlePath,
	buildArticlePathAlias,
	FALLBACK_ARTICLE_PATH_CONFIG,
	parseArticlePath,
} from "../../../core/security/path-policy";
import type { GitProvider } from "../../../providers/git/types";
import type { ArticleDeleteResult } from "../../../types/article";

const GIT_OBJECT_SHA = /^[a-f0-9]{40,64}$/;

export interface RecoverDeletedArticleDependencies {
	gitProvider: Pick<GitProvider, "getHead" | "listDirectoryAtCommit"> &
		Partial<Pick<GitProvider, "getFileAtCommit">>;
	pathConfig?: ArticlePathConfig;
}

function parseCommitSha(input: unknown): string | undefined {
	return typeof input === "string" && GIT_OBJECT_SHA.test(input) ? input : undefined;
}

/**
 * 删除恢复只执行不可变快照读取：候选 Commit 必须是当前 HEAD，且目标 Page Bundle 在候选
 * Commit 中必须完整不存在。删除清单从原始基线 Commit 重建，避免信任浏览器回传路径。
 */
export async function recoverDeletedArticle(
	storageSlugInput: unknown,
	baseHeadShaInput: unknown,
	candidateCommitShaInput: unknown,
	dependencies: RecoverDeletedArticleDependencies,
): Promise<ArticleDeleteResult | undefined> {
	const pathConfig = dependencies.pathConfig ?? FALLBACK_ARTICLE_PATH_CONFIG;
	const articlePath = buildArticlePath(storageSlugInput, pathConfig);
	const storageSlug = parseArticlePath(articlePath, pathConfig).storageId;
	const baseHeadSha = parseCommitSha(baseHeadShaInput);
	const candidateCommitSha = parseCommitSha(candidateCommitShaInput);
	if (!baseHeadSha || !candidateCommitSha) return undefined;

	const head = await dependencies.gitProvider.getHead();
	if (head.commitSha !== candidateCommitSha || !head.commitUrl) return undefined;
	if (!pathConfig.usePageBundle) {
		const getFile = dependencies.gitProvider.getFileAtCommit;
		if (!getFile)
			throw new ApiError(503, "CONFIGURATION_ERROR", "Git Provider 缺少单文件删除恢复能力。");
		const original = await getFile.call(dependencies.gitProvider, articlePath, baseHeadSha);
		if (original.path !== articlePath) return undefined;
		try {
			await getFile.call(dependencies.gitProvider, articlePath, candidateCommitSha);
			return undefined;
		} catch (error) {
			if (!(error instanceof ApiError) || error.status !== 404 || error.code !== "NOT_FOUND")
				throw error;
		}
		const pathAlias = buildArticlePathAlias(storageSlug, pathConfig);
		return {
			storageSlug,
			pathAlias,
			commitSha: head.commitSha,
			commitUrl: head.commitUrl,
			deletedFiles: [pathAlias],
		};
	}
	const bundlePath = articlePath.slice(0, articlePath.lastIndexOf("/"));
	const originalEntries = await dependencies.gitProvider.listDirectoryAtCommit(
		bundlePath,
		baseHeadSha,
	);
	try {
		await dependencies.gitProvider.listDirectoryAtCommit(bundlePath, candidateCommitSha);
		return undefined;
	} catch (error) {
		if (!(error instanceof ApiError) || error.status !== 404 || error.code !== "NOT_FOUND") {
			throw error;
		}
	}

	const bundlePrefix = `${bundlePath}/`;
	if (
		originalEntries.length === 0 ||
		!originalEntries.some((entry) => entry.path === articlePath) ||
		originalEntries.some((entry) => !entry.path.startsWith(bundlePrefix))
	) {
		return undefined;
	}
	return {
		storageSlug,
		pathAlias: `${storageSlug}/index.md`,
		commitSha: head.commitSha,
		commitUrl: head.commitUrl,
		deletedFiles: originalEntries.map(
			(entry) => `${storageSlug}/${entry.path.slice(bundlePrefix.length)}`,
		),
	};
}
