import {
	parseSlug,
	parseStorageId,
	type StorageIdPolicy,
	validateUnicodeSegment,
} from "../../utils/slug-utils";

const SAFE_DIRECTORY_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const SAFE_MARKDOWN_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9._-]*\.md$/;
const SAFE_RESOURCE_FILENAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]*\.[a-zA-Z0-9]+$/;
/**
 * 允许的文章扩展名白名单。
 *
 * 只放 `.md`。MDX 含可执行表达式与组件，必须等专门的发布安全模型落地后才能开启，
 * 因此这里不给它留任何配置入口——`format` 也是字面量 `"md"`，两处约束互相印证。
 */
const ALLOWED_ARTICLE_EXTENSIONS = new Set([".md"]);
const WINDOWS_RESERVED_FILENAME_STEM = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_RESOURCE_FILENAME_LENGTH = 120;

/** Page Bundle 的默认入口文件名。 */
export const DEFAULT_ENTRY_FILENAME = "index.md";

/**
 * 文章在仓库中的落位形态。
 *
 * - `pageBundle`：`<contentRoot>/<typeDirectory>/<storageId>/<entryFilename>`，一篇文章一个目录。
 * - `flat`：`<contentRoot>/<typeDirectory>/<storageId><extension>`，一篇文章一个文件；
 *   `storageId` 可含分类子目录段。
 *
 * 站点配置用这个类型表达意图，`ArticlePathConfig` 再把它落成 `usePageBundle` 布尔开关——
 * 后者同时被媒体事务子系统用作失败关闭判据，因此必须保留。
 */
export type ArticlePathStrategy = "pageBundle" | "flat";

/**
 * 文章路径配置。
 *
 * 形态由 `usePageBundle` 决定（`true` = Page Bundle，`false` = 扁平文件）。刻意不引入独立的
 * `pathStrategy` 字段：媒体事务子系统以 `usePageBundle` 作为失败关闭开关，保留它可以让
 * 这些已冻结的能力继续原样工作，不必为一个纯命名变化承担回归风险。
 *
 * 其余字段均为可选并带保守默认值，使既有调用点与测试无需改动即可继续编译。
 */
export interface ArticlePathConfig {
	/** 站点级内容根，例如 Firefly 的 `src/content/posts`、tsh520 的 `src/content`。 */
	contentRoot: string;
	/** `true` = Page Bundle（`<storageId>/index.md`）；`false` = 扁平文件（`<storageId>.md`）。 */
	usePageBundle: boolean;
	/** Page Bundle 的入口文件名。 */
	entryFilename: string;
	/**
	 * 类型级子目录，相对 `contentRoot`，可含 `/`（如 tsh520 的 `life/notebooks`）。
	 * 省略或空字符串表示文章直接位于 `contentRoot` 下。
	 */
	typeDirectory?: string;
	/** 扁平策略使用的扩展名。 */
	extension?: string;
	/** 文件名策略。省略时为 `ascii-slug`。 */
	filenamePolicy?: StorageIdPolicy;
	/** 扁平策略下是否允许存储标识携带分类子目录段。省略时为 `false`。 */
	allowCategoryPath?: boolean;
}

/**
 * 归一化后的路径配置。所有可选字段都已填入确定值，后续逻辑只面对这一形态，
 * 避免在每个函数里重复处理 `undefined`。
 */
interface NormalizedArticlePathConfig {
	contentRoot: string;
	usePageBundle: boolean;
	entryFilename: string;
	typeDirectory: string;
	extension: string;
	filenamePolicy: StorageIdPolicy;
	allowCategoryPath: boolean;
}

