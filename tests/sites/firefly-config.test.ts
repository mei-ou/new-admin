import { describe, expect, it } from "vitest";
import { buildArticlePath } from "../../src/core/security/path-policy";
import {
	articleFrontmatterSchema,
	buildArticleFrontmatterSchema,
} from "../../src/modules/articles/article-schema";
import { fireflyPostsType, fireflySite } from "../../src/sites/firefly";
import { assertValidSiteConfig } from "../../src/sites/schema";
import { toArticlePathConfig } from "../../src/sites/types";

/**
 * Phase 1a 的过渡护栏。
 *
 * 这一阶段字段清单暂时存在两份：`src/sites/firefly.ts`（新的单一来源）与
 * `article-schema.ts` 里手写的 schema（尚未做类型改造，见该文件注释）。
 * 本测试逐项核对两者，确保过渡期间不可能静默漂移。Phase 1b 删除手写 schema 后，
 * 可以只保留「站点配置自身合法」那部分。
 */

const minimalValidInput = {
	title: "标题",
	published: "2024-01-01T00:00:00.000Z",
};

describe("Firefly 站点配置", () => {
	it("通过站点配置结构校验", () => {
		expect(() => assertValidSiteConfig(fireflySite)).not.toThrow();
	});

	it("字段清单与手写 schema 完全一致", () => {
		const declaredKeys = fireflyPostsType.fields.map((field) => field.key).sort();
		const schemaKeys = Object.keys(articleFrontmatterSchema.shape).sort();
		expect(declaredKeys).toEqual(schemaKeys);
	});

	it("默认值与手写 schema 一致", () => {
		const declared = buildArticleFrontmatterSchema(fireflyPostsType).parse(minimalValidInput);
		const handwritten = articleFrontmatterSchema.parse(minimalValidInput);
		expect(declared).toEqual(handwritten);
	});

	it("两者都拒绝未知字段", () => {
		const withUnknownField = { ...minimalValidInput, prevTitle: "构建注入字段" };
		expect(() => articleFrontmatterSchema.parse(withUnknownField)).toThrow();
		expect(() => buildArticleFrontmatterSchema(fireflyPostsType).parse(withUnknownField)).toThrow();
	});

	it("两者对同一非法输入给出同样的拒绝结果", () => {
		const invalidCases = [
			{ ...minimalValidInput, title: "" },
			{ ...minimalValidInput, sourceLink: "http://insecure.example.com" },
			{ ...minimalValidInput, image: "data:image/png;base64,AAAA" },
			{ ...minimalValidInput, published: "not-a-date" },
			{ ...minimalValidInput, tags: ["ok", ""] },
		];
		for (const invalidInput of invalidCases) {
			const declaredRejected =
				!buildArticleFrontmatterSchema(fireflyPostsType).safeParse(invalidInput).success;
			const handwrittenRejected = !articleFrontmatterSchema.safeParse(invalidInput).success;
			expect(declaredRejected, JSON.stringify(invalidInput)).toBe(true);
			expect(handwrittenRejected, JSON.stringify(invalidInput)).toBe(true);
		}
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
