import { pinyin } from "pinyin-pro";

export const SLUG_MAX_LENGTH = 100;
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * 多段存储标识的总长度上限（含分类段的 `/` 分隔符）。
 *
 * 有意低于「段上限 × 段数」：真正的约束对象是拼出来的仓库路径长度——内容根、类型目录与
 * 扩展名还要再占几十个字符，需要给 Windows 工作区的 MAX_PATH 留出余量。
 */
export const STORAGE_ID_MAX_LENGTH = 200;
/** 存储标识中单个路径段的长度上限。 */
export const STORAGE_ID_SEGMENT_MAX_LENGTH = 100;

/**
 * 存储标识的文件名策略。
 *
 * - `ascii-slug`：每段都必须是小写字母、数字与单连字符（Firefly）。
 * - `unicode`：允许中日韩等文字直接作为文件名（tsh520），但仍执行与 ASCII 同级的结构性
 *   拒绝——路径分隔、编码分隔、控制字符、保留名、首尾空白与点。
 */
export type StorageIdPolicy = "ascii-slug" | "unicode";

export type SegmentFailureReason = "empty" | "too-long" | "unsafe-input" | "invalid-format";

function containsUnsafeSlugCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		if (character === "/" || character === "\\" || character === "%") {
			return true;
		}
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}