/**
 * 未显式传入配置时的保守兜底。
 *
 * 固定为 Page Bundle——两种策略中更受限的一种。这样任何遗漏传参都会退回 Firefly 形态，
 * 而不是悄悄变成扁平写入。
 *
 * 为什么保留默认值：媒体事务子系统（`media-transaction-*`）整条调用链以可选 `pathConfig`
 * 透传，且自身已用 `usePageBundle` 做失败关闭守卫；把配置改为必填会让这些已冻结的能力
 * 承担纯签名层面的连锁改动，收益不足以抵消回归风险。**文章写入主链路仍必须显式传入
 * 站点配置**，这是 Phase 1b 的验收项之一。
 */
export const FALLBACK_ARTICLE_PATH_CONFIG: ArticlePathConfig = {
	contentRoot: "src/content/posts",
	usePageBundle: true,
	entryFilename: DEFAULT_ENTRY_FILENAME,
};

function containsControlCharacter(value: string): boolean {
	return Array.from(value).some((character) => {
		const codePoint = character.codePointAt(0);
		return codePoint !== undefined && (codePoint <= 31 || codePoint === 127);
	});
}

/**
 * 验证服务端路径配置。配置虽然不来自浏览器，但错误的部署变量或未来重构仍可能
 * 把写入范围移出文章目录，因此同样采用失败关闭策略。
 */
export function parseContentRoot(input: string): string {
	if (
		input.length === 0 ||
		input.length > 512 ||
		input !== input.normalize("NFKC") ||
		input.startsWith("/") ||
		input.endsWith("/") ||
		input.includes("\\") ||
		input.includes("%") ||
		input.includes(":") ||
		containsControlCharacter(input)
	) {
		throw new TypeError("文章内容根目录配置无效。");
	}

	const segments = input.split("/");
	if (
		segments.length === 0 ||
		segments.some(
			(segment) => segment === "." || segment === ".." || !SAFE_DIRECTORY_SEGMENT.test(segment),
		)
	) {
		throw new TypeError("文章内容根目录配置无效。");
	}

	return segments.join("/");
}

/**
 * 验证类型级子目录（服务端配置）。允许空字符串表示「直接位于内容根下」，
 * 逐段执行与客户端分类路径同级的校验。
 */
export function parseTypeDirectory(input: string): string {
	if (input === "") {
		return "";
	}
	if (input.length > 512 || input.startsWith("/") || input.endsWith("/")) {
		throw new TypeError("内容类型目录配置无效。");
	}

	const segments = input.split("/");
	for (const segment of segments) {
		const result = validateUnicodeSegment(segment);
		if (!result.valid) {
			throw new TypeError(`内容类型目录配置无效：${result.reason}`);
		}
	}

	return segments.join("/");
}

/**
 * 验证客户端提交的分类路径。
 *
 * 与 `parseTypeDirectory` 规则一致，但错误消息面向用户输入，且不做任何自动修复——
 * 浏览器显示值与服务端实际写入路径必须完全一致。
 */
export function parseCategoryPath(input: unknown): string {
	if (typeof input !== "string") {
		throw new TypeError("分类路径无效。");
	}
	if (input === "") {
		return "";
	}
	if (input.startsWith("/") || input.endsWith("/")) {
		throw new TypeError("分类路径无效。");
	}

	const segments = input.split("/");
	for (const segment of segments) {
		const result = validateUnicodeSegment(segment);
		if (!result.valid) {
			throw new TypeError(`分类路径无效：${result.reason}`);
		}
	}

	return segments.join("/");
}

function parseEntryFilename(input: string): string {
	if (
		input.length > 100 ||
		input !== input.normalize("NFKC") ||
		containsControlCharacter(input) ||
		!SAFE_MARKDOWN_FILENAME.test(input)
	) {
		throw new TypeError("文章入口文件配置无效。");
	}
	return input;
}

function parseExtension(input: string): string {
	if (!ALLOWED_ARTICLE_EXTENSIONS.has(input)) {
		throw new TypeError("文章扩展名配置无效。");
	}
	return input;
}

function parseFilenamePolicy(input: string): StorageIdPolicy {
	if (input !== "ascii-slug" && input !== "unicode") {
		throw new TypeError("文件名策略配置无效。");
	}
	return input;
}

