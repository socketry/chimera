import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
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

test("passes streamed subresource responses through without buffering", async () => {
	const body = new PassThrough();
	const response = await handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/plain; charset=utf-8"},
		body,
	}), {
		path: "/events",
		request: new Request("https://chimera.local/events"),
	});

	body.write("one");
	body.end(" two");

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
	assert.equal(await response.text(), "one two");
});

test("ignores stream chunks after a subresource response is cancelled", async () => {
	const body = new PassThrough();
	const response = await handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/plain; charset=utf-8"},
		body,
	}), {
		path: "/events",
		request: new Request("https://chimera.local/events"),
	});

	await response.body.cancel();

	assert.doesNotThrow(() => {
		body.write("late");
		body.end();
	});
});

test("streams text document responses without buffering", async () => {
	const body = new PassThrough();
	const responsePromise = handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/plain; charset=utf-8"},
		body,
	}), {
		path: "/",
		request: {
			method: "GET",
			headers: new Headers(),
			destination: "document",
			mode: "navigate",
		},
	});

	const response = await Promise.race([
		responsePromise,
		new Promise((resolve) => setTimeout(() => resolve(null), 50)),
	]);
	
	assert.ok(response, "text document responses should resolve before the body finishes");
	body.write("hello");
	body.end(" stream");

	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
	assert.equal(await response.text(), "hello stream");
});

test("streams html document responses without buffering", async () => {
	const body = new PassThrough();
	const documents = [];
	const responsePromise = handleRequest(createClient({
		status: 200,
		headers: {"content-type": "text/html; charset=utf-8"},
		body,
	}), {
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
	
	const response = await Promise.race([
		responsePromise,
		new Promise((resolve) => setTimeout(() => resolve(null), 50)),
	]);
	
	assert.ok(response, "HTML document responses should resolve before the body finishes");
	body.write("<h1>Hello");
	body.end(" stream</h1>");
	
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
	assert.equal(await response.text(), "<h1>Hello stream</h1>");
	assert.equal(documents.length, 1);
	assert.equal(documents[0].document.mode, "html");
	assert.equal(documents[0].document.body, null);
});

test("passes document requests through and reports document metadata", async () => {
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
	assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
	assert.equal(await response.text(), "hello");
	assert.equal(documents.length, 1);
	assert.equal(documents[0].surface, surface);
	assert.equal(documents[0].path, "/");
	assert.equal(documents[0].document.mode, "native");
	assert.equal(documents[0].document.body, null);
});
