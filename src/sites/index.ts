/**
 * 站点配置层的统一出口。
 *
 * 外部只需要 `resolveSiteConfig` / `getContentType` 与几个类型；具体站点模块
 * （`firefly.ts` / `tsh520.ts`）不应被业务代码直接引用——否则「加一套部署」就会变成
 * 「改业务代码」。
 */

export { fireflyPostsType, fireflySite } from "./firefly";
export {
	getContentType,
	getSoleContentType,
	hasSingleContentType,
	resolveSiteConfig,
} from "./registry";
export { assertValidSiteConfig } from "./schema";
export type {
	ArticlePathStrategy,
	ContentTypeConfig,
	FieldDefinition,
	FieldKind,
	FilenamePolicy,
	SelectOption,
	SiteConfig,
} from "./types";
export {
	emptyValueForKind,
	getFieldKeys,
	resolveFieldDefault,
	toArticlePathConfig,
} from "./types";
