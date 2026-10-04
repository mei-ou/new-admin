import { ApiError } from "./errors";

export async function readBoundedBody(
	body: ReadableStream<Uint8Array> | null,
	maxBytes: number,
): Promise<Uint8Array> {
	if (!body) return new Uint8Array();
	const reader = body.getReader();
	const chunks: Uint8Array[] = [];
	let totalBytes = 0;
	try {
		while (true) {
			const result = await reader.read();
			if (result.done) break;
			totalBytes += result.value.byteLength;
			if (totalBytes > maxBytes) {
				await reader.cancel();
				throw new ApiError(413, "INVALID_REQUEST", "请求内容超过大小限制。");
			}
			chunks.push(result.value);
		}
	} finally {
		reader.releaseLock();
	}
	const bytes = new Uint8Array(totalBytes);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return bytes;
}
