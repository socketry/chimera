import {WebContentsView} from "electron";

import {normalizeRequestPath, parseSurfaceURL, toSurfaceURL} from "./Utilities.js";
import {WellKnownController} from "./WellKnownController.js";

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
		this.wellKnownController = new WellKnownController(this);
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

		if (process.env.HTTY_DEBUG === "1") {
			this.view.webContents.openDevTools({mode: "detach"});
		}
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
		// Electron delivers every embedded WebContentsView request for the htty:// protocol here. The URL host selects the owning Chimera session; the path is either a Chimera-owned .well-known route or an application request forwarded over the session's HTTY client. SessionController handles the application response shape, including document navigation bookkeeping and subresource pass-through, then returns a Fetch Response for Electron to load in the isolated web view.
		const {sessionId, requestPath} = parseSurfaceURL(request.url);
		if (sessionId !== this.sessionId) {
			return surfaceErrorResponse(403, "Cross-session HTTY navigation is not supported.");
		}

		if (!this.sessionController.client) {
			return surfaceErrorResponse(410, "HTTY session is no longer available.");
		}

		try {
			// Chimera-owned .well-known routes are handled by the host before the request reaches the HTTY application.
			const wellKnownResponse = this.wellKnownController.handleRequest({
				path: requestPath,
				request,
			});
			if (wellKnownResponse) {
				return wellKnownResponse;
			}

			// All other requests are application traffic and are forwarded through the session's HTTY client.
			return await this.sessionController.handleRequest({
				surface: this,
				path: requestPath,
				request,
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

	showDeveloperTools() {
		if (!this.view?.webContents || this.view.webContents.isDestroyed()) {
			return false;
		}

		this.view.webContents.openDevTools({mode: "detach"});
		return true;
	}

	wellKnownControllerDidRequestBookmarksRefresh() {
		this.delegate.surfaceControllerDidRequestBookmarksRefresh?.(this);
	}

	wellKnownControllerDidRequestConfigurationRefresh() {
		this.delegate.surfaceControllerDidRequestConfigurationRefresh?.(this);
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
