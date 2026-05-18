import {Server} from "@socketry/htty";

// ─── WebSocket frame codec (server side) ─────────────────────────────────────
// The HTTYSurfaceServer proxy is a transparent byte tunnel, so the HTTY server
// receives raw WebSocket frames from the browser (client→server frames are
// masked per RFC 6455). This codec decodes incoming frames and re-encodes echo
// responses as unmasked server→client frames.

function encodeServerFrame(opcode, payload) {
	// Server→client frames are NOT masked (RFC 6455 §5.1).
	const len = payload.length;
	let header;
	if (len < 126) {
		header = Buffer.from([0x80 | opcode, len]);
	} else if (len < 65536) {
		header = Buffer.from([0x80 | opcode, 126, (len >> 8) & 0xFF, len & 0xFF]);
	} else {
		header = Buffer.from([0x80 | opcode, 127, 0, 0, 0, 0, (len >>> 24) & 0xFF, (len >>> 16) & 0xFF, (len >>> 8) & 0xFF, len & 0xFF]);
	}
	return Buffer.concat([header, payload]);
}

class ServerFrameDecoder {
	constructor() { this.buf = Buffer.alloc(0); }

	feed(chunk) {
		this.buf = Buffer.concat([this.buf, chunk]);
		const out = [];
		while (this.buf.length >= 2) {
			const opcode = this.buf[0] & 0x0F;
			const masked = (this.buf[1] & 0x80) !== 0;
			let payloadLen = this.buf[1] & 0x7F;
			let headerLen = 2 + (masked ? 4 : 0);
			if (payloadLen === 126) {
				if (this.buf.length < 4) break;
				payloadLen = this.buf.readUInt16BE(2);
				headerLen = 4 + (masked ? 4 : 0);
			} else if (payloadLen === 127) {
				if (this.buf.length < 10) break;
				payloadLen = this.buf.readUInt32BE(6);
				headerLen = 10 + (masked ? 4 : 0);
			}
			if (this.buf.length < headerLen + payloadLen) break;
			let payload;
			if (masked) {
				const maskKey = this.buf.slice(headerLen - 4, headerLen);
				payload = Buffer.allocUnsafe(payloadLen);
				for (let i = 0; i < payloadLen; i++) payload[i] = this.buf[headerLen + i] ^ maskKey[i % 4];
			} else {
				payload = Buffer.from(this.buf.slice(headerLen, headerLen + payloadLen));
			}
			this.buf = this.buf.slice(headerLen + payloadLen);
			out.push({opcode, payload});
		}
		return out;
	}
}

