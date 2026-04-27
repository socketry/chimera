import {Pane} from "./Pane.js";

function truncatePath(path) {
	const value = String(path ?? "/");
	return value.length > 24 ? `${value.slice(0, 21)}...` : value;
}

export class SurfacePane extends Pane {
	constructor(tab, session, surface) {
		super(tab, {
			id: `surface:${surface.id}`,
			type: "surface",
		});
		
		this.session = session;
		this.surfaceId = surface.id;
		this.requestPath = surface.requestPath;
		this.surface = surface;
		this.documentSummary = null;
		this.node.dataset.surfaceId = surface.id;
		this.updateSession(session);
	}
	
	createNode() {
		const panel = document.createElement("section");
		panel.className = "surface-panel";
		panel.innerHTML = `
			<div class="surface-placeholder">Loading isolated HTTY browser surface.</div>
			<div class="surface-browser-host"></div>
		`;
		
		this.placeholderNode = panel.querySelector(".surface-placeholder");
		this.hostNode = panel.querySelector(".surface-browser-host");
		
		return panel;
	}
	
	getLabel() {
		return this.surface?.title ?? this.tab.title ?? truncatePath(this.requestPath);
	}
	
	getTooltip() {
		const title = this.surface?.title ?? this.tab.title ?? truncatePath(this.requestPath);
		return `${title} ${this.requestPath}`;
	}
	
	getAddressState() {
		return {
			kind: "Address",
			value: this.requestPath,
			detail: `${this.session?.title ?? this.tab.title}${this.documentSummary?.displayContentType ? ` · ${this.documentSummary.displayContentType}` : ""}`,
			submitLabel: "Open",
		};
	}
	
	updateSession(session) {
		this.session = session;
		if (!this.documentSummary) {
			this.placeholderNode.textContent = session?.exitInfo ? "Session exited." : "Waiting for the command to serve HTTY content.";
		}
		this.tab.button.classList.add("tab-button-surface");
	}
	
	updateSurface(surface) {
		this.surface = surface;
		this.surfaceId = surface.id;
		this.requestPath = surface.requestPath;
		this.tab.title = surface.title;
		this.node.dataset.surfaceId = surface.id;
	}
	
	setDocumentSummary(payload) {
		this.documentSummary = payload?.document ?? null;
		this.requestPath = payload?.path ?? this.requestPath;
		this.placeholderNode.hidden = true;
	}
	
	afterActivation() {
		this.controller.setSessionTransportMode(this.sessionId, "htty");
		this.syncBrowserView();
	}
	
	onShown() {
		this.controller.setSessionTransportMode(this.sessionId, "htty");
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
		
		if (!visible || this.node.hidden || document.hidden) {
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
	
	resizeToHost() {
		this.syncBrowserView();
	}
	
	shouldInterceptInterrupt() {
		return true;
	}
	
	closeRequest() {
		return {kind: "surface", surfaceId: this.surfaceId};
	}
	
	clearDocument() {
		this.documentSummary = null;
		this.placeholderNode.hidden = false;
		this.placeholderNode.textContent = this.session?.exitInfo ? "Session exited." : "Waiting for the command to serve HTTY content.";
	}
}
