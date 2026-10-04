export const adminCapabilityKeys = [
	"articleLinks",
	"externalHttpsLinks",
	"smallImageUpload",
	"imageBedUpload",
	"coverManagement",
	"articleDelete",
	"pdfAttachmentUpload",
	"articleAssetDetails",
	"articleAssetRename",
	"repositoryBrowser",
	"crossArticleAssetMove",
	"articleAssetReplace",
	"singleAssetDelete",
] as const;

export type AdminCapabilityKey = (typeof adminCapabilityKeys)[number];
export type AdminCapabilityReleaseState = "available" | "frozen" | "unreleased";
export type AdminCapabilitySnapshot = Readonly<Record<AdminCapabilityKey, boolean>>;
