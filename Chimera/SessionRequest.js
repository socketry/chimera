import {handleRequest as handleSurfaceRequest} from "./SurfaceRequest.js";
import {responseBodyStream} from "./StreamAdapters.js";

function responseContentType(response) {
	return response.headers?.get?.("content-type")
		?? response.headers?.["content-type"]
		?? response.headers?.["Content-Type"]
		?? "text/plain";
}

function responseSummary(response) {
	return {
		status: response.status,
		headers: response.headers,
	};
}

function documentSummary(response) {
	const contentType = responseContentType(response);
	const mimeType = contentType.split(";")[0].trim().toLowerCase();
	
	return {
		mode: mimeType === "text/html" ? "html" : "native",
		contentType,
		displayContentType: contentType,
		body: null,
	};
}

export async function handleRequest(client, {surface, path, request, onDocument}) {
	const response = await handleSurfaceRequest(client, {path, request});
	const isDocumentRequest = request.destination === "document" || request.mode === "navigate";

	if (isDocumentRequest) {
		onDocument?.({surface, path, response: responseSummary(response), document: documentSummary(response)});
	}
	
	return new Response(responseBodyStream(response.body), {
		status: response.status,
		headers: response.headers,
	});
}
