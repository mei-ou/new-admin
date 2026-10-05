import { type ContentTypeConfig, type FieldKind, resolveFieldDefault } from "../../sites/types";
import type { StorageIdPolicy } from "../../utils/slug-utils";

export interface EditorFieldConfig {
	key: string;
	label: string;
	kind: FieldKind;
	required: boolean;
	defaultValue: unknown;
}

export interface ArticleEditorConfig {
	siteId: string;
	typeId: string;
	filenamePolicy: StorageIdPolicy;
	allowCategoryPath: boolean;
	pathStrategy: "flat" | "pageBundle";
	fields: EditorFieldConfig[];
}

export function createArticleEditorConfig(
	siteId: string,
	type: ContentTypeConfig,
): ArticleEditorConfig {
	return {
		siteId,
		typeId: type.id,
		filenamePolicy: type.filenamePolicy,
		allowCategoryPath: type.allowCategoryPath,
		pathStrategy: type.pathStrategy,
		fields: type.fields.map((field) => ({
			key: field.key,
			label: field.label,
			kind: field.kind,
			required: !field.validation.safeParse(undefined).success,
			defaultValue: resolveFieldDefault(field),
		})),
	};
}
