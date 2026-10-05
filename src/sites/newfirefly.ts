import { z } from "zod";
import {
	isSafeHttpsUrl,
	requiredText,
	safeDate,
	safeHttpsUrl,
	safeNumber,
	safeOptionalDate,
	safeTags,
	safeText,
} from "./field-validators";
import type { ContentTypeConfig, SiteConfig } from "./types";

const posts: ContentTypeConfig = {
	id: "posts",
	label: "文章",
	directory: "",
	pathStrategy: "flat",
	filenamePolicy: "unicode",
	allowCategoryPath: true,
	preserveUnknownFrontmatter: true,
	fields: [
		{ key: "title", label: "标题", kind: "text", validation: requiredText(200) },
		{ key: "published", label: "发布日期", kind: "datetime", validation: safeDate() },
		{ key: "updated", label: "更新日期", kind: "datetime", validation: safeOptionalDate() },
		{ key: "draft", label: "草稿", kind: "boolean", validation: z.boolean().default(false) },
		{ key: "description", label: "摘要", kind: "textarea", validation: safeText(500).default("") },
		{
			key: "image",
			label: "封面",
			kind: "image",
			validation: safeText(2048)
				.refine(
					(value) =>
						value === "" ||
						isSafeHttpsUrl(value) ||
						(/^(?:\/(?!\/)|\.\/|\.\.\/)[\p{L}\p{N}._/-]+$/u.test(value) && !value.includes("//")),
				)
				.default(""),
		},
		{ key: "tags", label: "标签", kind: "tags", validation: safeTags(30, 50) },
		{ key: "lang", label: "语言", kind: "text", validation: safeText(20).default("") },
		{ key: "pinned", label: "置顶", kind: "boolean", validation: z.boolean().default(false) },
		{ key: "author", label: "作者", kind: "text", validation: safeText(100).default("") },
		{
			key: "sourceLink",
			label: "来源链接",
			kind: "url",
			validation: safeHttpsUrl(2048).default(""),
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
			validation: safeHttpsUrl(2048).default(""),
		},
		{ key: "comment", label: "允许评论", kind: "boolean", validation: z.boolean().default(true) },
		{
			key: "order",
			label: "排序权重",
			kind: "number",
			validation: safeNumber({ min: -1_000_000, max: 1_000_000 }).default(0),
		},
	],
};

export const newfireflySite: SiteConfig = {
	id: "newfirefly",
	label: "参考版博客",
	contentRoot: "src/content/posts",
	types: [posts],
};