/**
 * 归一化路径配置。
 *
 * `usePageBundle` 必须是布尔值：它同时是媒体事务子系统的失败关闭开关，若被错误配置成
 * 其他类型，宁可整体拒绝也不能让下游读到 `undefined` 而放行。
 */
function normalizeArticlePathConfig(config: ArticlePathConfig): NormalizedArticlePathConfig {
	if (typeof config.usePageBundle !== "boolean") {
		throw new TypeError("文章路径策略配置无效。");
	}

	return {
		contentRoot: config.contentRoot,
		usePageBundle: config.usePageBundle,
		entryFilename: config.entryFilename,
		typeDirectory: config.typeDirectory ?? "",
		extension: config.extension ?? ".md",
		filenamePolicy: parseFilenamePolicy(config.filenamePolicy ?? "ascii-slug"),
		allowCategoryPath: config.allowCategoryPath ?? false,
	};
}

/** 拼出 `<contentRoot>/<typeDirectory>`，两者都已通过各自的安全校验。 */
function resolveTypeBase(config: NormalizedArticlePathConfig): string {
	const contentRoot = parseContentRoot(config.contentRoot);
	const typeDirectory = parseTypeDirectory(config.typeDirectory);
	return typeDirectory === "" ? contentRoot : `${contentRoot}/${typeDirectory}`;
}

/**
 * 验证 Page Bundle 的直接子资源文件名。禁止路径分隔符、编码分隔符和 Unicode
 * 兼容折叠，确保同一规则可用于 Frontmatter、暂存清单和最终 Git Tree。
 */
export function parseArticleResourceFilename(input: unknown): string {
	if (
		typeof input !== "string" ||
		input.length === 0 ||
		input.length > MAX_RESOURCE_FILENAME_LENGTH ||
		input !== input.normalize("NFKC") ||
		input.includes("%") ||
		input.includes(":") ||
		containsControlCharacter(input) ||
		!SAFE_RESOURCE_FILENAME.test(input)
	) {
		throw new TypeError("文章资源文件名无效。");
	}
	const filenameStem = input.slice(0, input.lastIndexOf("."));
	if (WINDOWS_RESERVED_FILENAME_STEM.test(filenameStem)) {
		throw new TypeError("文章资源文件名无效。");
	}
	return input;
}

/**
 * Git 路径大小写敏感，但后台需要同时兼容 Windows 工作区。冲突键统一按 NFKC 后小写，
 * 确保 `Cover.PNG` 与 `cover.png` 不会在不同环境中形成不一致或隐式覆盖。
 */
export function getArticleResourceFilenameConflictKey(input: unknown): string {
	return parseArticleResourceFilename(input).normalize("NFKC").toLowerCase();
}

/** 本地资源引用固定为 `./<safeFilename>`，不允许子目录或跨 Page Bundle 引用。 */
export function parseArticleResourceReference(
	input: unknown,
	entryFilename: string = DEFAULT_ENTRY_FILENAME,
): string {
	if (typeof input !== "string" || !input.startsWith("./")) {
		throw new TypeError("文章资源引用无效。");
	}
	const filename = parseArticleResourceFilename(input.slice(2));
	if (
		getArticleResourceFilenameConflictKey(filename) ===
		parseEntryFilename(entryFilename).normalize("NFKC").toLowerCase()
	) {
		throw new TypeError("文章资源不能覆盖入口文件。");
	}
	return `./${filename}`;
}

export interface ControlledArticleResourceReference {
	reference: string;
	storageSlug: string;
	filename: string;
	repositoryPath: string;
}

/**
 * 为媒体事务构造唯一允许的 Page Bundle 资源引用。普通文章写入仍只能使用上面的 `./` parser；
 * 单层 `../<slug>/` 只在服务端已经同时验证源、目标文章身份时使用，不能成为任意路径入口。
 */