// ─── HTML test fixture ───────────────────────────────────────────────────────
//
// The page script runs a sequence of WebSocket checks automatically on load
// and writes results to window.__wsResults so the Playwright test can inspect
// them without caring about how the underlying bridge is implemented.
const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<title>WebSocket Demo</title>
</head>
<body>
<script>
(async function() {
const base = location.href.replace(/^http(s?):/, "ws$1:").replace(/\\/$/, "");
const results = window.__wsResults = {done: false, passed: [], failed: []};

function pass(name) { results.passed.push(name); }
function fail(name, reason) { results.failed.push({name, reason}); }

// Replace every 5000/10000ms step timeout with 3000ms so the full 8-step
// suite completes in under 30 seconds even when everything hangs.
function withTimeout(promise, ms, label) {
	return Promise.race([
		promise,
		new Promise((_, reject) => setTimeout(
			() => reject(new Error(label + " timed out after " + ms + "ms")), ms,
		)),
	]);
}

const T = 3000; // per-step timeout (ms)

function connect(path) {
	return new Promise((resolve, reject) => {
		const ws = new WebSocket(base + path);
		ws.addEventListener("open", () => resolve(ws));
		ws.addEventListener("error", () => reject(new Error("WebSocket error on " + path)));
		// SocketBridge dispatches a close rather than error when the underlying
		// stream fails to open, so reject on close too.
		ws.addEventListener("close", (e) => reject(new Error("closed (code " + e.code + ") before open on " + path)));
	});
}

function nextMessage(ws) {
	return new Promise((resolve, reject) => {
		ws.addEventListener("message", (e) => resolve(e), {once: true});
		ws.addEventListener("close", () => reject(new Error("closed before message")), {once: true});
	});
}

function waitClose(ws) {
	return new Promise((resolve) => {
		ws.addEventListener("close", (e) => resolve(e), {once: true});
	});
}

async function run() {
	// ── 1. Text echo arrives as a string ──────────────────────────────────────
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (text)");
		ws.send("hello");
		const evt = await withTimeout(nextMessage(ws), T, "text echo");
		if (typeof evt.data !== "string") {
			fail("text message is a string", "got " + Object.prototype.toString.call(evt.data));
		} else if (evt.data !== "hello") {
			fail("text message is a string", "value was " + JSON.stringify(evt.data));
		} else {
			pass("text message is a string");
		}
		ws.close();
		await waitClose(ws);
	} catch (e) { fail("text message is a string", e.message); }

	// ── 2. JSON round-trip ────────────────────────────────────────────────────
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (json)");
		const payload = JSON.stringify({type: "ping", seq: 42});
		ws.send(payload);
		const evt = await withTimeout(nextMessage(ws), T, "json echo");
		const parsed = JSON.parse(evt.data);
		if (parsed?.type !== "ping" || parsed?.seq !== 42) {
			fail("JSON round-trip", "unexpected: " + JSON.stringify(parsed));
		} else {
			pass("JSON round-trip");
		}
		ws.close();
		await waitClose(ws);
	} catch (e) { fail("JSON round-trip", e.message); }

	// ── 3. Binary data with binaryType=arraybuffer arrives as ArrayBuffer ─────
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (binary-ab)");
		ws.binaryType = "arraybuffer";
		// 0xFF is never a valid UTF-8 byte, so this is unambiguously binary.
		const sent = new Uint8Array([0xDE, 0xAD, 0xBE, 0xFF]);
		ws.send(sent);
		const evt = await withTimeout(nextMessage(ws), T, "binary arraybuffer echo");
		if (!(evt.data instanceof ArrayBuffer)) {
			fail("binary arrives as ArrayBuffer", "got " + Object.prototype.toString.call(evt.data));
		} else if (evt.data.byteLength !== 4) {
			fail("binary arrives as ArrayBuffer", "expected 4 bytes, got " + evt.data.byteLength);
		} else {
			const received = new Uint8Array(evt.data);
			const match = sent.every((b, i) => b === received[i]);
			match ? pass("binary arrives as ArrayBuffer") : fail("binary arrives as ArrayBuffer", "bytes differed");
		}
		ws.close();
		await waitClose(ws);
	} catch (e) { fail("binary arrives as ArrayBuffer", e.message); }

	// ── 4. Binary data with binaryType=blob arrives as Blob ──────────────────
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (binary-blob)");
		ws.binaryType = "blob";
		const sent = new Uint8Array([0xDE, 0xAD, 0xBE, 0xFF]);
		ws.send(sent);
		const evt = await withTimeout(nextMessage(ws), T, "binary blob echo");
		if (!(evt.data instanceof Blob)) {
			fail("binary arrives as Blob", "got " + Object.prototype.toString.call(evt.data));
		} else {
			pass("binary arrives as Blob");
		}
		ws.close();
		await waitClose(ws);
	} catch (e) { fail("binary arrives as Blob", e.message); }

	// ── 5. Server-initiated close is delivered with code 1000 ─────────────────
	try {
		const ws = await withTimeout(connect("/ws/close-immediately"), T, "connect /ws/close-immediately");
		const closeEvt = await withTimeout(waitClose(ws), T, "server-initiated close event");
		if (closeEvt.code !== 1000) {
			fail("server close delivers code 1000", "got code " + closeEvt.code);
		} else {
			pass("server close delivers code 1000");
		}
	} catch (e) { fail("server close delivers code 1000", e.message); }

	// ── 6. Multiple simultaneous connections are independent ──────────────────
	try {
		const [ws1, ws2] = await withTimeout(
			Promise.all([connect("/ws"), connect("/ws")]), T, "connect two /ws",
		);
		ws1.send("from-1");
		ws2.send("from-2");
		const [evt1, evt2] = await withTimeout(
			Promise.all([nextMessage(ws1), nextMessage(ws2)]), T, "two echo messages",
		);
		if (evt1.data !== "from-1") {
			fail("simultaneous connections are independent", "ws1 got " + JSON.stringify(evt1.data));
		} else if (evt2.data !== "from-2") {
			fail("simultaneous connections are independent", "ws2 got " + JSON.stringify(evt2.data));
		} else {
			pass("simultaneous connections are independent");
		}
		ws1.close(); ws2.close();
		await Promise.all([waitClose(ws1), waitClose(ws2)]);
	} catch (e) { fail("simultaneous connections are independent", e.message); }

	// ── 7. Large text message round-trips correctly ───────────────────────────
	// WebSocket frame encoding in SocketBridge means the full message is sent
	// as one frame and the decoder reassembles fragmented transport chunks,
	// so even large payloads arrive as a single message event.
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (large)");
		const large = "x".repeat(65536); // 64 KiB
		ws.send(large);
		const evt = await withTimeout(nextMessage(ws), T, "large echo");
		if (typeof evt.data !== "string" || evt.data.length !== large.length) {
			fail("text message round-trips without truncation", "got " + typeof evt.data + " length=" + evt.data?.length);
		} else {
			pass("text message round-trips without truncation");
		}
		ws.close();
		await waitClose(ws);
	} catch (e) { fail("text message round-trips without truncation", e.message); }

	// ── 8. readyState transitions follow the WebSocket lifecycle ─────────────
	try {
		const ws = await withTimeout(connect("/ws"), T, "connect /ws (readyState)");
		if (ws.readyState !== WebSocket.OPEN) {
			fail("readyState is OPEN after open event", "got " + ws.readyState);
		} else {
			pass("readyState is OPEN after open event");
		}
		const closeEvt = waitClose(ws);
		ws.close(1000, "done");
		await withTimeout(closeEvt, T, "client-initiated close");
		if (ws.readyState !== WebSocket.CLOSED) {
			fail("readyState is CLOSED after close", "got " + ws.readyState);
		} else {
			pass("readyState is CLOSED after close");
		}
	} catch (e) {
		fail("readyState is OPEN after open event", e.message);
		fail("readyState is CLOSED after close", e.message);
	}

	results.done = true;
}

