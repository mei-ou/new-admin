import { z } from "zod";
import {
	createFrontmatterCodec,
	type FrontmatterCodec,
} from "../../modules/articles/article-schema";
import { getSoleContentType, resolveSiteConfig, toArticlePathConfig } from "../../sites";
import { ApiError } from "../http/errors";
import type { ArticlePathConfig } from "../security/path-policy";

const SAFE_REPOSITORY_NAME = /^[A-Za-z0-9_.-]+$/;
const SAFE_GIT_REF = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;
const SAFE_PATH_SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function containsControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}

const repositoryNameSchema = z
	.string()
	.min(1)
	.max(100)
	.refine((value) => value === value.normalize("NFKC"))
	.refine((value) => value !== "." && value !== ".." && SAFE_REPOSITORY_NAME.test(value));

const branchSchema = z
	.string()
	.min(1)
	.max(255)
	.refine((value) => value === value.normalize("NFKC"))
	.refine((value) => !containsControlCharacter(value))
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.endsWith("/") &&
			!value.includes("..") &&
			!value.includes("//") &&
			!value.includes("@{") &&
			!value.endsWith(".lock") &&
			SAFE_GIT_REF.test(value),
	);

const contentRootSchema = z
	.string()
	.min(1)
	.max(512)
	.refine((value) => value === value.normalize("NFKC"))
	.refine(
		(value) =>
			!value.startsWith("/") &&
			!value.endsWith("/") &&
			!value.includes("\\") &&
			!value.includes("%") &&
			!value.includes(":") &&
			!containsControlCharacter(value),
	)
	.refine((value) =>
		value
			.split("/")
			.every((segment) => segment !== "." && segment !== ".." && SAFE_PATH_SEGMENT.test(segment)),
	);

const githubEnvSchema = z
	.object({
		GITHUB_OWNER: repositoryNameSchema,
		GITHUB_REPO: repositoryNameSchema,
		GITHUB_BRANCH: branchSchema,
		GITHUB_CONTENT_ROOT: contentRootSchema,
		GITHUB_TOKEN: z
			.string()
			.min(1)
			.max(4096)
			.refine((value) => !containsControlCharacter(value)),
	})
	.strip();

/**
 * GitHub 运行时配置 = 仓库身份 + 文章路径策略 + 当前内容模型。
 *
 * 显式继承 `ArticlePathConfig`（而不是依赖结构相同隐式兼容）：Provider 工厂的联合类型
 * 推断依赖「本类型是 ArticlePathConfig 的子类型」这一关系，显式继承让该关系不随字段增删
 * 而失效。
 *
 * 路径策略与 `frontmatterCodec` 都**不再硬编码**，而是由 `SITE_ID` 指向的站点配置派生：
 * 这样「换站点/换仓库」只需改部署环境变量，不必碰代码。
 */
export interface GitHubRuntimeConfig extends ArticlePathConfig {
	owner: string;
	repo: string;
	branch: string;
	token: string;
	/** 当前部署选定的内容类型标识（来自 `SITE_ID` → 站点配置）。 */
	typeId: string;
	/** 当前内容类型的 Front-matter 编解码上下文，供解析/序列化显式注入。 */
	frontmatterCodec: FrontmatterCodec;
}

/**
 * GitHub 配置不并入全局 Access 配置：页面只读请求不应因为尚未配置 GitHub 而整体
 * 下线。只有文章模块真正初始化 Git Provider 时才读取并验证这些值，缺失则失败关闭。
 *
 * 站点与内容类型的解析同样在这里发生，并且**同样失败关闭**：`SITE_ID` 缺失、拼写错误或
 * 指向未登记站点，一律 503，不设默认值——默认值会让漏配的部署静默套用错误站点的路径策略，
 * 把文章写到错误位置，而且是无声发生的。
 *
 * 当前只支持单内容类型站点（`getSoleContentType`）。多类型站点需要按请求选择类型，
 * 属「按类型浏览」的后续步骤，在此之前多类型站点会直接失败关闭而不是随便挑一个。
 */
export function loadGitHubConfig(input: unknown): GitHubRuntimeConfig {
	const result = githubEnvSchema.safeParse(input);
	if (!result.success) {
		// 不暴露究竟缺少 Token、仓库名还是分支，避免远端调用者探测部署细节。
		throw new ApiError(503, "CONFIGURATION_ERROR", "Git 服务尚未正确配置。");
	}

	const site = resolveSiteConfig(input);
	const contentType = getSoleContentType(site);
	const pathConfig = toArticlePathConfig(contentType, result.data.GITHUB_CONTENT_ROOT);

	return {
		owner: result.data.GITHUB_OWNER,
		repo: result.data.GITHUB_REPO,
		branch: result.data.GITHUB_BRANCH,
		token: result.data.GITHUB_TOKEN,
		...pathConfig,
		typeId: contentType.id,
		frontmatterCodec: createFrontmatterCodec(contentType),
	};
}
