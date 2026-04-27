import {Tab} from "./tab.js";

function truncatePath(path) {
	const value = String(path ?? "/");
	return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}

export class SurfaceTab extends Tab {
	constructor(controller, session, surface) {
		super(controller, {
			id: `surface:${surface.id}`,
			type: "surface",
			title: session.title,
			sessionId: session.id,
			closable: true,
		});

		this.session = session;
		this.surfaceId = surface.id;
		this.requestPath = surface.requestPath;
		this.surface = surface;
		this.documentSummary = null;
		this.button.dataset.surfaceId = surface.id;
		this.panel.dataset.surfaceId = surface.id;
		this.updateSession(session);
	}

	createPanel() {
		const panel = document.createElement("section");
		panel.className = "view-panel surface-panel";
		panel.innerHTML = `
			<div class="surface-placeholder">Loading isolated HTTY browser surface.</div>
			<div class="surface-browser-host"></div>
		`;

		this.placeholderNode = panel.querySelector(".surface-placeholder");
		this.hostNode = panel.querySelector(".surface-browser-host");

		return panel;
	}

	getLabel() {
		return `${this.session?.title ?? this.title} ${truncatePath(this.requestPath)}`;
	}

	getTooltip() {
		return `${this.session?.title ?? this.title} ${this.requestPath}`;
	}

	getAddressState() {
		return {
			kind: "Address",
			value: this.requestPath,
			detail: `${this.session?.title ?? this.title}${this.documentSummary?.displayContentType ? ` · ${this.documentSummary.displayContentType}` : ""}`,
			submitLabel: "Open",
		};
	}

	updateSession(session) {
		this.session = session;
		if (!this.documentSummary) {
			this.placeholderNode.textContent = session?.exitInfo ? "Session exited." : "Waiting for the command to serve HTTY content.";
		}
		this.button.classList.add("tab-button-surface");
		this.refreshButton();
	}

	updateSurface(surface) {
		this.surface = surface;
		this.surfaceId = surface.id;
		this.requestPath = surface.requestPath;
		this.button.dataset.surfaceId = surface.id;
		this.panel.dataset.surfaceId = surface.id;
		this.refreshButton();
	}

	setDocumentSummary(payload) {
		this.documentSummary = payload?.document ?? null;
		this.requestPath = payload?.path ?? this.requestPath;
		this.placeholderNode.hidden = true;
		this.refreshButton();
	}

	afterActivation() {
		this.syncBrowserView();
	}

	onShown() {
		this.syncBrowserView();
	}

	onHidden() {
		this.syncBrowserView({visible: false});
	}

	focusPrimaryControl() {
		this.syncBrowserView({focused: true});
	}

	onFocused() {
		this.syncBrowserView({focused: true});
	}

	onBlurred() {
		this.syncBrowserView();
	}

	onHostVisibilityChanged() {
		this.syncBrowserView();
	}

	onHostFocusChanged() {
		this.syncBrowserView();
	}

	syncBrowserView({visible = true, focused = this.isPrimaryFocused} = {}) {
		if (!this.hostNode?.isConnected) {
			return;
		}

		if (!visible || this.panel.hidden || document.hidden) {
			this.controller.windowApi.syncSurfaceView(this.surfaceId, {visible: false});
			return;
		}

		const rect = this.hostNode.getBoundingClientRect();
		this.placeholderNode.hidden = true;
		this.controller.windowApi.syncSurfaceView(this.surfaceId, {
			visible: true,
			focused: focused && document.hasFocus(),
			bounds: {
				x: rect.x,
				y: rect.y,
				width: rect.width,
				height: rect.height,
			},
		});
	}

	clearDocument() {
		this.documentSummary = null;
		this.placeholderNode.hidden = false;
		this.placeholderNode.textContent = this.session?.exitInfo ? "Session exited." : "Waiting for the command to serve HTTY content.";
		this.refreshButton();
	}
}