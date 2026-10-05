import { describe, expect, it } from "vitest";
import {
	createSpecialBlock,
	insertSpecialBlock,
	listSpecialBlocks,
	readSpecialBlock,
	replaceSpecialBlock,
	type SpecialBlockKind,
} from "../../src/components/articles/special-block-state";

describe("特殊块表单", () => {
	const cases: [SpecialBlockKind, string][] = [
		["callout", "第一行\n\n第三行"],
		["details", "折叠正文"],
		["math-block", "E = mc^2"],
		["math-inline", "x^2"],
		["mermaid", "flowchart LR\n A --> B"],
		["video", ""],
	];
	it.each(cases)("%s 自动生成受支持格式并回填", (kind, body) => {
		const fields = {
			...readSpecialBlock(),
			kind,
			body,
			title: kind === "details" || kind === "callout" ? "中文标题" : "",
			videoId: "dQw4w9WgXcQ",
		};
		const source = createSpecialBlock(fields);
		const node = listSpecialBlocks(source)[0];
		expect(node).toBeDefined();
		const restored = readSpecialBlock(node);
		expect(restored.kind).toBe(kind);
		if (kind === "video") expect(restored.videoId).toBe(fields.videoId);
		else expect(restored.body.trimEnd()).toBe(body);
		expect(createSpecialBlock(restored)).toBe(source);
	});
	it("支持默认展开的折叠内容和 B 站视频", () => {
		const details = createSpecialBlock({
			...readSpecialBlock(),
			kind: "details",
			title: "查看",
			body: "正文",
			open: true,
		});
		expect(readSpecialBlock(listSpecialBlocks(details)[0]).open).toBe(true);
		const video = createSpecialBlock({
			...readSpecialBlock(),
			kind: "video",
			provider: "bilibili",
			videoId: "BV1xx411c7mD",
		});
		expect(readSpecialBlock(listSpecialBlocks(video)[0]).provider).toBe("bilibili");
	});
	it("仅替换指定块，保留中文、换行和其他受保护块", () => {
		const block = createSpecialBlock({ ...readSpecialBlock(), body: "原文" });
		const before = "中文😀\r\n\r\n";
		const after = "\r\n<custom>原样保留</custom>\r\n";
		const original = before + block + after;
		const node = listSpecialBlocks(original)[0];
		if (!node) throw new Error("缺少测试块");
		const replacement = createSpecialBlock({ ...readSpecialBlock(node), body: "新内容" });
		expect(replaceSpecialBlock(original, node, replacement)).toBe(before + replacement + after);
		expect(() => replaceSpecialBlock(`变化${original}`, node, replacement)).toThrow("正文已变化");
	});
	it("拒绝注入标题、危险 HTML、无效视频号和逃逸分隔符", () => {
		for (const fields of [
			{ ...readSpecialBlock(), title: "<script>" },
			{ ...readSpecialBlock(), body: "<img src=x onerror=alert(1)>" },
			{ ...readSpecialBlock(), kind: "details" as const, body: "<script>alert(1)</script>" },
			{ ...readSpecialBlock(), kind: "video" as const, videoId: 'bad" onload=alert(1)' },
			{ ...readSpecialBlock(), kind: "math-block" as const, body: "x\n$$\n\n正文" },
			{ ...readSpecialBlock(), calloutType: "FAKE" },
		])
			expect(() => createSpecialBlock(fields)).toThrow();
	});
	it("源码插入不覆盖已有特殊块，选区和中文偏移正确", () => {
		const block = createSpecialBlock({ ...readSpecialBlock(), body: "保留" });
		const source = `中文😀\n\n${block}\n尾文`;
		const node = listSpecialBlocks(source)[0];
		if (!node) throw new Error("缺少测试块");
		expect(insertSpecialBlock(source, 0, 2, block)).toBe(`\n\n${block}\n\n😀\n\n${block}\n尾文`);
		expect(() =>
			insertSpecialBlock(source, node.range.from + 1, node.range.from + 1, block),
		).toThrow("特殊块内");
		expect(() => insertSpecialBlock(source, 0, node.range.to, block)).toThrow("特殊块内");
		expect(() => insertSpecialBlock(source, -1, 0, block)).toThrow("插入位置无效");
	});
});
