import { describe, expect, it } from "vitest";
import {
	flushBridgeNodeViewMetadata,
	flushBridgeProjection,
	flushMilkdownMarkdown,
	flushValidatedHistory,
	flushWikiLinkInsertion,
	projectCodecToMilkdownMarkdown,
} from "../../src/modules/editor-core/adapters/milkdown/bridge";
import {
	fireflySourceRemarkPlugin,
	transformFireflySourceAst,
} from "../../src/modules/editor-core/adapters/milkdown/firefly-source-node";

describe("隔离 Milkdown bridge source transaction", () => {
	it("Wiki 撤销与重做仅接受曾验证的保护签名", () => {
		const original = projectCodecToMilkdownMarkdown("> [!NOTE] 保留\n> 内容\n\n正文\n");
		const inserted = flushWikiLinkInsertion(
			original,
			`${original.source}\n[[指南/文章|测试]]\n`,
			"[[指南/文章|测试]]",
		);
		expect(flushValidatedHistory([original, inserted], original.source).source).toBe(
			original.source,
		);
		expect(flushValidatedHistory([original, inserted], inserted.source).source).toBe(
			inserted.source,
		);
		expect(() => flushValidatedHistory([original, inserted], "正文\n")).toThrow();
		expect(() =>
			flushValidatedHistory([original, inserted], `${original.source}\n[[其他/链接]]\n`),
		).toThrow();
	});
	it("异步正文和插入片段使用各自的最新占位映射", () => {
		const options = { projection: projectCodecToMilkdownMarkdown("").visualProjection };
		const transform = fireflySourceRemarkPlugin.call({} as never, options);
		if (typeof transform !== "function") throw new Error("缺少 remark transform");
		const source = "> [!NOTE] 标题\n> 异步加载正文\n";
		options.projection = projectCodecToMilkdownMarkdown(source).visualProjection;
		const root = {
			type: "root",
			children: [
				{ type: "blockquote", position: { start: { offset: 0 }, end: { offset: source.length } } },
			],
		};
		transform(root as never, {} as never, () => undefined);
		expect(root.children[0]?.type).toBe("fireflySourceBlock");
		expect((root.children[0] as { data?: Record<string, unknown> }).data?.sourceSlice).toBe(source);
		options.projection = projectCodecToMilkdownMarkdown("普通插入正文").visualProjection;
		const fragment = {
			type: "root",
			children: [{ type: "paragraph", position: { start: { offset: 0 }, end: { offset: 6 } } }],
		};
		transform(fragment as never, {} as never, () => undefined);
		expect(fragment.children[0]?.type).toBe("paragraph");
	});
	it("连续 Enter 的空段落不属于受保护 HTML，可以添加和删除", () => {
		const original = projectCodecToMilkdownMarkdown("正文\n");
		const blankLines = "正文\n\n<br />\n\n<br />\n\n尾文\n";
		const edited = flushMilkdownMarkdown(original, blankLines);
		expect(edited.source).toBe(blankLines);
		expect(edited.opaqueCount).toBe(0);
		expect(flushMilkdownMarkdown(edited, "正文\n\n尾文\n").source).toBe("正文\n\n尾文\n");
	});
	it("仅纯 br 行可编辑，不放开属性、脚本或任意 HTML", () => {
		for (const source of [
			"<br onclick=alert(1)>\n",
			"<br style=position:fixed>\n",
			"<script>alert(1)</script>\n",
			"<div>原文</div>\n",
		]) {
			const protectedBlock = projectCodecToMilkdownMarkdown(source);
			expect(protectedBlock.opaqueCount).toBeGreaterThan(0);
			expect(() => flushMilkdownMarkdown(protectedBlock, "<br />\n")).toThrow(
				"protected source slice",
			);
		}
	});
	it("特殊块内容不变时，可以在前后增加显式空白行", () => {
		const source = "正文\n\n<details>\n<summary>标题</summary>\n\n内容\n</details>\n";
		const original = projectCodecToMilkdownMarkdown(source);
		const updated = source.replace("正文\n", "正文\n\n<br />\n");
		expect(flushMilkdownMarkdown(original, updated).source).toBe(updated);
	});
	it("消费 editor-core projection 并保留原始 source metadata", () => {
		const source = "普通正文\n\n$E=mc^2$\n\n<div>opaque</div>";
		const projection = projectCodecToMilkdownMarkdown(source);

		expect(projection.source).toBe(source);
		expect(projection.visualProjection.source).toBe(source);
		expect(projection.visualProjection.nodes.some((node) => node.category === "placeholder")).toBe(
			true,
		);
		expect(projection.visualProjection.nodes.some((node) => node.category === "opaque")).toBe(true);
		expect(projection.markdown).toBe(source);
		expect(projection.markdown).not.toContain("Firefly Opaque");
	});

	it("把 codec source range 转成受控 AST 节点，而不是 fenced synthetic Markdown", () => {
		const source = "正文\n\n<div>opaque</div>";
		const projection = projectCodecToMilkdownMarkdown(source);
		const root = {
			type: "root" as const,
			children: [
				{ type: "paragraph", position: { start: { offset: 0 }, end: { offset: 2 } } },
				{ type: "html", position: { start: { offset: 4 }, end: { offset: source.length } } },
			],
		};

		transformFireflySourceAst(root, projection.visualProjection);

		expect(root.children[1]?.type).toBe("fireflySourceBlock");
		expect((root.children[1] as { data?: Record<string, unknown> }).data).toMatchObject({
			sourceRangeFrom: 4,
			sourceRangeTo: source.length,
			sourceSlice: "<div>opaque</div>",
			category: "opaque",
			editable: false,
		});
	});

	it("只把 structured 节点编辑回写到原始 Markdown", () => {
		const original = projectCodecToMilkdownMarkdown("普通正文\n\n$E=mc^2$\n\n<div>opaque</div>");
		const editedVisualProjection = {
			...original.visualProjection,
			nodes: original.visualProjection.nodes.map((node, index) =>
				index === 0 && node.category === "structured"
					? { ...node, sourceSlice: "修改后的正文" }
					: node,
			),
		};
		const edited = { ...original, visualProjection: editedVisualProjection };
		const flushed = flushBridgeProjection(original, edited);

		expect(flushed.source).toContain("修改后的正文");
		expect(flushed.source).toContain("$E=mc^2$");
		expect(flushed.source).toContain("<div>opaque</div>");
	});

	it("拒绝通过 bridge 修改 placeholder 或 opaque source slice", () => {
		const original = projectCodecToMilkdownMarkdown("正文\n\n<div>opaque</div>");
		const editedVisualProjection = {
			...original.visualProjection,
			nodes: original.visualProjection.nodes.map((node) =>
				node.category === "opaque" ? { ...node, sourceSlice: "篡改" } : node,
			),
		};

		expect(() =>
			flushBridgeProjection(original, { ...original, visualProjection: editedVisualProjection }),
		).toThrow("read-only");
	});

	it("校验真实 NodeView attrs 后仍返回原始 source", () => {
		const source = "正文\n\n<div>opaque</div>";
		const original = projectCodecToMilkdownMarkdown(source);
		const node = original.visualProjection.nodes.find((item) => item.category === "opaque");
		if (node?.category !== "opaque") throw new Error("opaque fixture missing");
		const flushed = flushBridgeNodeViewMetadata(original, [
			{
				sourceRangeFrom: node.sourceRange.from,
				sourceRangeTo: node.sourceRange.to,
				sourceSlice: node.sourceSlice,
				category: "opaque",
				kind: "opaque",
				editable: false,
			},
		]);
		expect(flushed.source).toBe(source);
	});

	it("把 Milkdown serializer 的普通结构化 Markdown 回写为新的 source projection", () => {
		const original = projectCodecToMilkdownMarkdown("# 原标题\n\n普通正文\n\n<div>opaque</div>");
		const flushed = flushMilkdownMarkdown(
			original,
			"# 新标题\n\n修改后的正文\n\n<div>opaque</div>",
		);

		expect(flushed.source).toBe("# 新标题\n\n修改后的正文\n\n<div>opaque</div>");
		expect(flushed.visualProjection.nodes.some((node) => node.category === "opaque")).toBe(true);
	});

	it("拒绝 Milkdown serializer 删除或篡改受保护 source slice", () => {
		const original = projectCodecToMilkdownMarkdown("正文\n\n<div>opaque</div>");

		expect(() => flushMilkdownMarkdown(original, "正文")).toThrow("protected source slice");
		expect(() => flushMilkdownMarkdown(original, "正文\n\n<div>tampered</div>")).toThrow(
			"protected source slice",
		);
	});

	it("生产 bridge 保持普通 Markdown 可编辑且特殊源码只读", () => {
		const original = projectCodecToMilkdownMarkdown(
			"# 标题\n\n普通正文\n\n<div>opaque</div>\n\n> [!NOTE] 提示\n> 内容",
		);
		const serialized = flushMilkdownMarkdown(
			original,
			"# 新标题\n\n更新正文\n\n<div>opaque</div>\n\n> [!NOTE] 提示\n> 内容",
		);
		expect(serialized.source).toContain("# 新标题");
		expect(serialized.source).toContain("更新正文");
		expect(serialized.source).toContain("<div>opaque</div>");
		expect(serialized.source).toContain("> [!NOTE] 提示");
	});

	it("覆盖列表和链接编辑，同时保留受保护源码", () => {
		const original = projectCodecToMilkdownMarkdown(
			"# 清单\n\n- 第一项\n- 第二项 [旧链接](https://example.com/old)\n\n<div>opaque</div>",
		);
		const flushed = flushMilkdownMarkdown(
			original,
			"# 更新清单\n\n- 第二项 [新链接](https://example.com/new)\n- 新增项目\n\n<div>opaque</div>",
		);

		expect(flushed.source).toContain("[新链接](https://example.com/new)");
		expect(flushed.source).not.toContain("第一项");
		expect(flushed.source).toContain("<div>opaque</div>");
	});

	it("允许结构化块增删和重排，但不允许新增受保护源码", () => {
		const original = projectCodecToMilkdownMarkdown("第一段\n\n<div>opaque</div>\n\n第二段");
		const reordered = flushMilkdownMarkdown(
			original,
			"新增段落\n\n第二段\n\n<div>opaque</div>\n\n第一段",
		);

		expect(reordered.source).toBe("新增段落\n\n第二段\n\n<div>opaque</div>\n\n第一段");
		expect(() =>
			flushMilkdownMarkdown(original, '第一段\n\n<div>opaque</div>\n\n<iframe src="x"></iframe>'),
		).toThrow("protected source slice");
	});
});
