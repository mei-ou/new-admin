import { describe, expect, it } from "vitest";
import {
	readFrontmatterBoolean,
	readFrontmatterDate,
	readFrontmatterFirstText,
	readFrontmatterNullableText,
	readFrontmatterText,
	readFrontmatterTextArray,
	requireFrontmatterDate,
} from "../../src/modules/articles/frontmatter-readers";

/**
 * Front-matter 读取辅助的契约测试。
 *
 * 这些断言同时是「记录化之后不再有类型系统兜底」的护栏：字段缺失、类型不符、非法日期
 * 都必须被显式处理，而不是变成 `undefined` 或 `Invalid Date` 悄悄流到下游。
 */
describe("Front-matter 读取辅助", () => {
	describe("readFrontmatterText", () => {
		it("返回字符串值", () => {
			expect(readFrontmatterText({ title: "标题" }, "title")).toBe("标题");
		});

		it("字段缺失或类型不符时返回兜底值", () => {
			expect(readFrontmatterText({}, "title")).toBe("");
			expect(readFrontmatterText({ title: 42 }, "title")).toBe("");
			expect(readFrontmatterText({ title: null }, "title")).toBe("");
			expect(readFrontmatterText({ title: ["a"] }, "title")).toBe("");
			expect(readFrontmatterText({}, "title", "兜底")).toBe("兜底");
		});
	});

	describe("readFrontmatterNullableText", () => {
		it("字符串返回自身，缺失或类型不符返回 null", () => {
			expect(readFrontmatterNullableText({ category: "随笔" }, "category")).toBe("随笔");
			expect(readFrontmatterNullableText({ category: null }, "category")).toBeNull();
			expect(readFrontmatterNullableText({}, "category")).toBeNull();
		});
	});

	describe("readFrontmatterBoolean", () => {
		it("返回布尔值，缺失或类型不符时返回兜底值", () => {
			expect(readFrontmatterBoolean({ draft: false }, "draft", true)).toBe(false);
			expect(readFrontmatterBoolean({ draft: true }, "draft", false)).toBe(true);
			expect(readFrontmatterBoolean({}, "draft", true)).toBe(true);
			// 字符串 "false" 不是布尔值，必须走兜底而不是被真值化。
			expect(readFrontmatterBoolean({ draft: "false" }, "draft", true)).toBe(true);
		});
	});

	describe("readFrontmatterDate", () => {
		it("接受 Date 与可解析的字符串/数字", () => {
			const date = new Date("2026-08-12T00:00:00.000Z");
			expect(readFrontmatterDate({ published: date }, "published")).toEqual(date);
			expect(readFrontmatterDate({ published: "2026-08-12T00:00:00.000Z" }, "published")).toEqual(
				date,
			);
			expect(readFrontmatterDate({ published: date.getTime() }, "published")).toEqual(date);
		});

		it("缺失、非法日期或非法类型一律返回 undefined", () => {
			expect(readFrontmatterDate({}, "published")).toBeUndefined();
			expect(readFrontmatterDate({ published: "not-a-date" }, "published")).toBeUndefined();
			expect(readFrontmatterDate({ published: new Date("invalid") }, "published")).toBeUndefined();
			expect(readFrontmatterDate({ published: true }, "published")).toBeUndefined();
		});
	});

	describe("requireFrontmatterDate", () => {
		it("有效日期返回 Date", () => {
			expect(
				requireFrontmatterDate({ published: "2026-08-12T00:00:00.000Z" }, "published"),
			).toEqual(new Date("2026-08-12T00:00:00.000Z"));
		});

		it("缺失或非法时抛错，不返回 Invalid Date", () => {
			expect(() => requireFrontmatterDate({}, "published")).toThrow("不是有效日期");
			expect(() => requireFrontmatterDate({ published: "x" }, "published")).toThrow("不是有效日期");
		});
	});

	describe("readFrontmatterTextArray", () => {
		it("只保留字符串项", () => {
			expect(readFrontmatterTextArray({ tags: ["a", "b"] }, "tags")).toEqual(["a", "b"]);
			expect(readFrontmatterTextArray({ tags: ["a", 1, null, "b"] }, "tags")).toEqual(["a", "b"]);
		});

		it("非数组返回空数组", () => {
			expect(readFrontmatterTextArray({}, "tags")).toEqual([]);
			expect(readFrontmatterTextArray({ tags: "a" }, "tags")).toEqual([]);
			expect(readFrontmatterTextArray({ tags: { a: 1 } }, "tags")).toEqual([]);
		});
	});

	describe("readFrontmatterFirstText", () => {
		it("字符串直接返回，数组取首个非空字符串", () => {
			expect(readFrontmatterFirstText({ image: "./cover.webp" }, "image")).toBe("./cover.webp");
			expect(readFrontmatterFirstText({ image: ["", "./a.webp", "./b.webp"] }, "image")).toBe(
				"./a.webp",
			);
		});

		it("空数组、非字符串数组与缺失返回兜底值", () => {
			expect(readFrontmatterFirstText({ image: [] }, "image")).toBe("");
			expect(readFrontmatterFirstText({ image: [1, 2] }, "image")).toBe("");
			expect(readFrontmatterFirstText({}, "image", "兜底")).toBe("兜底");
		});
	});
});
