import { describe, expect, it } from "vitest";
import { ApiError } from "../../src/core/http/errors";
import { fireflyPostsType, fireflySite } from "../../src/sites/firefly";
import {
	getContentType,
	getSoleContentType,
	hasSingleContentType,
	resolveSiteConfig,
} from "../../src/sites/registry";

describe("站点解析", () => {
	it("按 SITE_ID 返回对应站点", () => {
		expect(resolveSiteConfig({ SITE_ID: "firefly" })).toBe(fireflySite);
	});

	it("SITE_ID 缺失或类型不对时失败关闭", () => {
		const invalidEnvs: unknown[] = [
			undefined,
			null,
			{},
			{ SITE_ID: "" },
			{ SITE_ID: 42 },
			{ SITE_ID: null },
			"firefly",
		];
		for (const env of invalidEnvs) {
			expect(() => resolveSiteConfig(env), JSON.stringify(env) ?? String(env)).toThrow(ApiError);
		}
	});

	it("未知 SITE_ID 失败关闭，不回退到任何默认站点", () => {
		for (const siteId of ["tsh520", "Firefly", "firefly-admin", "fireflyy"]) {
			expect(() => resolveSiteConfig({ SITE_ID: siteId }), siteId).toThrow(ApiError);
		}
	});

	it("拒绝未规范化的 SITE_ID，不自动修复", () => {
		for (const siteId of [" firefly", "firefly ", "ｆｉｒｅｆｌｙ", "firefly\n"]) {
			expect(() => resolveSiteConfig({ SITE_ID: siteId }), siteId).toThrow(ApiError);
		}
	});

	it("配置错误统一返回 503 CONFIGURATION_ERROR", () => {
		const cases: unknown[] = [{}, { SITE_ID: "unknown-site" }];
		for (const env of cases) {
			try {
				resolveSiteConfig(env);
				expect.unreachable("应当抛出配置错误");
			} catch (error) {
				expect(error).toBeInstanceOf(ApiError);
				expect((error as ApiError).status).toBe(503);
				expect((error as ApiError).code).toBe("CONFIGURATION_ERROR");
			}
		}
	});
});

describe("内容类型解析", () => {
	it("按标识取到内容类型", () => {
		expect(getContentType(fireflySite, "posts")).toBe(fireflyPostsType);
	});

	it("未知或空标识返回 400，不回退到第一个类型", () => {
		for (const typeId of ["", "post", "POST", "moments", 42, null, undefined]) {
			try {
				getContentType(fireflySite, typeId);
				expect.unreachable("应当抛出参数错误");
			} catch (error) {
				expect(error).toBeInstanceOf(ApiError);
				expect((error as ApiError).status).toBe(400);
				expect((error as ApiError).code).toBe("INVALID_REQUEST");
			}
		}
	});

	it("单类型站点可以直接取唯一类型", () => {
		expect(hasSingleContentType(fireflySite)).toBe(true);
		expect(getSoleContentType(fireflySite)).toBe(fireflyPostsType);
	});

	it("多类型站点调用单类型取值时失败关闭", () => {
		const multiTypeSite = {
			...fireflySite,
			types: [fireflyPostsType, { ...fireflyPostsType, id: "moments" }],
		};
		expect(hasSingleContentType(multiTypeSite)).toBe(false);
		expect(() => getSoleContentType(multiTypeSite)).toThrow(ApiError);
	});
});
