export function responseBodyStream(body) {
	if (body == null || typeof body === "string" || body instanceof Uint8Array || typeof body.getReader === "function") {
		return body;
	}

	if (typeof body.pipe === "function") {
		return nodeReadableToWeb(body);
	}

	return body;
}

export function nodeReadableToWeb(readable) {
	let controller = null;
	let closed = false;

	const cleanup = () => {
		readable.off?.("data", onData);
		readable.off?.("end", onEnd);
		readable.off?.("error", onError);
		readable.off?.("close", onEnd);
	};

	const close = () => {
		if (closed) {
			return;
		}

		closed = true;
		cleanup();
		try {
			controller?.close();
		} catch {
			// Electron may already have cancelled the Web stream.
		}
	};

	const onData = (chunk) => {
		if (closed) {
			return;
		}

		try {
			controller.enqueue(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
		} catch {
			closed = true;
			cleanup();
			readable.destroy?.();
		}
	};

	const onEnd = () => {
		close();
	};

	const onError = (error) => {
		if (closed) {
			return;
		}

		closed = true;
		cleanup();
		try {
			controller?.error(error);
		} catch {
			// Electron may already have cancelled the Web stream.
		}
	};

	return new ReadableStream({
		start(nextController) {
			controller = nextController;
			readable.on?.("data", onData);
			readable.once?.("end", onEnd);
			readable.once?.("error", onError);
			readable.once?.("close", onEnd);
		},
		cancel() {
			closed = true;
			cleanup();
			readable.destroy?.();
		},
	});
}
