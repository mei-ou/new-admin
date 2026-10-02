import { requireAdminCapability } from "../../../core/config/capabilities";
import { guardModule } from "../../../core/config/feature-flags";
import { ApiError } from "../../../core/http/errors";
import { jsonResponse } from "../../../core/http/response";
import { enforceRateLimit } from "../../../core/security/rate-limit";
import {
	createGitHubRepositoryFactory,
	type GitHubProviderFactoryOptions,
} from "../../../providers/git/github-factory";
import { initializeProvider } from "../../../providers/registry";
import { toArticlePathConfig } from "../../../sites";
import type { AuthenticatedPrincipal, RuntimeEnv } from "../../../types/env";
import type { ProviderFactory } from "../../../types/provider";
import { parseStorageId } from "../../../utils/slug-utils";
import { createFrontmatterCodec, resolveArticleContentType } from "../article-schema";
import { readArticle } from "../services/read-article";

export interface ArticleDetailRequestContext {
	slug: unknown;
	/** 请求选定的内容类型标识；省略时回退到站点唯一类型。 */
	typeId?: unknown;
	principal: AuthenticatedPrincipal | undefined;
	env: RuntimeEnv;
}

export interface ArticleRepository {
	config: {
		contentRoot: string;
		entryFilename: string;
		usePageBundle: boolean;
	};
	provider: Parameters<typeof readArticle>[1]["gitProvider"];
}

function resolveAssetDetailsCapability(env: RuntimeEnv): boolean {
	try {
		requireAdminCapability(env, "articleAssetDetails");
		return true;
	} catch (error) {
		if (error instanceof ApiError && error.status === 404 && error.code === "NOT_FOUND")
			return false;
		throw error;
	}
}

export interface ArticleDetailHandlerDependencies {
	fetch?: typeof fetch;
	createRepositoryFactory?: (
		options: GitHubProviderFactoryOptions,
	) => ProviderFactory<ArticleRepository>;
}

/**
 * 文章详情 API 的可测试编排层。Middleware 负责验证 Access JWT，这里仍检查 principal，
 * 防止未来路由复用或测试环境绕过 Middleware 后以匿名身份访问 GitHub 内容。
 */
export async function handleGetArticleDetail(
	context: ArticleDetailRequestContext,
	dependencies: ArticleDetailHandlerDependencies = {},
): Promise<Response> {
	guardModule("articles");
	if (!context.principal) {
		throw new ApiError(401, "AUTH_REQUIRED", "需要登录后才能访问。");
	}
	// 内容类型先于 Provider 解析：只依赖部署环境，不需要任何 Secret。
	const contentType = resolveArticleContentType(context.env, context.typeId);
	// 动态路由参数属于不可信输入，先校验后再消耗限流额度或读取任何 Secret。
	// 这里只做「形状 + 文件名策略」校验（不含内容根）；与路径相关的校验（扩展名白名单、
	// 分类子目录开关）由服务层用同一份路径策略执行，避免两处各写一套规则。
	const storageId = parseStorageId(context.slug, contentType.filenamePolicy);

	// 详情会额外列出资源并执行引用分析，使用独立只读额度避免挤占普通文章列表读取。
	const includeAssetDetails = resolveAssetDetailsCapability(context.env);
	await enforceRateLimit(
		context.env.RATE_LIMITER,
		context.principal.sub,
		includeAssetDetails ? "article-assets-read" : "articles-read",
	);

	const factoryOptions: GitHubProviderFactoryOptions = {
		readEnv: () => context.env,
	};
	if (dependencies.fetch !== undefined) {
		factoryOptions.fetch = dependencies.fetch;
	}
	const createRepositoryFactory =
		dependencies.createRepositoryFactory ?? createGitHubRepositoryFactory;
	const repository = initializeProvider("articles", createRepositoryFactory(factoryOptions));
	if (!repository) {
		// 正常配置下 guardModule 已保证不会到达这里，保留失败关闭作为纵深防御。
		throw new ApiError(404, "NOT_FOUND", "资源不存在。");
	}

	const article = await readArticle(storageId, {
		gitProvider: repository.provider,
		// 路径策略与 codec 都由请求选定的内容类型派生，而不是部署级配置。
		pathConfig: toArticlePathConfig(contentType, repository.config.contentRoot),
		codec: createFrontmatterCodec(contentType),
		requireHeadSnapshot: true,
		includeAssetDetails,
	});
	return jsonResponse({ article });
}
