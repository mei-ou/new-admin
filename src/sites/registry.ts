import { ApiError } from "../core/http/errors";
import { fireflySite } from "./firefly";
import { newfireflySite } from "./newfirefly";
import { assertValidSiteConfig } from "./schema";
import type { ContentTypeConfig, SiteConfig } from "./types";

/**
 * 站点注册表。
 *
 * 新增一套部署 = 在这里登记一个站点 + 在部署环境变量里设 `SITE_ID`。核心逻辑不感知站点。
 */

const SITE_REGISTRY: ReadonlyMap<string, SiteConfig> = new Map([
	[fireflySite.id, fireflySite],
	[newfireflySite.id, newfireflySite],
]);

/** 站点配置是静态模块，结构校验是纯计算；按站点缓存一次即可，不必每个请求重跑。 */
const validatedSiteIds = new Set<string>();

function configurationError(): ApiError {
	// 不暴露究竟是 SITE_ID 缺失、拼写错误还是站点未登记，避免远端调用者探测部署细节。
	return new ApiError(503, "CONFIGURATION_ERROR", "站点配置尚未正确设置。");
}

/**
 * 读取并规范化 `SITE_ID`。
 *
 * 只做 NFKC 与去空白后的相等性检查，不自动修复：`" firefly"` 这类输入应当直接失败，
 * 否则浏览器/运维看到的配置值与实际生效值会不一致。
 */
function readSiteId(env: unknown): string {
	if (typeof env !== "object" || env === null) {
		throw configurationError();
	}
	const raw = (env as { SITE_ID?: unknown }).SITE_ID;
	if (typeof raw !== "string" || raw.length === 0) {
		throw configurationError();
	}
	if (raw !== raw.normalize("NFKC") || raw !== raw.trim()) {
		throw configurationError();
	}
	return raw;
}

/**
 * 按 `SITE_ID` 解析站点配置，并校验其运行时不变式。
 *
 * **`SITE_ID` 必填且不设默认值**：如果缺失时默认成某个站点，漏配的部署会静默套用错误站点的
 * 路径策略，把文章写到错误位置——而且是无声发生的。宁可返回 503。
 *
 * 校验刻意保持惰性（只在文章模块真正初始化时触发），与 `loadGitHubConfig` 一致：
 * 页面只读请求不应因为文章配置有问题而整体下线。
 */
export function resolveSiteConfig(env: unknown): SiteConfig {
	const siteId = readSiteId(env);
	const site = SITE_REGISTRY.get(siteId);
	if (site === undefined) {
		throw configurationError();
	}
	if (!validatedSiteIds.has(siteId)) {
		assertValidSiteConfig(site);
		validatedSiteIds.add(siteId);
	}
	return site;
}

/** 取指定内容类型。未知类型失败关闭，不回退到第一个类型。 */
export function getContentType(site: SiteConfig, typeIdInput: unknown): ContentTypeConfig {
	if (typeof typeIdInput !== "string" || typeIdInput.length === 0) {
		throw new ApiError(400, "INVALID_REQUEST", "内容类型无效。");
	}
	const contentType = site.types.find((type) => type.id === typeIdInput);
	if (contentType === undefined) {
		throw new ApiError(400, "INVALID_REQUEST", "内容类型无效。");
	}
	return contentType;
}

/**
 * 站点只有单类型时返回它。
 *
 * 供尚未引入类型维度的接口保持兼容——单类型站点（如 Firefly）的行为必须与迁移前完全一致。
 */
export function getSoleContentType(site: SiteConfig): ContentTypeConfig {
	const [first, ...rest] = site.types;
	if (first === undefined || rest.length > 0) {
		throw configurationError();
	}
	return first;
}

/** 站点是否只有一个内容类型。编辑器据此隐藏类型选择器，保持单类型站点界面不变。 */
export function hasSingleContentType(site: SiteConfig): boolean {
	return site.types.length === 1;
}
