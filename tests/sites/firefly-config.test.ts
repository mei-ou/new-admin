import { describe, expect, it } from "vitest";
import { buildArticlePath } from "../../src/core/security/path-policy";
import { articleFrontmatterSchema } from "../../src/modules/articles/article-schema";
import { fireflyPostsType, fireflySite } from "../../src/sites/firefly";
import { assertValidSiteConfig } from "../../src/sites/schema";
import { toArticlePathConfig } from "../../src/sites/types";

/**
 * Firefly 站点配置的护栏。
 *
 * Phase 1a 时期这里逐项比对「站点配置」与「article-schema.ts 里手写的 schema」两份定义。
 * 手写定义已在 Phase 1b-1 删除，字段唯一来源变成 `src/sites/firefly.ts`，因此改为核对
 * 「派生出的 Front-matter schema 确实由站点声明的字段驱动」：站点配置增删或改名时这里会失败，
 * 而不是让 schema 与站点配置静默漂移。
 */

const minimalValidInput = {
	title: "标题",
	published: "2024-01-01T00:00:00.000Z",
};

describe("Firefly 站点配置", () => {
	it("通过站点配置结构校验", () => {
		expect(() => assertValidSiteConfig(fireflySite)).not.toThrow();
	});

	it("派生 Front-matter schema 的键集合等于站点声明的字段", () => {
		// 用「所有字段都提供」的输入核对，否则可选字段（updated）会因缺席而不出现在结果里，
		// 无法区分「schema 没声明该字段」与「字段可选且本次未提供」。
		const parsed = articleFrontmatterSchema.parse({
			...minimalValidInput,
			updated: "2024-01-02T00:00:00.000Z",
		}) as unknown as Record<string, unknown>;
		expect(Object.keys(parsed).sort()).toEqual(
			fireflyPostsType.fields.map((field) => field.key).sort(),
		);
	});

	it("派生 Front-matter schema 应用站点声明的默认值", () => {
		const parsed = articleFrontmatterSchema.parse(minimalValidInput) as unknown as Record<
			string,
			unknown
		>;
		let checked = 0;
		for (const field of fireflyPostsType.fields) {
			const resolved = field.validation.safeParse(undefined);
			// 只核对声明了默认值的字段。必填字段（title / published）没有默认值，
			// 可选字段（updated）的「缺省」语义是字段缺席而非某个默认值，都不参与比对。
			if (!resolved.success || resolved.data === undefined) continue;
			expect(parsed[field.key], field.key).toEqual(resolved.data);
			checked += 1;
		}
		// 防止循环静默空转：Firefly 确实有一批带默认值的字段。
		expect(checked).toBeGreaterThan(0);
	});

	it("拒绝未知字段，避免静默剥离构建内部数据", () => {
		expect(() =>
			articleFrontmatterSchema.parse({ ...minimalValidInput, prevTitle: "构建注入字段" }),
		).toThrow();
	});

	it("站点路径配置能构造出 Firefly 的 Page Bundle 路径", () => {
		const pathConfig = toArticlePathConfig(fireflyPostsType, fireflySite.contentRoot);
		expect(buildArticlePath("firefly-admin", pathConfig)).toBe(
			"src/content/posts/firefly-admin/index.md",
		);
	});

	it("Firefly 只有一个内容类型，供单类型站点隐藏类型选择器", () => {
		expect(fireflySite.types).toHaveLength(1);
		expect(fireflySite.types[0]).toBe(fireflyPostsType);
	});
});

describe("站点配置结构校验的失败关闭", () => {
	const [firstField] = fireflyPostsType.fields;

	it("前置条件：Firefly 至少声明了一个字段", () => {
		expect(firstField).toBeDefined();
	});

	it("拒绝重复字段键", () => {
		if (firstField === undefined) throw new TypeError("前置条件不成立");
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [{ ...fireflyPostsType, fields: [firstField, { ...firstField }] }],
			}),
		).toThrow();
	});

	it("拒绝重复内容类型标识", () => {
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [fireflyPostsType, { ...fireflyPostsType }],
			}),
		).toThrow();
	});

	it("拒绝 Page Bundle 策略开启分类子目录", () => {
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [{ ...fireflyPostsType, allowCategoryPath: true }],
			}),
		).toThrow();
	});

	it("拒绝把 slug 用作普通字段", () => {
		if (firstField === undefined) throw new TypeError("前置条件不成立");
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [{ ...fireflyPostsType, fields: [{ ...firstField, key: "slug" }] }],
			}),
		).toThrow();
	});

	it("拒绝越界的内容根与类型目录", () => {
		expect(() =>
			assertValidSiteConfig({ ...fireflySite, contentRoot: "src/content/../secrets" }),
		).toThrow();
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [{ ...fireflyPostsType, directory: "posts/../secrets" }],
			}),
		).toThrow();
	});

	it("拒绝声明了候选项却不是 select 的字段", () => {
		if (firstField === undefined) throw new TypeError("前置条件不成立");
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [
					{
						...fireflyPostsType,
						fields: [{ ...firstField, options: [{ value: "a", label: "A" }] }],
					},
				],
			}),
		).toThrow();
	});

	it("拒绝缺少候选项的 select 字段", () => {
		if (firstField === undefined) throw new TypeError("前置条件不成立");
		expect(() =>
			assertValidSiteConfig({
				...fireflySite,
				types: [{ ...fireflyPostsType, fields: [{ ...firstField, kind: "select" }] }],
			}),
		).toThrow();
	});
});
