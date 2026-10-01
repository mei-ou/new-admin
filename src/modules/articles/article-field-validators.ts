import { parseArticleResourceReference } from "../../core/security/path-policy";
import { isSafeHttpsUrl, safeText } from "../../sites/field-validators";
import { isArticleAssetImageFilename } from "../media/media-config";

/**
 * 文章专有的字段校验器。
 *
 * 与 `sites/field-validators.ts` 的分工：那边只放与站点无关的通用校验（文本、数字、URL…）；
 * 这里放**需要理解 Page Bundle 资源引用**的校验。
 *
 * 之所以放在文章模块而不是站点目录：`safeCoverReference` 依赖 `path-policy`，而站点配置又
 * 会被路径策略的调用方读取，放进站点目录会形成「站点配置 → 路径策略 → 站点配置」的循环引用。
 */

/**
 * 封面字段：允许空的、安全的 HTTPS 地址，或当前 Page Bundle 内的一张图片。
 *
 * 只接受 `./<image>` 形态的本地引用，并且扩展名必须是图片——避免把 `./index.md` 或
 * `./archive.zip` 之类的东西写成封面，让构建期去解析一个非图片资源。
 */
export function safeCoverReference(maxLength: number) {
	return safeText(maxLength).refine(
		(value) => {
			if (value === "" || isSafeHttpsUrl(value)) return true;
			try {
				const reference = parseArticleResourceReference(value);
				return isArticleAssetImageFilename(reference.slice(2));
			} catch {
				return false;
			}
		},
		{ message: "封面必须是安全的 HTTPS 地址或当前文章目录中的资源。" },
	);
}
