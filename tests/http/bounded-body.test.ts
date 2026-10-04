import { describe, expect, it, vi } from "vitest";
import { readBoundedBody } from "../../src/core/http/bounded-body";

describe("有界请求体读取", () => {
	it("合并分块且允许恰好到达上限", async () => {
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2]));
				controller.enqueue(new Uint8Array([3]));
				controller.close();
			},
		});
		expect(await readBoundedBody(body, 3)).toEqual(new Uint8Array([1, 2, 3]));
		expect(body.locked).toBe(false);
	});

	it("实际字节超限时取消流并释放锁", async () => {
		const cancel = vi.fn();
		const body = new ReadableStream<Uint8Array>({
			start(controller) {
				controller.enqueue(new Uint8Array([1, 2, 3]));
			},
			cancel,
		});
		await expect(readBoundedBody(body, 2)).rejects.toMatchObject({ status: 413 });
		expect(cancel).toHaveBeenCalledOnce();
		expect(body.locked).toBe(false);
	});

	it("缺失请求体返回空内容", async () => {
		expect(await readBoundedBody(null, 10)).toEqual(new Uint8Array());
	});
});
