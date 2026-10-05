import { Schema } from "@milkdown/kit/prose/model";
import { AllSelection, EditorState, TextSelection } from "@milkdown/kit/prose/state";
import { describe, expect, it } from "vitest";
import {
	createVisualTextReplacement,
	readVisualSelection,
} from "../../src/modules/editor-core/adapters/milkdown/selection";

const schema = new Schema({
	nodes: {
		doc: { content: "paragraph+" },
		paragraph: { content: "text*" },
		text: { inline: true },
	},
});
function state(text = "你好") {
	const doc = schema.node("doc", null, [schema.node("paragraph", null, schema.text(text))]);
	return EditorState.create({ doc, selection: TextSelection.create(doc, 1, 3) });
}
describe("可视化选区", () => {
	it("直接读取 ProseMirror 选区而不是 CodeMirror main", () => {
		expect(readVisualSelection(state())).toEqual({ from: 1, to: 3, text: "你好" });
	});
	it("插入较长内容后光标属于新文档，避免旧文档越界", () => {
		const transaction = createVisualTextReplacement(state(), "很长的插入内容", 1, 3);
		expect(transaction.doc.textContent).toBe("很长的插入内容");
		expect(transaction.selection.$from.doc).toBe(transaction.doc);
		expect(transaction.selection.from).toBe(1 + "很长的插入内容".length);
	});
	it("从全选状态替换文本也得到有效文本选区", () => {
		const current = state();
		const selected = current.apply(current.tr.setSelection(new AllSelection(current.doc)));
		const transaction = createVisualTextReplacement(selected, "替换内容", 1, 3, 0, 4);
		expect(transaction.selection).toBeInstanceOf(TextSelection);
		expect(transaction.selection.$from.doc).toBe(transaction.doc);
	});
});
