import test from "node:test";
import assert from "node:assert/strict";
import {HTTYClientSession, HTTYDecoder, HTTYDuplex, HTTYEncoder, HTTYPacket, SESSION_STATUS, decodeTextPayload, normalizeRequestHeaders, sanitizeResponseHeaders} from "@socketry/htty";

import {browserDocumentForResponse} from "../src/browser-surface.js";

test("encodes and decodes an HTTY data packet", () => {
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();

	const encoded = encoder.data(Buffer.from("PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"));
	const {plainText, packets} = decoder.push(encoded);

	assert.equal(plainText, "");
	assert.equal(packets.length, 1);
	assert.equal(packets[0].type, "DATA");
	assert.equal(decodeTextPayload(packets[0]), "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n");
});

test("encodes and decodes an HTTY ready packet", () => {
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();

	const encoded = encoder.encode(new HTTYPacket("READY"));
	const {plainText, packets} = decoder.push(encoded);

	assert.equal(plainText, "");
	assert.equal(packets.length, 1);
	assert.equal(packets[0].type, "READY");
	assert.equal(packets[0].isReady(), true);
	assert.equal(packets[0].payload.length, 0);
});

test("preserves non-HTTY terminal output", () => {
	const decoder = new HTTYDecoder();
	const {plainText, packets} = decoder.push("hello world");

	assert.equal(plainText, "hello world");
	assert.equal(packets.length, 0);
});

test("buffers incomplete HTTY packets", () => {
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();
	const packet = encoder.data(Buffer.from("abc"));

	const first = decoder.push(packet.slice(0, 8));
	assert.equal(first.plainText, "");
	assert.equal(first.packets.length, 0);

	const second = decoder.push(packet.slice(8));
	assert.equal(second.packets.length, 1);
	assert.equal(decodeTextPayload(second.packets[0]), "abc");
});

test("writes HTTY OPEN, DATA and CLOSE packets through the duplex transport", async () => {
	const writes = [];
	const duplex = new HTTYDuplex((packet) => writes.push(packet));

	duplex.write(Buffer.from("hello"));
	duplex.end();

	assert.equal(writes.length, 3);
	assert.match(writes[0], /^\u001bPHTTY;1;OPEN;/u);
	assert.match(writes[1], /^\u001bPHTTY;1;DATA;/u);
	assert.match(writes[2], /^\u001bPHTTY;1;CLOSE;/u);
});

test("accepts HTTY DATA packets into the duplex transport", async () => {
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();
	const duplex = new HTTYDuplex(() => {});

	const packetString = encoder.data(Buffer.from("world"));
	const {packets} = decoder.push(packetString);

	const payload = await new Promise((resolve) => {
		duplex.once("data", (chunk) => resolve(chunk.toString("utf8")));
		duplex.acceptPacket(packets[0]);
	});

	assert.equal(payload, "world");
});

test("does not emit a duplicate close packet after remote close", () => {
	const writes = [];
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();
	const duplex = new HTTYDuplex((packet) => writes.push(packet));

	const {packets} = decoder.push(encoder.close());
	duplex.acceptPacket(packets[0]);
	duplex.shutdown();

	assert.equal(writes.length, 0);
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

test("tracks session state transitions around HTTY packets", () => {
	const session = new HTTYClientSession(() => {});
	const states = [];
	const encoder = new HTTYEncoder();
	const decoder = new HTTYDecoder();

	session.on("state", (state) => states.push(state.status));

	const {packets} = decoder.push(encoder.open());
	session.handlePacket(packets[0]);
	session.close();

	assert.deepEqual(states, [SESSION_STATUS.NEGOTIATING, SESSION_STATUS.CLOSING, SESSION_STATUS.CLOSED]);
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