export const IMAGEBED_IMAGE_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGEBED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

export function validateImageBedFile(file: File): void {
	if (file.size === 0 || file.size > IMAGEBED_IMAGE_MAX_BYTES) {
		throw new TypeError("图片必须非空且不能超过 5 MiB。");
	}
	if (!(IMAGEBED_IMAGE_TYPES as readonly string[]).includes(file.type)) {
		throw new TypeError("图床上传仅支持 JPEG、PNG 和 WebP 图片。");
	}
}
