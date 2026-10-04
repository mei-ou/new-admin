import { validateImageBedFile } from "../../modules/media/imagebed-config";
import { parseRemoteImageUrl } from "./markdown-target-validation";

export async function uploadImageBedImage(file: File, signal?: AbortSignal): Promise<string> {
	validateImageBedFile(file);
	const body = new FormData();
	body.set("file", file);
	const response = await fetch("/api/images/upload", {
		method: "POST",
		headers: { "X-Firefly-Admin": "1" },
		body,
		...(signal === undefined ? {} : { signal }),
	});
	let payload: unknown;
	try {
		payload = await response.json();
	} catch {
		throw new Error("图床上传响应无效，请稍后重试。");
	}
	if (!response.ok) {
		const error =
			payload && typeof payload === "object" && "error" in payload ? payload.error : undefined;
		const message =
			error && typeof error === "object" && "message" in error && typeof error.message === "string"
				? error.message
				: "图床上传失败，请稍后重试。";
		throw new Error(message);
	}
	const image =
		payload && typeof payload === "object" && "image" in payload ? payload.image : undefined;
	if (!image || typeof image !== "object" || !("url" in image))
		throw new Error("图床未返回图片链接。");
	return parseRemoteImageUrl(image.url);
}