export function buildControlledArticleResourceReference(
	fromStorageSlugInput: unknown,
	targetStorageSlugInput: unknown,
	filenameInput: unknown,
	config: ArticlePathConfig = FALLBACK_ARTICLE_PATH_CONFIG,
): string {
	const fromStorageSlug = parseSlug(fromStorageSlugInput);
	const targetStorageSlug = parseSlug(targetStorageSlugInput);
	const filename = parseArticleResourceFilename(filenameInput);
	buildArticleResourcePath(targetStorageSlug, filename, config);
	return fromStorageSlug === targetStorageSlug
		? parseArticleResourceReference(`./${filename}`)
		: `../${targetStorageSlug}/${filename}`;
}

/**
 * 解析受控媒体事务引用。只接受规范的当前 Bundle `./file` 或同级 Bundle `../slug/file`；
 * 不接受 query、fragment、百分号编码、反斜杠、更多层级或指向当前 Bundle 的非规范 `../`。
 */
export function parseControlledArticleResourceReference(
	fromStorageSlugInput: unknown,
	referenceInput: unknown,
	config: ArticlePathConfig = FALLBACK_ARTICLE_PATH_CONFIG,
): ControlledArticleResourceReference {
	const fromStorageSlug = parseSlug(fromStorageSlugInput);
	if (typeof referenceInput !== "string") {
		throw new TypeError("文章资源引用无效。");
	}
	if (referenceInput.startsWith("./")) {
		const reference = parseArticleResourceReference(referenceInput);
		const filename = reference.slice(2);
		return {
			reference,
			storageSlug: fromStorageSlug,
			filename,
			repositoryPath: buildArticleResourcePath(fromStorageSlug, filename, config),
		};
	}
	if (!referenceInput.startsWith("../")) {
		throw new TypeError("文章资源引用无效。");
	}
	const segments = referenceInput.slice(3).split("/");
	if (segments.length !== 2) throw new TypeError("文章资源引用无效。");
	const storageSlug = parseSlug(segments[0]);
	const filename = parseArticleResourceFilename(segments[1]);
	if (storageSlug === fromStorageSlug) {
		throw new TypeError("当前文章资源必须使用规范的相对引用。");
	}
	const reference = buildControlledArticleResourceReference(
		fromStorageSlug,
		storageSlug,
		filename,
		config,
	);
	if (reference !== referenceInput) throw new TypeError("文章资源引用无效。");
	return {
		reference,
		storageSlug,
		filename,
		repositoryPath: buildArticleResourcePath(storageSlug, filename, config),
	};
}

/**
 * 根据已验证的存储标识构造唯一允许的 GitHub 仓库相对路径。
 *
 * 调用方不能传完整路径、分支或扩展名；形态完全由站点配置决定，从接口上消除
 * 「校验了标识，却在别处误用客户端路径」的可能性。
 *
 * 存储标识是相对 `<contentRoot>/<typeDirectory>/` 的路径且不含扩展名：
 * - Page Bundle → `<contentRoot>/<typeDirectory>/<storageId>/<entryFilename>`
 * - 扁平文件   → `<contentRoot>/<typeDirectory>/<storageId><extension>`
 */
export function buildArticlePath(
	storageIdInput: unknown,
	config: ArticlePathConfig = FALLBACK_ARTICLE_PATH_CONFIG,
): string {
	const normalized = normalizeArticlePathConfig(config);
	const storageId = parseStorageId(storageIdInput, normalized.filenamePolicy);
	if (!normalized.allowCategoryPath && storageId.includes("/")) {
		throw new TypeError("当前内容类型不允许分类子目录。");
	}

	const base = resolveTypeBase(normalized);
	const path = normalized.usePageBundle
		? `${base}/${storageId}/${parseEntryFilename(normalized.entryFilename)}`
		: `${base}/${storageId}${parseExtension(normalized.extension)}`;

	// 组件已逐项验证；最终前缀检查仍作为纵深防御，防止未来修改时破坏目录边界。
	if (!path.startsWith(`${normalized.contentRoot}/`) || path === normalized.contentRoot) {
		throw new TypeError("文章路径超出允许的内容目录。");
	}

	return path;
}

