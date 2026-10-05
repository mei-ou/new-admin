import { type EditorState, TextSelection } from "@milkdown/kit/prose/state";

export function readVisualSelection(state: EditorState) {
	const { from, to } = state.selection;
	return { from, to, text: state.doc.textBetween(from, to, "\n") };
}

export function createVisualTextReplacement(
	state: EditorState,
	text: string,
	from: number,
	to: number,
	selectionFrom = text.length,
	selectionTo = selectionFrom,
) {
	const safeFrom = Math.max(0, Math.min(from, state.doc.content.size));
	const safeTo = Math.max(safeFrom, Math.min(to, state.doc.content.size));
	const transaction = state.tr.insertText(text, safeFrom, safeTo);
	const anchor = Math.max(0, Math.min(safeFrom + selectionFrom, transaction.doc.content.size));
	const head = Math.max(0, Math.min(safeFrom + selectionTo, transaction.doc.content.size));
	return transaction.setSelection(TextSelection.create(transaction.doc, anchor, head));
}
