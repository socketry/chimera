import crypto from "node:crypto";
import http from "node:http";

export const SURFACE_HOST_SUFFIX = ".htty";

// Hop headers must not be forwarded by any proxy (RFC 2616 §13.5.1).
const HOP_HEADERS = new Set([
	"connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
	"te", "trailers", "transfer-encoding", "upgrade",
]);

// A single HTTP/WSS server shared across all HTTY sessions.
//
// Chromium reaches it because host-resolver-rules maps *.htty to
// 127.0.0.1:<this port>. The Host header identifies which session owns each
// request. HTTP (not HTTPS) is used so no TLS certificate is needed; the
// embedded pages use ws:// WebSocket URLs which match their http:// origin.
//
// HTTP requests  → proxied to the session's HTTY HTTP/2 client.
// WebSocket upgrades → HTTP/2 extended-CONNECT stream on the HTTY client;
//   raw WebSocket frames are piped bidirectionally. No frame
//   encoding/decoding is needed here: the browser and the HTTY server both
//   speak RFC 8441, so the server is a transparent byte tunnel.

export class HTTYSurfaceServer {
	#sessions = new Map(); // "session-1" → getClient fn
	#wellKnownHandlers = new Map(); // "session-1" → handler fn
	#server = http.createServer((req, res) => this.#handleHttp(req, res));
	port = null;

	constructor() {
		this.#server.on("upgrade", (req, socket, head) => this.#handleUpgrade(req, socket, head));
	}

	register(sessionId, getClient, wellKnownHandler) {
		this.#sessions.set(sessionId, getClient);
		this.#wellKnownHandlers.set(sessionId, wellKnownHandler);
	}

	unregister(sessionId) {
		this.#sessions.delete(sessionId);
		this.#wellKnownHandlers.delete(sessionId);
	}

	start() {
		return new Promise((resolve, reject) => {
			this.#server.listen(0, "127.0.0.1", () => {
				this.port = this.#server.address().port;
				resolve(this.port);
			});
			this.#server.once("error", reject);
		});
	}

	close() {
		this.#server.close();
	}

	#sessionId(req) {
		const host = req.headers.host ?? "";
		const hostname = host.split(":")[0];
		if (!hostname.endsWith(SURFACE_HOST_SUFFIX)) return null;
		return hostname.slice(0, -SURFACE_HOST_SUFFIX.length);
	}

	async #handleHttp(req, res) {
		const sessionId = this.#sessionId(req);
		const client = sessionId ? this.#sessions.get(sessionId)?.() : null;
		if (!client) {
			res.writeHead(410);
			res.end("HTTY session not available");
			return;
		}

		const requestPath = req.url ?? "/";

		// Chimera-owned .well-known routes are handled locally.
		if (requestPath.startsWith("/.well-known/chimera/")) {
			const handled = this.#wellKnownHandlers.get(sessionId)?.(requestPath, req, res);
			if (handled) return;
		}

		const method = (req.method ?? "GET").toUpperCase();
		const headers = {":scheme": "http", ":authority": req.headers.host ?? ""};
		for (const [key, value] of Object.entries(req.headers)) {
			if (key !== "host" && !HOP_HEADERS.has(key)) headers[key] = value;
		}

		try {
			const response = await client.request({
				path: requestPath,
				method,
				headers,
				body: method !== "GET" && method !== "HEAD" ? req : undefined,
			});
			res.writeHead(response.status, response.headers);
			if (response.body) response.body.pipe(res); else res.end();
		} catch (err) {
			if (!res.headersSent) res.writeHead(500);
			res.end(String(err?.message ?? err));
		}
	}

	#handleUpgrade(req, socket, head) {
		const sessionId = this.#sessionId(req);
		const client = sessionId ? this.#sessions.get(sessionId)?.() : null;
		if (!client) { socket.destroy(); return; }

		const host = (req.headers.host ?? "").split(":")[0];
		const requestHeaders = {
			":method": "CONNECT",
			":protocol": "websocket",
			":scheme": "http",
			":authority": host,
			":path": req.url ?? "/",
		};
		if (req.headers["sec-websocket-protocol"]) {
			requestHeaders["sec-websocket-protocol"] = req.headers["sec-websocket-protocol"];
		}

		let stream;
		try {
			stream = client.start().request(requestHeaders);
		} catch { socket.destroy(); return; }

		stream.once("response", (responseHeaders) => {
			if (Number(responseHeaders[":status"]) !== 200) {
				socket.destroy(); stream.destroy(); return;
			}

			const key = req.headers["sec-websocket-key"] ?? "";
			const accept = crypto.createHash("sha1")
				.update(key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11")
				.digest("base64");
			const selectedProtocol = responseHeaders["sec-websocket-protocol"];

			socket.write(
				"HTTP/1.1 101 Switching Protocols\r\n" +
				"Upgrade: websocket\r\n" +
				"Connection: Upgrade\r\n" +
				`Sec-WebSocket-Accept: ${accept}\r\n` +
				(selectedProtocol ? `Sec-WebSocket-Protocol: ${selectedProtocol}\r\n` : "") +
				"\r\n",
			);

			// Pipe WebSocket frames transparently — no framing needed here.
			if (head.length > 0) stream.write(head);
			socket.pipe(stream);
			stream.pipe(socket);
		});

		stream.on("error", () => socket.destroy());
		socket.on("error", () => stream.destroy());
	}
}
