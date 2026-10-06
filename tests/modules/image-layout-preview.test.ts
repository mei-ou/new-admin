import { describe, expect, it } from "vitest";
import { readImageLayoutPreview } from "../../src/modules/editor-core/adapters/milkdown/image-layout-preview";

describe("图片布局预览安全解析", () => {
	it.each(["single", "grid", "swipe", "adaptive"])("支持 %s 布局，不改写源数据", (layout) => {
		const data = {
			layout,
			width: 50,
			align: "center",
			columns: 2,
			images: [
				{ src: "https://pic.example.com/file/a.png", alt: "<script>文字</script>", title: "说明" },
			],
		};
		const source = `\u0060\u0060\u0060image-layout\n${JSON.stringify(data)}\n\u0060\u0060\u0060\n`;
		expect(readImageLayoutPreview(source)).toEqual(data);
	});
	it.each([
		"javascript:alert(1)",
		"data:image/svg+xml,test",
		"//other.example/a.png",
		"https://user:pass@pic.example.com/a.png",
	])("不加载危险来源 %s", (src) => {
		const source = `\u0060\u0060\u0060image-layout\n${JSON.stringify({ layout: "single", width: 100, align: "center", columns: 3, images: [{ src }] })}\n\u0060\u0060\u0060`;
		expect(readImageLayoutPreview(source)).toBeUndefined();
	});
	it.each(["```image-layout\n{}\n```", "```js\n{}\n```", "<script>alert(1)</script>"])(
		"异常源码保持占位 %s",
		(source) => {
			expect(readImageLayoutPreview(source)).toBeUndefined();
		},
	);
});
