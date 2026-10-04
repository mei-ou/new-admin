import { env } from "cloudflare:workers";
import type { APIRoute } from "astro";
import { handleUploadImageBedImage } from "../../../modules/media/api/upload-imagebed-image";

export const prerender = false;

export const POST: APIRoute = ({ request, locals }) =>
	handleUploadImageBedImage({
		request,
		requestId: locals.requestId,
		principal: locals.principal,
		env,
	});