/** Windows 保留设备名。即使 Worker 跑在 Linux 上，仓库仍可能被 Windows 工作区检出。 */
const WINDOWS_RESERVED_SEGMENT = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Windows 与 Git 都不适合出现在文件名中的字符。 */
const FORBIDDEN_FILENAME_CHARACTERS = /[<>:"|?*]/;

/** 除普通空格 U+0020 之外的一切空白（含制表、换行、不换行空格）。 */
const NON_SPACE_WHITESPACE = /[^\S ]/u;

/** 零宽与双向控制字符：可让文件名在视觉上伪装成另一个名字。 */
const INVISIBLE_FORMAT_CHARACTERS = /[\u200b-\u200f\u2028\u2029\u202a-\u202e\u2060-\u206f\ufeff]/u;

export type SlugValidationResult =
	| { valid: true; slug: string }
	| { valid: false; reason: SegmentFailureReason };

export type UnicodeSegmentValidationResult =
	| { valid: true; segment: string }
	| { valid: false; reason: SegmentFailureReason };

/**
 * 将标题转换为与 Firefly 新文章脚本一致的 URL slug。
 *
 * 中文使用无声调拼音，`ü` 转为 `v`；拉丁字符统一小写。标点和空白只作为
 * 分隔符处理，最终结果仍必须通过严格 slug 校验，转换函数本身不是安全边界。
 */
export function createSlugFromTitle(title: string): string {
	const transliterated = pinyin(title.normalize("NFKC"), {
		toneType: "none",
		type: "array",
		nonZh: "consecutive",
		v: true,
	}).join(" ");

	return transliterated
		.toLowerCase()
		.replaceAll("'", "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.replace(/-+/g, "-");
}

/**
 * 校验用户手动编辑的 slug。校验前只执行 NFKC 以识别全角混淆，不自动修复；
 * 这可避免浏览器显示值与服务端实际写入路径不一致。
 */
export function validateSlug(input: unknown): SlugValidationResult {
	if (typeof input !== "string") {
		return { valid: false, reason: "invalid-format" };
	}

	const normalized = input.normalize("NFKC");
	if (normalized.length === 0) {
		return { valid: false, reason: "empty" };
	}
	if (normalized.length > SLUG_MAX_LENGTH) {
		return { valid: false, reason: "too-long" };
	}
	if (containsUnsafeSlugCharacter(normalized) || normalized.includes("..")) {
		return { valid: false, reason: "unsafe-input" };
	}
	if (normalized !== input || !SLUG_PATTERN.test(normalized)) {
		return { valid: false, reason: "invalid-format" };
	}

	return { valid: true, slug: normalized };
}

/** 验证 slug 并在无效时抛出不包含原始恶意输入的稳定错误。 */
export function parseSlug(input: unknown): string {
	const result = validateSlug(input);
	if (!result.valid) {
		throw new TypeError(`Slug 校验失败：${result.reason}`);
	}
	return result.slug;
}

/**
 * 校验单个 Unicode 路径段（文件名）。
 *
 * 允许中文等非 ASCII 文字，但仍拒绝：空段、超长、非 NFKC 归一、控制与不可见字符、
 * 路径与编码分隔符、Windows 保留名、首尾空白或点、以及 Windows 非法字符。
 *
 * 与 `validateSlug` 一样，只做 NFKC 以识别全角混淆，不自动修复——避免浏览器显示值与
 * 服务端实际写入路径不一致。
 */
export function validateUnicodeSegment(input: unknown): UnicodeSegmentValidationResult {
	if (typeof input !== "string") {
		return { valid: false, reason: "invalid-format" };
	}
	if (input.length === 0) {
		return { valid: false, reason: "empty" };
	}
	if (input.length > STORAGE_ID_SEGMENT_MAX_LENGTH) {
		return { valid: false, reason: "too-long" };
	}
	if (input !== input.normalize("NFKC")) {
		return { valid: false, reason: "invalid-format" };
	}
	if (containsUnsafeSlugCharacter(input)) {
		return { valid: false, reason: "unsafe-input" };
	}
	if (input === "." || input === "..") {
		return { valid: false, reason: "unsafe-input" };
	}
	if (input !== input.trim() || input.startsWith(".") || input.endsWith(".")) {
		return { valid: false, reason: "unsafe-input" };
	}
	if (NON_SPACE_WHITESPACE.test(input) || INVISIBLE_FORMAT_CHARACTERS.test(input)) {
		return { valid: false, reason: "unsafe-input" };
	}
	if (FORBIDDEN_FILENAME_CHARACTERS.test(input)) {
		return { valid: false, reason: "unsafe-input" };
	}
	// 保留名判断取第一个 `.` 之前的部分，因此 `con.md` 同样被拒绝。
	const stem = input.includes(".") ? input.slice(0, input.indexOf(".")) : input;
	if (WINDOWS_RESERVED_SEGMENT.test(stem)) {
		return { valid: false, reason: "unsafe-input" };
	}

	return { valid: true, segment: input };
}

function failureReasonOf(
	result: { valid: true } | { valid: false; reason: SegmentFailureReason },
): SegmentFailureReason | null {
	return result.valid ? null : result.reason;
}

/**
 * 校验并归一化多段存储标识。
 *
 * 存储标识是文章相对 `<contentRoot>/<typeDirectory>/` 的路径，**不含扩展名**。单段标识
 * （Firefly 的 `firefly-admin`）与多段标识（tsh520 的 `旅行/我的文章`）走同一条校验路径，
 * 逐段执行策略对应的校验。任何一段失败即整体失败，绝不返回部分结果——否则调用方可能
 * 拿着「前半段合法」的路径继续构造写入目标。
 */
export function parseStorageId(input: unknown, policy: StorageIdPolicy): string {
	if (typeof input !== "string") {
		throw new TypeError("存储标识校验失败：invalid-format");
	}

	const normalized = input.normalize("NFKC");
	if (normalized !== input) {
		throw new TypeError("存储标识校验失败：invalid-format");
	}
	if (normalized.length === 0) {
		throw new TypeError("存储标识校验失败：empty");
	}
	if (normalized.length > STORAGE_ID_MAX_LENGTH) {
		throw new TypeError("存储标识校验失败：too-long");
	}

	const segments = normalized.split("/");
	for (const segment of segments) {
		const reason =
			policy === "ascii-slug"
				? failureReasonOf(validateSlug(segment))
				: failureReasonOf(validateUnicodeSegment(segment));
		if (reason !== null) {
			throw new TypeError(`存储标识校验失败：${reason}`);
		}
	}

	return segments.join("/");
}
