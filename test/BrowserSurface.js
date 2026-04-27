import test from "node:test";
import assert from "node:assert/strict";
import {BootstrapDecoder, Client, HTTY_BOOTSTRAP_IDENTIFIER, SESSION_STATUS, Transport, encodeBootstrap} from "@socketry/htty";
import {normalizeRequestHeaders, sanitizeResponseHeaders} from "@socketry/htty/HTTP";
import {Session} from "@socketry/htty/Session";

import {browserDocumentForResponse} from "../Chimera/BrowserSurface.js";
import {installHttyBootstrapHandler} from "../Chimera/HTTYBootstrap.js";

	test("reports bootstrap boundaries without losing terminal text", () => {
	const decoder = new BootstrapDecoder();
	const trailingBytes = Buffer.from([0x00, 0xff, 0x41]).toString("latin1");
	const result = decoder.push(`hello${encodeBootstrap()}${trailingBytes}`);

	assert.equal(result.beforeBootstrap, "hello");
	assert.equal(result.afterBootstrap, trailingBytes);
	assert.deepEqual(result.bootstraps, [{mode: "raw"}]);
});

test("preserves non-HTTY terminal output", () => {
	const decoder = new BootstrapDecoder();
	const {plainText, beforeBootstrap, afterBootstrap} = decoder.push("hello world");

	assert.equal(plainText, "hello world");
	assert.equal(beforeBootstrap, "hello world");
	assert.equal(afterBootstrap, "");
});

	test("buffers incomplete HTTY bootstraps", () => {
	const decoder = new BootstrapDecoder();
	const encodedBootstrap = encodeBootstrap();

	const first = decoder.push(encodedBootstrap.slice(0, 4));
	assert.equal(first.plainText, "");
	assert.equal(first.bootstraps.length, 0);

	const second = decoder.push(encodedBootstrap.slice(4));
	assert.equal(second.bootstraps.length, 1);
	assert.deepEqual(second.bootstraps[0], {mode: "raw"});
});

test("writes raw bytes through the duplex transport", async () => {
	const writes = [];
	const duplex = new Transport((chunk) => writes.push(chunk));

	duplex.write(Buffer.from("hello"));
	duplex.end();

	assert.equal(writes.length, 1);
	assert.equal(writes[0].toString("latin1"), "hello");
});

test("registers an xterm DCS handler for the HTTY bootstrap", () => {
	let registeredIdentifier = null;
	let registeredCallback = null;
	const bootstraps = [];

	const disposable = installHttyBootstrapHandler({
		parser: {
			registerDcsHandler(identifier, callback) {
				registeredIdentifier = identifier;
				registeredCallback = callback;
				return {
					dispose() {
						registeredCallback = null;
					},
				};
			},
		},
	}, (bootstrap) => {
		bootstraps.push(bootstrap);
	});

	assert.deepEqual(registeredIdentifier, HTTY_BOOTSTRAP_IDENTIFIER);
	assert.equal(registeredCallback("raw", []), true);
	assert.deepEqual(bootstraps, [{mode: "raw"}]);
	assert.equal(registeredCallback("framed", []), false);

	disposable.dispose();
	assert.equal(registeredCallback, null);
});

	test("accepts raw transport bytes into the duplex transport", async () => {
	const duplex = new Transport(() => {});

	const payload = await new Promise((resolve) => {
		duplex.once("data", (chunk) => resolve(chunk.toString("utf8")));
		duplex.acceptChunk("world");
	});

	assert.equal(payload, "world");
});

test("ends the readable side when the remote transport ends", async () => {
	const duplex = new Transport(() => {});
	const ended = new Promise((resolve) => duplex.once("end", resolve));

	duplex.resume();
	duplex.endRemote();
	await ended;
});

test("normalizes request headers for h2 over HTTY", () => {
	assert.deepEqual(normalizeRequestHeaders({path: "/demo", headers: {"Content-Type": "text/plain"}}), {
		":method": "GET",
		":path": "/demo",
		":scheme": "http",
		":authority": "htty.local",
		"content-type": "text/plain",
	});
});

test("sanitizes pseudo headers from HTTP/2 responses", () => {
	assert.deepEqual(sanitizeResponseHeaders({":status": 200, "content-type": "text/plain", "set-cookie": ["a=1", "b=2"]}), {
		"content-type": "text/plain",
		"set-cookie": "a=1, b=2",
	});
});

test("tracks session state transitions around HTTY startup", () => {
	const session = new Client(() => {});
	const states = [];

	session.on("state", (state) => states.push(state.status));

	session.start();
	session.close();

	assert.deepEqual(states.filter((state) => state !== SESSION_STATUS.ATTACHED), [SESSION_STATUS.NEGOTIATING, SESSION_STATUS.CLOSING]);
});

test("terminal session interrupt writes HTTY GOAWAY while active", () => {
	const writes = [];
	let onData = null;
	const process = {
		write(data) { writes.push(Buffer.from(data)); },
		onData(callback) { onData = callback; },
		onExit() {},
		resize() {},
		kill() {},
	};
	const session = new Session(process, {id: "test", command: "node"});
	
	onData(encodeBootstrap());
	writes.length = 0;
	
	assert.equal(session.sendInterrupt(), true);
	assert.equal(writes.length, 1);
	assert.deepEqual(writes[0], Buffer.from([
		0x00, 0x00, 0x08,
		0x07,
		0x00,
		0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00,
		0x00, 0x00, 0x00, 0x00,
	]));
	
	session.close();
});

test("keeps html responses as srcdoc documents", () => {
	const document = browserDocumentForResponse({
		headers: {"content-type": "text/html; charset=utf-8"},
		body: "<h1>Hello</h1>",
	});

	assert.equal(document.mode, "html");
	assert.equal(document.contentType, "text/html; charset=utf-8");
	assert.equal(document.displayContentType, "text/html; charset=utf-8");
	assert.equal(document.body, "<h1>Hello</h1>");
});

test("wraps plain text responses for the attached browser surface", () => {
	const document = browserDocumentForResponse({
		headers: {"content-type": "text/plain"},
		body: "Hello <World>",
	});

	assert.equal(document.mode, "text");
	assert.equal(document.contentType, "text/html; charset=utf-8");
	assert.equal(document.displayContentType, "text/plain");
	assert.match(document.body, /Hello &lt;World&gt;/);
	assert.match(document.body, /text\/plain/);
});