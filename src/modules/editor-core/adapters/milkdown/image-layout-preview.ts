import {
	parseImageLayout,
	type ImageLayout,
} from "../../../../../integrations/newfirefly/image-layout.mjs";

export function readImageLayoutPreview(source: string): ImageLayout | undefined {
	const lines = source.trim().split(/\r?\n/);
	if (!/^(`{3,}|~{3,})image-layout\s*$/.test(lines[0] ?? "")) return undefined;
	return parseImageLayout(lines.slice(1, -1).join("\n"));
}

export function createImageLayoutPreview(source: string): HTMLElement | undefined {
	const fields = readImageLayoutPreview(source);
	if (!fields) return undefined;
	const preview = document.createElement("div");
	preview.className = "custom-md firefly-image-preview";
	const layout = document.createElement("div");
	layout.className = `admin-image-layout admin-images-${fields.layout} admin-image-width-${fields.width} admin-image-align-${fields.align} admin-image-columns-${fields.columns}`;
	layout.setAttribute("aria-label", fields.layout === "single" ? "图片预览" : "图片组预览");
	if (fields.layout === "swipe" || fields.layout === "adaptive") layout.tabIndex = 0;
	for (const item of fields.images) {
		const figure = document.createElement("figure");
		figure.className = "admin-image-item";
		const image = document.createElement("img");
		image.alt = item.alt;
		image.title = item.title;
		image.referrerPolicy = "no-referrer";
		image.draggable = false;
		const failure = document.createElement("p");
		failure.hidden = true;
		failure.textContent = "图片暂时无法加载，请检查直链、图床防盗链规则或后台图片来源限制。";
		image.addEventListener("error", () => {
			image.hidden = true;
			failure.hidden = false;
		});
		image.src = item.src;
		figure.appendChild(image);
		figure.appendChild(failure);
		if (item.alt) {
			const caption = document.createElement("figcaption");
			caption.textContent = item.alt;
			figure.appendChild(caption);
		}
		layout.appendChild(figure);
	}
	preview.appendChild(layout);
	return preview;
}
