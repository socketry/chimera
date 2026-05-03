import assert from "node:assert/strict";
import {PassThrough} from "node:stream";
import test from "node:test";

import {nodeReadableToWeb, responseBodyStream} from "../../Chimera/StreamAdapters.js";

class FakeReadable {
	constructor() {
		this.listeners = new Map();
	}
	
	on(event, listener) {
		const listeners = this.listeners.get(event) ?? new Set();
		listeners.add(listener);
		this.listeners.set(event, listeners);
	}
	
	once(event, listener) {
		const onceListener = (...args) => {
			this.off(event, onceListener);
			listener(...args);
		};
		this.on(event, onceListener);
	}
	
	off(event, listener) {
		this.listeners.get(event)?.delete(listener);
	}
	
	emit(event, ...args) {
		for (const listener of this.listeners.get(event) ?? []) {
			listener(...args);
		}
	}
}

test("converts Node readable chunks into a Web stream", async () => {
	const readable = new PassThrough();
	const stream = nodeReadableToWeb(readable);
	
	readable.write("one ");
	readable.end("two");
	
	assert.equal(await new Response(stream).text(), "one two");
});

test("preserves binary chunks when converting Node readable streams", async () => {
	const readable = new PassThrough();
	const stream = nodeReadableToWeb(readable);
	
	readable.write(Buffer.from([0, 1, 2]));
	readable.end(Buffer.from([3, 4]));
	
	assert.deepEqual(new Uint8Array(await new Response(stream).arrayBuffer()), new Uint8Array([0, 1, 2, 3, 4]));
});

test("destroys the Node readable when the Web stream is cancelled", async () => {
	const readable = new PassThrough();
	const stream = nodeReadableToWeb(readable);
	
	await stream.cancel();
	
	assert.equal(readable.destroyed, true);
	assert.doesNotThrow(() => {
		readable.write("late");
		readable.end();
	});
});

test("propagates Node readable errors to the Web stream", async () => {
	const readable = new PassThrough();
	const stream = nodeReadableToWeb(readable);
	const error = new Error("boom");
	
	readable.destroy(error);
	
	await assert.rejects(new Response(stream).text(), /boom/);
});

test("ignores close and error races after a stream has ended", async () => {
	const readable = new FakeReadable();
	const stream = nodeReadableToWeb(readable);
	
	readable.emit("data", "done");
	readable.emit("end");
	readable.emit("error", new Error("late"));
	
	assert.equal(await new Response(stream).text(), "done");
});

test("normalizes response bodies to Web-compatible streams", async () => {
	const readable = new PassThrough();
	const body = responseBodyStream(readable);
	
	readable.end("streamed");
	
	assert.equal(await new Response(body).text(), "streamed");
});
