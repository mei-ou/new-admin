export { createCodeMirrorAdapter } from "./adapters/codemirror-adapter";
export type {
	EditorAdapter,
	EditorAdapterInput,
	EditorSurface,
	VisualEditorSurface,
} from "./adapters/editor-adapter";
export { createVisualEditorAdapter } from "./adapters/visual-adapter";
export {
	assertEditorCommandAvailable,
	EDITOR_COMMAND_DEFINITIONS,
	getEditorCommandDefinition,
} from "./capability-registry";
export type { EditorVisualProjection, EditorVisualProjectionNode } from "./projection";
export {
	applyEditorVisualProjectionChanges,
	createEditorVisualProjection,
	createEditorVisualProjectionFromDocument,
} from "./projection";
export type { CreateEditorSessionInput, EditorSession } from "./session";
export { createEditorSession } from "./session";
export type {
	BuildEditorSourceDocumentInput,
	EditorSourceDocument,
	EditorSourceParseResult,
} from "./source-document";
export {
	buildEditorSourceDocument,
	parseEditorSourceDocument,
	tryParseEditorSourceDocument,
} from "./source-document";
export type {
	EditorAdapterFlush,
	EditorCommandDefinition,
	EditorCommandStatus,
	EditorDocumentSnapshot,
	EditorMode,
} from "./types";
