import {Readable} from "node:stream";

import {browserDocumentForResponse} from "./BrowserSurface.js";
import {handleRequest as handleSurfaceRequest} from "./SurfaceRequest.js";

async function responseBodyText(body) {
	if (body == null) {
		return "";
	}

	if (typeof body === "string") {
		return body;
	}

	if (body instanceof Uint8Array) {
		return Buffer.from(body).toString("utf8");
	}

	if (typeof body.getReader === "function") {
		return new Response(body).text();
	}

	if (typeof body[Symbol.asyncIterator] === "function") {
		const chunks = [];
		for await (const chunk of body) {
			chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		}
		return Buffer.concat(chunks).toString("utf8");
	}

	return String(body);
}

function responseBodyStream(body) {
	if (body == null || typeof body === "string" || body instanceof Uint8Array || typeof body.getReader === "function") {
		return body;
	}

	if (typeof body.pipe === "function") {
		return Readable.toWeb(body);
	}

	return body;
}

export async function handleRequest(client, {surface, path, request, onDocument}) {
	const response = await handleSurfaceRequest(client, {path, request});
	const isDocumentRequest = request.destination === "document" || request.mode === "navigate";

	if (!isDocumentRequest) {
		return new Response(responseBodyStream(response.body), {
			status: response.status,
			headers: response.headers,
		});
	}

	const bufferedResponse = {
		...response,
		body: await responseBodyText(response.body),
	};
	const document = browserDocumentForResponse(bufferedResponse);
	onDocument?.({surface, path, response, document});
	return new Response(document.body, {
		status: response.status,
		headers: {
			...response.headers,
			"content-type": document.contentType,
		},
	});
}
