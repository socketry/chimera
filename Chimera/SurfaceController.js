import {WebContentsView} from "electron";

import {browserDocumentForResponse} from "./BrowserSurface.js";
import {normalizeRequestPath, parseSurfaceURL, toSurfaceURL} from "./Utilities.js";

function surfaceErrorResponse(status, message) {
	return new Response(message, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
		},
	});
}

export class SurfaceController {
	static async create(delegate, options) {
		const controller = new SurfaceController(delegate, options);
		await controller.initialize();
		return controller;
	}

	constructor(delegate, {id, sessionController, requestPath}) {
		this.delegate = delegate;
		this.sessionController = sessionController;
		this.id = id;
		this.sessionId = sessionController.id;
		this.requestPath = normalizeRequestPath(requestPath);
		this.title = sessionController.title;
		this.hasExplicitTitle = false;
		this.visible = false;
		this.focused = false;
		this.bounds = null;
		this.view = null;
	}

	async initialize() {
		this.view = new WebContentsView({
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
				sandbox: true,
				partition: `htty-surface:${this.id}`,
			},
		});

		if (typeof this.view.setBackgroundColor === "function") {
			this.view.setBackgroundColor("#ffffff");
		}

		this.view.setVisible(false);
		this.view.webContents.setWindowOpenHandler(() => ({action: "deny"}));
		await this.view.webContents.session.protocol.handle("htty", (request) => this.handleSurfaceRequest(request));
		this.view.webContents.on("did-navigate", (_event, url) => {
			const {sessionId, requestPath} = parseSurfaceURL(url);
			if (sessionId === this.sessionId) {
				this.delegate.surfaceControllerDidNavigate(this, requestPath);
			}
		});
		this.view.webContents.on("page-title-updated", (event, title) => {
			event.preventDefault();
			this.delegate.surfaceControllerDidReceiveTitle(this, title);
		});
		this.view.webContents.on("before-input-event", (event, input) => {
			const key = String(input.key || "").toLowerCase();
			if ((input.control || input.meta) && !input.alt && !input.shift && key === "c") {
				if (this.delegate.surfaceControllerDidRequestInterrupt?.(this)) {
					event.preventDefault();
				}
			}
		});
	}

	snapshot(isActive = false) {
		return {
			id: this.id,
			sessionId: this.sessionId,
			requestPath: this.requestPath,
			title: this.title,
			isActive,
		};
	}

	async handleSurfaceRequest(request) {
		const {sessionId, requestPath} = parseSurfaceURL(request.url);
		if (sessionId !== this.sessionId) {
			return surfaceErrorResponse(403, "Cross-session HTTY navigation is not supported.");
		}

		if (!this.sessionController.client) {
			return surfaceErrorResponse(410, "HTTY session is no longer available.");
		}

		try {
			const method = (request.method || "GET").toUpperCase();
			const headers = Object.fromEntries(request.headers.entries());
			const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
			const response = await this.sessionController.client.request({
				path: requestPath,
				method,
				headers,
				body,
			});
			const document = browserDocumentForResponse(response);
			const isDocumentRequest = request.destination === "document" || request.mode === "navigate";

			if (isDocumentRequest) {
				this.sessionController.handleSurfaceDocument(this, requestPath, response, document);
			}

			return new Response(document.body, {
				status: response.status,
				headers: {
					...response.headers,
					"content-type": document.contentType,
				},
			});
		} catch (error) {
			this.sessionController.handleSurfaceRequestError(error);
			return surfaceErrorResponse(500, error.message);
		}
	}

	async load(requestPath = this.requestPath) {
		const nextPath = normalizeRequestPath(requestPath);
		const targetURL = toSurfaceURL(this.sessionId, nextPath);
		if (this.view.webContents.getURL() !== targetURL) {
			await this.view.webContents.loadURL(targetURL);
		} else {
			this.delegate.surfaceControllerDidChange(this);
		}
	}

	setTitle(title) {
		this.title = title;
		this.hasExplicitTitle = true;
	}

	setPath(requestPath) {
		this.requestPath = normalizeRequestPath(requestPath);
	}

	applyViewState(state = {}) {
		this.bounds = state.bounds ?? this.bounds;
		this.focused = Boolean(state.focused);
		this.visible = Boolean(state.visible);
	}

	async getDebugState(isActive = false) {
		return {
			...this.snapshot(isActive),
			url: this.view.webContents.getURL(),
			title: this.view.webContents.getTitle(),
			textContent: await this.view.webContents.executeJavaScript("document.body.innerText"),
		};
	}

	close() {
		this.visible = false;
		this.focused = false;
		try {
			if (!this.view?.webContents?.isDestroyed()) {
				this.view.webContents.close({waitForBeforeUnload: false});
			}
		} catch {
			// Ignore teardown races when Electron destroys the view first.
		}
	}
}
