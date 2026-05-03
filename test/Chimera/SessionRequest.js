import assert from "node:assert/strict";
import test from "node:test";

import {handleRequest} from "../../Chimera/SessionRequest.js";

function createClient(response) {
	return {
		request() {
			return response;
		},
	};
}

test("passes subresource responses through without document wrapping", async () => {
	const response = await handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/javascript; charset=utf-8"},
		body: "export default 1;",
	}), {
		path: "/assets/app.js",
		request: new Request("https://chimera.local/assets/app.js"),
	});

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/javascript; charset=utf-8");
	assert.equal(await response.text(), "export default 1;");
});

test("wraps document requests and reports document metadata", async () => {
	const documents = [];
	const surface = {id: "surface-1"};
	const response = await handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/plain; charset=utf-8"},
		body: "hello",
	}), {
		surface,
		path: "/",
		request: {
			method: "GET",
			headers: new Headers(),
			destination: "document",
			mode: "navigate",
		},
		onDocument(document) {
			documents.push(document);
		},
	});

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	assert.match(await response.text(), /<pre>hello<\/pre>/);
	assert.equal(documents.length, 1);
	assert.equal(documents[0].surface, surface);
	assert.equal(documents[0].path, "/");
	assert.equal(documents[0].document.mode, "text");
});
