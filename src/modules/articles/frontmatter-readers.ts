import type { ArticleFrontmatter } from "../../types/article";

/**
 * Front-matter 具名读取辅助。
 *
 * Front-matter 已改为按内容类型驱动的记录类型（见 `types/article.ts`），字段是否存在、
 * 类型是否正确都必须在**使用点显式收窄**。这些辅助把「读取 + 收窄 + 兜底」收敛到一处，
 * 避免每个消费点各写一套 `typeof value === "string"` 判断而彼此漂移。
 *
 * 兜底策略是刻意的，分两类：
 * - **可选字段缺失是常态**（`updated`、`category`、`image`…），因此除日期外一律返回显式兜底值，
 *   不抛错——否则「没填描述」会让整篇列表崩掉。
 * - **日期是业务排序与展示的基础**，读不到就是数据异常，`requireFrontmatterDate` 直接抛错，
 *   避免 `Invalid Date` 静默传播到列表排序和 API 响应里。
 *
 * 注意：这里只做形状收窄，**不重复字段校验**。服务端权威校验始终由站点配置的
 * `field.validation`（经 codec）负责；这些辅助只服务于「已经过校验、但仍需按类型取用」的场景。
 */

/** 读取字符串字段；缺失或类型不符时返回兜底值。 */
export function readFrontmatterText(
	frontmatter: ArticleFrontmatter,
	key: string,
	fallback = "",
): string {
	const value = frontmatter[key];
	return typeof value === "string" ? value : fallback;
}

/** 读取可空字符串字段；缺失或类型不符时返回 `null`（对应 Firefly 的 `category` 语义）。 */
export function readFrontmatterNullableText(
	frontmatter: ArticleFrontmatter,
	key: string,
): string | null {
	const value = frontmatter[key];
	return typeof value === "string" ? value : null;
}

/** 读取布尔字段；缺失或类型不符时返回兜底值。 */
export function readFrontmatterBoolean(
	frontmatter: ArticleFrontmatter,
	key: string,
	fallback: boolean,
): boolean {
	const value = frontmatter[key];
	return typeof value === "boolean" ? value : fallback;
}

/**
 * 读取日期字段。接受 `Date`，也接受可解析的字符串/数字——YAML 未加引号的日期在部分
 * 写法下会落到字符串，这里统一归一，避免上游写法差异变成下游的类型事故。
 */
export function readFrontmatterDate(
	frontmatter: ArticleFrontmatter,
	key: string,
): Date | undefined {
	const value = frontmatter[key];
	if (value instanceof Date) {
		return Number.isNaN(value.getTime()) ? undefined : value;
	}
	if (typeof value === "string" || typeof value === "number") {
		const parsed = new Date(value);
		return Number.isNaN(parsed.getTime()) ? undefined : parsed;
	}
	return undefined;
}

/** 读取必填日期；缺失或非法一律抛错，不返回 `Invalid Date`。 */
export function requireFrontmatterDate(frontmatter: ArticleFrontmatter, key: string): Date {
	const value = readFrontmatterDate(frontmatter, key);
	if (value === undefined) {
		throw new TypeError(`Front-matter 字段 ${key} 不是有效日期。`);
	}
	return value;
}

/** 读取字符串数组（标签、图片列表等）。非数组时返回空数组，数组内的非字符串项被丢弃。 */
export function readFrontmatterTextArray(frontmatter: ArticleFrontmatter, key: string): string[] {
	const value = frontmatter[key];
	if (!Array.isArray(value)) {
		return [];
	}
	return value.filter((item): item is string => typeof item === "string");
}

/**
 * 按「首个非空字符串」顺序读取，用于 `image` 这类可能是 `string` 也可能是
 * `string[]` 的字段（站点配置里的 `stringOrArray` 形状）。
 */
export function readFrontmatterFirstText(
	frontmatter: ArticleFrontmatter,
	key: string,
	fallback = "",
): string {
	const value = frontmatter[key];
	if (typeof value === "string") {
		return value;
	}
	if (Array.isArray(value)) {
		const first = value.find((item): item is string => typeof item === "string" && item !== "");
		return first ?? fallback;
	}
	return fallback;
}
