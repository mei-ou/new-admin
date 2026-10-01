import { z } from "zod";
import { ApiError } from "../core/http/errors";
import { parseContentRoot, parseTypeDirectory } from "../core/security/path-policy";
import type { SiteConfig } from "./types";

/**
 * 站点配置自身的结构校验。
 *
 * 站点配置是仓库里的 TypeScript 模块，类型系统已经挡住大部分错误；这里补的是**类型系统
 * 表达不了的运行时不变式**——字段键重复、`select` 缺少候选项、`pageBundle` 误开分类目录等。
 * 这些问题如果不在启动时暴露，就会在真正写入仓库时才以「文章跑到错误位置」的形式出现。
 *
 * 失败一律抛 503，与 `loadGitHubConfig` 的失败关闭策略保持一致。
 */

const SITE_ID_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const FIELD_KEY_PATTERN = /^[A-Za-z_][A-Za-z0-9_-]*$/;

/** `slug` 由 Front-matter 的公开地址语义占用，不能再作为普通字段。 */
const RESERVED_FIELD_KEYS = new Set(["slug"]);

const FIELD_KINDS = [
	"text",
	"textarea",
	"number",
	"boolean",
	"date",
	"datetime",
	"select",
	"tags",
	"url",
	"image",
	"stringOrArray",
	"arrayOfObject",
	"json",
] as const;

const PATH_STRATEGIES = ["pageBundle", "flat"] as const;
const FILENAME_POLICIES = ["ascii-slug", "unicode"] as const;

/**
 * 字段在「校验视角」下的形状。
 *
 * 刻意与 `types.ts` 的 `FieldDefinition` 分开：那边是 `readonly` + 精确可选，这里要贴合
 * Zod 解析产物的形态（可选属性可能显式取 `undefined`）。两者不一致时以本文件为准，
 * 因为这里只用于校验，不参与业务类型推导。
 */
interface FieldShape {
	key: string;
	label: string;
	kind: string;
	group?: string | undefined;
	help?: string | undefined;
	options?: readonly { value: string; label: string }[] | undefined;
	itemFields?: readonly FieldShape[] | undefined;
	validation: unknown;
}

/** 校验器只要求「可解析」，不约束具体 schema 形态——字段校验器本就千差万别。 */
const zodSchemaRef = z
	.unknown()
	.refine(
		(value) =>
			typeof value === "object" &&
			value !== null &&
			typeof (value as { safeParse?: unknown }).safeParse === "function",
		{ message: "字段校验器必须是 Zod schema。" },
	);

const fieldDefinitionSchema: z.ZodType<FieldShape> = z.lazy(() =>
	z
		.object({
			key: z.string().min(1).max(100).regex(FIELD_KEY_PATTERN),
			label: z.string().min(1).max(100),
			kind: z.enum(FIELD_KINDS),
			group: z.string().min(1).max(100).optional(),
			help: z.string().max(500).optional(),
			options: z
				.array(
					z
						.object({ value: z.string().min(1).max(200), label: z.string().min(1).max(200) })
						.strict(),
				)
				.max(200)
				.optional(),
			itemFields: z.array(fieldDefinitionSchema).min(1).max(50).optional(),
			validation: zodSchemaRef,
		})
		.strict()
		.superRefine((field, ctx) => {
			if (RESERVED_FIELD_KEYS.has(field.key)) {
				ctx.addIssue({ code: "custom", message: `字段键 ${field.key} 为保留字。`, path: ["key"] });
			}

			if (field.kind === "select") {
				if (field.options === undefined || field.options.length === 0) {
					ctx.addIssue({
						code: "custom",
						message: "select 字段必须提供候选项。",
						path: ["options"],
					});
				} else if (
					new Set(field.options.map((option) => option.value)).size !== field.options.length
				) {
					ctx.addIssue({ code: "custom", message: "select 候选项取值重复。", path: ["options"] });
				}
			} else if (field.options !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: "只有 select 字段可以声明候选项。",
					path: ["options"],
				});
			}

			if (field.kind === "arrayOfObject") {
				if (field.itemFields === undefined) {
					ctx.addIssue({
						code: "custom",
						message: "arrayOfObject 字段必须提供子字段定义。",
						path: ["itemFields"],
					});
				}
			} else if (field.itemFields !== undefined) {
				ctx.addIssue({
					code: "custom",
					message: "只有 arrayOfObject 字段可以声明子字段。",
					path: ["itemFields"],
				});
			}
		}),
);

const contentTypeSchema = z
	.object({
		id: z.string().min(1).max(64).regex(SITE_ID_PATTERN),
		label: z.string().min(1).max(100),
		directory: z.string(),
		pathStrategy: z.enum(PATH_STRATEGIES),
		filenamePolicy: z.enum(FILENAME_POLICIES),
		allowCategoryPath: z.boolean(),
		fields: z.array(fieldDefinitionSchema),
		refine: z.unknown().optional(),
	})
	.strict()
	.superRefine((contentType, ctx) => {
		try {
			parseTypeDirectory(contentType.directory);
		} catch {
			ctx.addIssue({ code: "custom", message: "内容类型目录无效。", path: ["directory"] });
		}

		// Page Bundle 的目录本身就是文章单元，再叠一层分类只会让路径语义含糊。
		if (contentType.pathStrategy === "pageBundle" && contentType.allowCategoryPath) {
			ctx.addIssue({
				code: "custom",
				message: "Page Bundle 策略不支持分类子目录。",
				path: ["allowCategoryPath"],
			});
		}

		const seenKeys = new Set<string>();
		for (const field of contentType.fields) {
			if (seenKeys.has(field.key)) {
				ctx.addIssue({ code: "custom", message: `字段键重复：${field.key}。`, path: ["fields"] });
			}
			seenKeys.add(field.key);
		}

		if (contentType.refine !== undefined && typeof contentType.refine !== "function") {
			ctx.addIssue({ code: "custom", message: "跨字段校验必须是函数。", path: ["refine"] });
		}
	});

const siteConfigSchema = z
	.object({
		id: z.string().min(1).max(64).regex(SITE_ID_PATTERN),
		label: z.string().min(1).max(100),
		contentRoot: z.string(),
		types: z.array(contentTypeSchema).min(1),
	})
	.strict()
	.superRefine((site, ctx) => {
		try {
			parseContentRoot(site.contentRoot);
		} catch {
			ctx.addIssue({ code: "custom", message: "站点内容根无效。", path: ["contentRoot"] });
		}

		const seenTypeIds = new Set<string>();
		for (const contentType of site.types) {
			if (seenTypeIds.has(contentType.id)) {
				ctx.addIssue({
					code: "custom",
					message: `内容类型标识重复：${contentType.id}。`,
					path: ["types"],
				});
			}
			seenTypeIds.add(contentType.id);
		}
	});

/**
 * 校验站点配置并在无效时失败关闭。
 *
 * 不返回解析结果：站点配置在 `firefly.ts` / `tsh520.ts` 里已经是 `SiteConfig` 类型，
 * 这里只断言运行时不变式，避免再引入一次「解析结果与源类型是否一致」的维护负担。
 */
export function assertValidSiteConfig(config: SiteConfig): void {
	const result = siteConfigSchema.safeParse(config);
	if (!result.success) {
		// 不把具体哪条不变式失败暴露给远端调用者，避免探测部署细节。
		throw new ApiError(503, "CONFIGURATION_ERROR", "站点配置尚未正确设置。");
	}
}
