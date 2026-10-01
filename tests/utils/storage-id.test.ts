import { describe, expect, it } from "vitest";
import {
	parseStorageId,
	STORAGE_ID_MAX_LENGTH,
	STORAGE_ID_SEGMENT_MAX_LENGTH,
	validateUnicodeSegment,
} from "../../src/utils/slug-utils";

describe("存储标识校验", () => {
	it("ascii-slug 策略接受单段与多段合法标识", () => {
		expect(parseStorageId("firefly-admin", "ascii-slug")).toBe("firefly-admin");
		expect(parseStorageId("travel/my-post", "ascii-slug")).toBe("travel/my-post");
	});

	it("ascii-slug 策略拒绝中文、大写与下划线", () => {
		for (const storageId of ["我的文章", "MyPost", "my_post", "-leading", "trailing-"]) {
			expect(() => parseStorageId(storageId, "ascii-slug"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("unicode 策略接受中文、日文与韩文", () => {
		expect(parseStorageId("我的文章", "unicode")).toBe("我的文章");
		expect(parseStorageId("旅行/我的文章", "unicode")).toBe("旅行/我的文章");
		expect(parseStorageId("テスト", "unicode")).toBe("テスト");
		expect(parseStorageId("제목", "unicode")).toBe("제목");
	});

	it("拒绝空段、前后斜杠与重复斜杠", () => {
		for (const storageId of ["", "/", "/a", "a/", "a//b", "a/./b"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("拒绝路径穿越", () => {
		for (const storageId of ["..", "../x", "x/..", "a/../b", ".../x"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("拒绝非 NFKC 归一输入，不自动修复", () => {
		expect(() => parseStorageId("我的／文章", "unicode")).toThrow("invalid-format");
		expect(() => parseStorageId("ａｂｃ", "ascii-slug")).toThrow("存储标识校验失败");
	});

	it("拒绝控制字符、编码分隔符与反斜杠", () => {
		for (const storageId of ["a\u0000b", "a\u007fb", "a%2Fb", "a\\b", "a:b"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("拒绝 Windows 非法字符与保留名", () => {
		for (const storageId of ["a<b", "a>b", "a|b", "a?b", "a*b", "CON", "con.md", "LPT9"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("拒绝首尾点、首尾空白与非常规空白", () => {
		for (const storageId of [".hidden", "trailing.", " 前导", "尾随 ", "a\u00a0b", "a\tb"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("拒绝零宽与双向控制字符", () => {
		for (const storageId of ["a\u200bb", "a\u202eb", "\ufeffab", "a\u2060b"]) {
			expect(() => parseStorageId(storageId, "unicode"), storageId).toThrow("存储标识校验失败");
		}
	});

	it("按段与整体分别限制长度", () => {
		const longestSegment = "あ".repeat(STORAGE_ID_SEGMENT_MAX_LENGTH);
		expect(parseStorageId(longestSegment, "unicode")).toBe(longestSegment);
		expect(() => parseStorageId("あ".repeat(STORAGE_ID_SEGMENT_MAX_LENGTH + 1), "unicode")).toThrow(
			"too-long",
		);

		// 整体上限有意低于「两段各自上限之和」：真正的约束对象是拼出来的仓库路径长度，
		// 因此两段都取满时应当被整体长度拦下。
		const twoFullSegments = `${longestSegment}/${longestSegment}`;
		expect(twoFullSegments.length).toBeGreaterThan(STORAGE_ID_MAX_LENGTH);
		expect(() => parseStorageId(twoFullSegments, "unicode")).toThrow("too-long");

		// 控制在整体上限内的多段仍然可用。
		const withinLimit = `${"あ".repeat(90)}/${"い".repeat(90)}`;
		expect(withinLimit.length).toBeLessThanOrEqual(STORAGE_ID_MAX_LENGTH);
		expect(parseStorageId(withinLimit, "unicode")).toBe(withinLimit);
	});

	it("非字符串输入一律失败关闭", () => {
		for (const input of [undefined, null, 42, {}, []]) {
			expect(() => parseStorageId(input, "unicode")).toThrow("存储标识校验失败");
		}
	});

	it("validateUnicodeSegment 给出稳定的失败原因", () => {
		expect(validateUnicodeSegment("我的文章")).toEqual({ valid: true, segment: "我的文章" });
		expect(validateUnicodeSegment("")).toEqual({ valid: false, reason: "empty" });
		expect(validateUnicodeSegment("a".repeat(101))).toEqual({ valid: false, reason: "too-long" });
		expect(validateUnicodeSegment("ａ")).toEqual({ valid: false, reason: "invalid-format" });
		expect(validateUnicodeSegment("a/b")).toEqual({ valid: false, reason: "unsafe-input" });
	});
});
