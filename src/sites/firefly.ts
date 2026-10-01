import { z } from "zod";
import { safeCoverReference } from "../modules/articles/article-field-validators";
import {
	requiredText,
	safeDate,
	safeHttpsUrl,
	safeOptionalDate,
	safeTags,
	safeText,
} from "./field-validators";
import type { ContentTypeConfig, SiteConfig } from "./types";

/**
 * Firefly 站点配置。
 *
 * 字段定义与迁移前的 `articleConfig.ts` + `article-schema.ts` 逐项对齐：同样的 17 个字段、
 * 同样的默认值（`draft=true` / `lang="zh_CN"` / `comment=true`）与同样的安全边界。
 * 迁移只改「定义放在哪」，不改任何行为——这是 Phase 1a 的硬性验收标准。
 *
 * 迁移时顺带清掉了 `articleConfig.ts` 里 4 个从未被读取的死字段
 * （`allowDelete` / `allowDirectPublish` / `allowPullRequestPublish` / `enableMdx`）
 * 与陈旧的 `branch: "master"`（真实分支来自 `GITHUB_BRANCH` 环境变量）。
 */

const postsType: ContentTypeConfig = {
	id: "posts",
	label: "文章",
	// Firefly 的文章直接位于 `src/content/posts/<slug>/`，没有类型子目录。
	directory: "",
	pathStrategy: "pageBundle",
	filenamePolicy: "ascii-slug",
	allowCategoryPath: false,
	fields: [
		{ key: "title", label: "标题", kind: "text", validation: requiredText(200) },
		{ key: "published", label: "发布日期", kind: "datetime", validation: safeDate() },
		{ key: "updated", label: "更新时间", kind: "datetime", validation: safeOptionalDate() },
		{ key: "draft", label: "保存为草稿", kind: "boolean", validation: z.boolean().default(true) },
		{
			key: "description",
			label: "描述",
			kind: "textarea",
			validation: safeText(500).default(""),
		},
		{
			key: "image",
			label: "封面图",
			kind: "image",
			help: "https://… 或当前文章目录中的 ./cover.webp",
			validation: safeCoverReference(2_048).default(""),
		},
		{ key: "tags", label: "标签", kind: "tags", validation: safeTags(30, 50) },
		{
			key: "category",
			label: "分类",
			kind: "text",
			validation: requiredText(100).nullable().default(null),
		},
		{ key: "lang", label: "语言", kind: "text", validation: requiredText(20).default("zh_CN") },
		{ key: "pinned", label: "置顶文章", kind: "boolean", validation: z.boolean().default(false) },
		{ key: "author", label: "作者", kind: "text", validation: safeText(100).default("") },
		{
			key: "sourceLink",
			label: "来源链接",
			kind: "url",
			validation: safeHttpsUrl(2_048).default(""),
		},
		{
			key: "licenseName",
			label: "许可证名称",
			kind: "text",
			validation: safeText(100).default(""),
		},
		{
			key: "licenseUrl",
			label: "许可证链接",
			kind: "url",
			validation: safeHttpsUrl(2_048).default(""),
		},
		{ key: "comment", label: "允许评论", kind: "boolean", validation: z.boolean().default(true) },
		{ key: "password", label: "访问密码", kind: "text", validation: safeText(200).default("") },
		{ key: "passwordHint", label: "密码提示", kind: "text", validation: safeText(200).default("") },
	],
};

export const fireflySite: SiteConfig = {
	id: "firefly",
	label: "Firefly",
	contentRoot: "src/content/posts",
	types: [postsType],
};

/** Firefly 唯一的内容类型。文章服务在只有单类型时直接取它，无需先选类型。 */
export const fireflyPostsType = postsType;
