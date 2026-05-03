import assert from "node:assert/strict";
import test from "node:test";

import {handleRequest} from "../../Chimera/SurfaceRequest.js";

function createClient(onRequest) {
	return {request: onRequest};
}

test("forwards surface request method, headers, path and body", async () => {
	const forwarded = [];
	const client = createClient((request) => {
		forwarded.push(request);
		return {status: 201, headers: {"content-type": "text/plain"}, body: "ok"};
	});

	const response = await handleRequest(client, {
		path: "/submit",
		request: new Request("https://chimera.local/submit", {
			method: "POST",
			headers: {
				"content-type": "text/plain",
				"x-test": "yes",
			},
			body: "hello",
		}),
	});

	assert.deepEqual(response, {status: 201, headers: {"content-type": "text/plain"}, body: "ok"});
	assert.equal(forwarded.length, 1);
	assert.equal(forwarded[0].path, "/submit");
	assert.equal(forwarded[0].method, "POST");
	assert.equal(forwarded[0].headers["content-type"], "text/plain");
	assert.equal(forwarded[0].headers["x-test"], "yes");
	assert.equal(forwarded[0].body, "hello");
});

test("does not read a body for GET surface requests", async () => {
	const forwarded = [];
	const client = createClient((request) => {
		forwarded.push(request);
		return {status: 200, headers: {}, body: ""};
	});

	await handleRequest(client, {
		path: "/",
		request: new Request("https://chimera.local/", {
			method: "GET",
		}),
	});

	assert.equal(forwarded.length, 1);
	assert.equal(forwarded[0].method, "GET");
	assert.equal(forwarded[0].body, undefined);
});
