import type { z } from "zod";
import {
	type ArticlePathConfig,
	type ArticlePathStrategy,
	DEFAULT_ENTRY_FILENAME,
} from "../core/security/path-policy";
import type { StorageIdPolicy } from "../utils/slug-utils";

/**
 * 站点内容模型的类型定义。
 *
 * 设计要点：站点配置是「数据驱动的代码」——每个博客仓库一份模块，声明自己的内容类型、
 * 路径形态与字段。核心逻辑（路径策略、校验、提交）完全不知道具体站点的存在，只消费这里
 * 的类型。这样两套部署跑同一份代码，差异全部收敛到 `src/sites/<site>.ts`。
 */

export type { ArticlePathStrategy };

/** 文件名策略。与 slug 工具层的 `StorageIdPolicy` 同义，此处用更贴近站点配置的命名。 */
export type FilenamePolicy = StorageIdPolicy;

/**
 * 字段控件类型。只决定编辑器渲染什么控件，**不决定校验强度**——校验始终由
 * `FieldDefinition.validation` 独立提供。因此即使控件降级为 `json`，服务端校验也不会放宽。
 */
export type FieldKind =
	| "text"
	| "textarea"
	| "number"
	| "boolean"
	| "date"
	| "datetime"
	| "select"
	| "tags"
	| "url"
	| "image"
	/** `string | string[]`：Astro 内容集合里常见的「单个或多个」字段。 */
	| "stringOrArray"
	/** 数组套对象，例如 `life.meals` 的 `{ name, value }[]`。 */
	| "arrayOfObject"
	/** 复杂结构的保真降级：判别联合、跨字段约束等无法用简单控件表达的字段。 */
	| "json";

export interface SelectOption {
	readonly value: string;
	readonly label: string;
}

export interface FieldDefinition {
	/** Front-matter 键名。同一内容类型内必须唯一。 */
	readonly key: string;
	readonly label: string;
	readonly kind: FieldKind;
	/** 分组标题。非空时编辑器按组折叠显示，长字段集（如 tsh520 的 `life`）必需。 */
	readonly group?: string;
	readonly help?: string;
	/** `select` 的候选项。 */
	readonly options?: readonly SelectOption[];
	/** `arrayOfObject` 的子字段定义。 */
	readonly itemFields?: readonly FieldDefinition[];
	/**
	 * 服务端权威校验。默认值也由它承载（`.default(...)`），表单初始值通过
	 * `resolveFieldDefault` 从同一处派生，避免默认值出现两份而漂移。
	 */
	readonly validation: z.ZodTypeAny;
}

export interface ContentTypeConfig {
	/** 内容类型标识，如 `posts` / `moments`。同一站点内必须唯一。 */
	readonly id: string;
	readonly label: string;
	/**
	 * 相对 `contentRoot` 的类型子目录，可含 `/`（如 tsh520 的 `life/notebooks`）。
	 * 空字符串表示文章直接位于 `contentRoot` 下。
	 */
	readonly directory: string;
	readonly pathStrategy: ArticlePathStrategy;
	readonly filenamePolicy: FilenamePolicy;
	/** `flat` 策略下是否允许 `storageId` 携带分类子目录段。`pageBundle` 下必须为 false。 */
	readonly allowCategoryPath: boolean;
	readonly preserveUnknownFrontmatter?: boolean;
	readonly fields: readonly FieldDefinition[];
	/**
	 * 跨字段校验（如 tsh520 `schedules` 的「农历必须有 lunarMonth/lunarDay」）。
	 * 单字段校验表达不了的约束放在这里，由服务端在字段校验之后执行。
	 */
	readonly refine?: (data: Record<string, unknown>, ctx: z.RefinementCtx) => void;
}

export interface SiteConfig {
	/** 站点标识，由 `SITE_ID` 环境变量选定。 */
	readonly id: string;
	readonly label: string;
	/** `GITHUB_CONTENT_ROOT` 缺失时的兜底内容根。环境变量始终优先。 */
	readonly contentRoot: string;
	readonly types: readonly ContentTypeConfig[];
}

/**
 * 把站点内容类型落成路径策略配置。
 *
 * `contentRoot` 由调用方传入而不是从站点配置读：部署环境变量（`GITHUB_CONTENT_ROOT`）
 * 始终优先于站点默认值，这样换仓库不必改代码。
 */
export function toArticlePathConfig(
	contentType: ContentTypeConfig,
	contentRoot: string,
): ArticlePathConfig {
	return {
		contentRoot,
		usePageBundle: contentType.pathStrategy === "pageBundle",
		entryFilename: DEFAULT_ENTRY_FILENAME,
		typeDirectory: contentType.directory,
		// 扩展名白名单只允许 `.md`（见 path-policy），因此这里无需再开一个配置口子。
		extension: ".md",
		filenamePolicy: contentType.filenamePolicy,
		allowCategoryPath: contentType.allowCategoryPath,
	};
}

/**
 * 表单里字段未填写时的兜底空值。
 *
 * 只在 `validation` 未声明默认值、且解析 `undefined` 失败时使用，保证表单不会出现
 * `undefined`——否则 Svelte 的 `bind:value` 会在受控与非受控之间反复切换。
 */
export function emptyValueForKind(kind: FieldKind): string | boolean | readonly unknown[] {
	switch (kind) {
		case "boolean":
			return false;
		case "tags":
		case "stringOrArray":
		case "arrayOfObject":
			return [];
		default:
			// number / date / datetime / json / 文本类在表单里统一以字符串承载，提交时再转换。
			return "";
	}
}

/**
 * 从字段的 Zod schema 派生表单初始值。
 *
 * 优先使用 schema 自己的默认值（`z.boolean().default(false)` 等），这样「schema 里的默认值」
 * 与「新建文章时的初始值」永远同源。schema 无默认值且不接受 `undefined` 时退回空值。
 */
export function resolveFieldDefault(field: FieldDefinition): unknown {
	const parsed = field.validation.safeParse(undefined);
	if (parsed.success && parsed.data !== undefined) {
		return parsed.data;
	}
	return emptyValueForKind(field.kind);
}

/** 字段键集合。供 `frontmatter-utils` 拆分已知/未知字段使用。 */
export function getFieldKeys(contentType: ContentTypeConfig): ReadonlySet<string> {
	return new Set(contentType.fields.map((field) => field.key));
}
