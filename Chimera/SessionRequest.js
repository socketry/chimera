import {browserDocumentForResponse} from "./BrowserSurface.js";
import {handleRequest as handleSurfaceRequest} from "./SurfaceRequest.js";

export async function handleRequest(client, {surface, path, request, onDocument}) {
	const response = await handleSurfaceRequest(client, {path, request});
	const isDocumentRequest = request.destination === "document" || request.mode === "navigate";

	if (!isDocumentRequest) {
		return new Response(response.body, {
			status: response.status,
			headers: response.headers,
		});
	}

	const document = browserDocumentForResponse(response);
	onDocument?.({surface, path, response, document});
	return new Response(document.body, {
		status: response.status,
		headers: {
			...response.headers,
			"content-type": document.contentType,
		},
	});
}