/**
 * 根据文章存储标识与安全文件名构造当前 Page Bundle 的唯一资源仓库路径。
 *
 * 扁平策略下文章是单文件，不存在「同目录资源」的概念。此时若继续计算路径，资源会被写到
 * 一个语义不明的位置，因此直接失败关闭，而不是猜一个位置。
 */
export function buildArticleResourcePath(
	storageIdInput: unknown,
	filenameInput: unknown,
	config: ArticlePathConfig = FALLBACK_ARTICLE_PATH_CONFIG,
): string {
	const normalized = normalizeArticlePathConfig(config);
	if (!normalized.usePageBundle) {
		throw new TypeError("扁平文件策略不支持文章资源路径。");
	}

	const contentRoot = parseContentRoot(normalized.contentRoot);
	const typeDirectory = parseTypeDirectory(normalized.typeDirectory);
	const base = typeDirectory === "" ? contentRoot : `${contentRoot}/${typeDirectory}`;
	const storageId = parseStorageId(storageIdInput, normalized.filenamePolicy);
	if (storageId.includes("/")) {
		throw new TypeError("文章资源路径不支持分类子目录。");
	}
	const entryFilename = parseEntryFilename(normalized.entryFilename);
	const filename = parseArticleResourceFilename(filenameInput);
	if (
		getArticleResourceFilenameConflictKey(filename) ===
		entryFilename.normalize("NFKC").toLowerCase()
	) {
		throw new TypeError("文章资源不能覆盖入口文件。");
	}

	const bundleRoot = `${base}/${storageId}`;
	const path = `${bundleRoot}/${filename}`;
	if (!path.startsWith(`${bundleRoot}/`) || path === bundleRoot) {
		throw new TypeError("文章资源路径超出允许的文章目录。");
	}
	return path;
}

export interface ParsedArticlePath {
	/** 相对 `<contentRoot>/<typeDirectory>/`、不含扩展名的存储标识。 */
	storageId: string;
}

/**
 * `buildArticlePath` 的反解：把仓库相对路径还原为存储标识。
 *
 * 供列表扫描与「路径 → 文章身份」使用。反解与构造共用同一份归一化配置，因此
 * 不可能出现「能构造出来却反解不回去」的路径形态。
 */
export function parseArticlePath(
	pathInput: unknown,
	config: ArticlePathConfig = FALLBACK_ARTICLE_PATH_CONFIG,
): ParsedArticlePath {
	const normalized = normalizeArticlePathConfig(config);
	if (typeof pathInput !== "string") {
		throw new TypeError("文章路径无效。");
	}

	const base = resolveTypeBase(normalized);
	if (!pathInput.startsWith(`${base}/`)) {
		throw new TypeError("文章路径超出允许的内容目录。");
	}
	const remainder = pathInput.slice(base.length + 1);

	let storageId: string;
	if (normalized.usePageBundle) {
		const suffix = `/${parseEntryFilename(normalized.entryFilename)}`;
		if (!remainder.endsWith(suffix)) {
			throw new TypeError("文章路径无效。");
		}
		storageId = remainder.slice(0, -suffix.length);
	} else {
		const extension = parseExtension(normalized.extension);
		if (!remainder.endsWith(extension)) {
			throw new TypeError("文章路径无效。");
		}
		storageId = remainder.slice(0, -extension.length);
	}

	if (!normalized.allowCategoryPath && storageId.includes("/")) {
		throw new TypeError("文章路径包含不允许的分类子目录。");
	}

	return { storageId: parseStorageId(storageId, normalized.filenamePolicy) };
}
