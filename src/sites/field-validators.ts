import { z } from "zod";
import { parseUncredentialedHttpsUrl } from "../core/security/url-policy";

/**
 * 通用字段校验器工厂。
 *
 * 这些校验器会被站点配置（`src/sites/<site>.ts`）复用，因此必须与站点无关：只表达
 * 「文本 / 数字 / 枚举 / URL」这类通用语义。
 *
 * 刻意不放在这里的东西：带仓库路径含义的校验（例如 Page Bundle 内的 `./file` 引用）。
 * 那类校验需要 `path-policy`，而路径策略又可能反过来读站点配置，放进来会形成循环引用；
 * 它们留在文章模块，由站点配置按需引用。
 */

function containsUnsafeControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}

/** 判断字符串是否为不含凭据、异常端口与查询参数的 HTTPS 地址。 */
export function isSafeHttpsUrl(value: string): boolean {
	try {
		parseUncredentialedHttpsUrl(value, "URL");
		return true;
	} catch {
		return false;
	}
}

/**
 * 文本字段统一拒绝控制字符，避免污染 YAML、提交信息和结构化日志。
 * 换行仅对 Markdown 正文有意义，Frontmatter 文本字段不接受不可见控制字符。
 *
 * 默认值请由调用方继续链式声明（如 `safeText(500).default("")`），这样「默认值」与
 * 「字段定义」写在同一行，不需要在别处再维护一份。
 */
export function safeText(maxLength: number) {
	return z
		.string()
		.trim()
		.max(maxLength)
		.refine((value) => !containsUnsafeControlCharacter(value), {
			message: "字段包含不允许的控制字符。",
		});
}

/** 必填文本：在 `safeText` 基础上要求非空。 */
export function requiredText(maxLength: number) {
	return safeText(maxLength).min(1);
}

/** 可空 URL：空字符串视为「未填写」，否则必须是无凭据 HTTPS。 */
export function safeHttpsUrl(maxLength: number) {
	return safeText(maxLength).refine((value) => value === "" || isSafeHttpsUrl(value), {
		message: "URL 必须使用不含凭据的 HTTPS 地址。",
	});
}

/** 必填日期。接受 ISO 字符串或 Date，统一归一为 Date。 */
export function safeDate() {
	return z.coerce.date();
}

/** 可选日期。 */
export function safeOptionalDate() {
	return z.coerce.date().optional();
}

/** 字符串数组（标签）。默认空数组，元素沿用必填文本的安全边界。 */
export function safeTags(maxCount: number, maxLength: number) {
	return z.array(requiredText(maxLength)).max(maxCount).default([]);
}

export interface NumberBounds {
	readonly min?: number;
	readonly max?: number;
	readonly integer?: boolean;
}

/** 数值字段。字符串输入会被强制转换，便于直接绑定表单。 */
export function safeNumber(bounds: NumberBounds = {}) {
	let schema = z.coerce.number();
	if (bounds.integer) {
		schema = schema.int();
	}
	if (bounds.min !== undefined) {
		schema = schema.min(bounds.min);
	}
	if (bounds.max !== undefined) {
		schema = schema.max(bounds.max);
	}
	return schema;
}

/** 可选数值字段。 */
export function safeOptionalNumber(bounds: NumberBounds = {}) {
	return safeNumber(bounds).optional();
}

/**
 * 枚举字段。默认值由调用方链式声明（如 `safeEnum(["a", "b"]).default("a")`），
 * 与文本字段保持同一种写法。
 */
export function safeEnum<const T extends readonly [string, ...string[]]>(values: T) {
	return z.enum(values);
}