run().catch((e) => {
	results.uncaughtError = e.message;
	results.done = true;
});
})();
</script>
</body>
</html>`;

// ─── HTTY server ─────────────────────────────────────────────────────────────
Server.open((stream, headers) => {
	const method = headers[":method"];
	const path = headers[":path"] || "/";
	const protocol = headers[":protocol"];

	if (method === "GET" && path === "/") {
		stream.respond({":status": 200, "content-type": "text/html; charset=utf-8"});
		stream.end(HTML);
		return;
	}

	if (method === "CONNECT" && protocol === "websocket") {
		if (path === "/ws/close-immediately") {
			// Send a WebSocket close frame (code 1000) then end the stream so the
			// browser sees a clean close rather than an abnormal 1006 closure.
			stream.respond({":status": 200});
			const closePayload = Buffer.allocUnsafe(2);
			closePayload.writeUInt16BE(1000, 0);
			stream.write(encodeServerFrame(0x8, closePayload));
			stream.end();
			return;
		}

		// Default: decode incoming WebSocket frames and echo each back.
		stream.respond({":status": 200});
		const decoder = new ServerFrameDecoder();
		stream.on("data", (chunk) => {
			for (const {opcode, payload} of decoder.feed(chunk)) {
				if ((opcode === 1 || opcode === 2) && !stream.destroyed) {
					// Echo text/binary frames back.
					stream.write(encodeServerFrame(opcode, payload));
				} else if (opcode === 8 && !stream.destroyed) {
					// WebSocket close frame — echo it back then end the stream.
					stream.write(encodeServerFrame(0x8, payload));
					stream.end();
				}
			}
		});
		stream.on("end", () => { if (!stream.destroyed) stream.end(); });
		stream.on("error", () => { /* ignore teardown races */ });
		return;
	}

	stream.respond({":status": 404});
	stream.end("Not Found");
});
