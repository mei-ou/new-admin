import { type AuditWriter, writeAuditEvent } from "../../../core/audit/audit-log";
import { requireAdminCapability } from "../../../core/config/capabilities";
import { guardModule } from "../../../core/config/feature-flags";
import { readBoundedBody } from "../../../core/http/bounded-body";
import { ApiError } from "../../../core/http/errors";
import { jsonResponse } from "../../../core/http/response";
import { enforceRateLimit } from "../../../core/security/rate-limit";
import {
	loadImageBedConfig,
	uploadImageToImageBed,
} from "../../../providers/images/imagebed-provider";
import type { AuthenticatedPrincipal, RuntimeEnv } from "../../../types/env";
import { IMAGEBED_IMAGE_MAX_BYTES, validateImageBedFile } from "../imagebed-config";
import {
	isMediaFilenameCompatible,
	isMediaStagingContentType,
	matchesMediaSignature,
} from "../media-config";

export interface UploadImageBedRequestContext {
	request: Request;
	requestId: string;
	principal: AuthenticatedPrincipal | undefined;
	env: RuntimeEnv;
}

export async function handleUploadImageBedImage(
	context: UploadImageBedRequestContext,
	dependencies: { fetch?: typeof fetch; auditWriter?: AuditWriter } = {},
): Promise<Response> {
	guardModule("media");
	if (!context.principal) throw new ApiError(401, "AUTH_REQUIRED", "需要登录后才能上传图片。");
	requireAdminCapability(context.env, "imageBedUpload");
	const config = loadImageBedConfig(context.env);
	await enforceRateLimit(context.env.RATE_LIMITER, context.principal.sub, "image-upload");
	const contentType = context.request.headers.get("Content-Type") ?? "";
	if (!/^multipart\/form-data\s*;/i.test(contentType)) {
		throw new ApiError(415, "INVALID_REQUEST", "请使用文件上传表单。");
	}
	const maxRequestBytes = IMAGEBED_IMAGE_MAX_BYTES + 64 * 1024;
	const declaredLength = context.request.headers.get("Content-Length");
	if (
		declaredLength !== null &&
		(!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(Number(declaredLength)))
	) {
		throw new ApiError(400, "INVALID_REQUEST", "上传请求大小无效。");
	}
	if (declaredLength !== null && Number(declaredLength) > maxRequestBytes) {
		throw new ApiError(413, "INVALID_REQUEST", "上传图片不能超过 5 MiB。");
	}
	const bytes = await readBoundedBody(context.request.body, maxRequestBytes);
	let form: FormData;
	try {
		form = await new Response(bytes as Uint8Array<ArrayBuffer>, {
			headers: { "Content-Type": contentType },
		}).formData();
	} catch {
		throw new ApiError(400, "INVALID_REQUEST", "上传表单无效。");
	}
	if ([...form.keys()].length !== 1 || form.getAll("file").length !== 1) {
		throw new ApiError(400, "INVALID_REQUEST", "上传表单必须只包含一个文件。");
	}
	const file = form.get("file");
	if (!(file instanceof File)) throw new ApiError(400, "INVALID_REQUEST", "上传表单缺少图片。");
	try {
		validateImageBedFile(file);
	} catch {
		throw new ApiError(
			file.size === 0 || file.size > IMAGEBED_IMAGE_MAX_BYTES ? 413 : 415,
			"INVALID_REQUEST",
			"图片必须为 JPEG、PNG 或 WebP，非空且不超过 5 MiB。",
		);
	}
	if (
		!isMediaStagingContentType(file.type) ||
		!isMediaFilenameCompatible(file.name, file.type) ||
		!matchesMediaSignature(new Uint8Array(await file.slice(0, 16).arrayBuffer()), file.type)
	) {
		throw new ApiError(415, "INVALID_REQUEST", "图片内容、扩展名与声明格式不一致。");
	}
	const url = await uploadImageToImageBed(file, config, dependencies.fetch);
	writeAuditEvent(
		{
			requestId: context.requestId,
			subject: context.principal.sub,
			action: "media.imagebed-upload",
			outcome: "success",
			timestamp: new Date().toISOString(),
			metadata: { size: file.size, contentType: file.type },
		},
		dependencies.auditWriter,
	);
	return jsonResponse({ image: { url } }, 201);
}
