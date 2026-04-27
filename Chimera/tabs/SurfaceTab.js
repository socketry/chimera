import {Tab} from "./Tab.js";
import {SurfacePane} from "./SurfacePane.js";

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
		this.button.dataset.surfaceId = surface.id;
		this.panel.dataset.surfaceId = surface.id;
		this.surfacePane = this.pushPane(new SurfacePane(this, session, surface), {activate: false});
	}
	
	updateSession(session) {
		this.session = session;
		super.updateSession(session);
	}
	
	updateSurface(surface) {
		this.surfaceId = surface.id;
		this.button.dataset.surfaceId = surface.id;
		this.panel.dataset.surfaceId = surface.id;
		this.surfacePane?.updateSurface(surface);
		this.refreshButton();
	}
	
	setDocumentSummary(payload) {
		this.surfacePane?.setDocumentSummary(payload);
		this.refreshButton();
	}
	
	syncBrowserView({visible = true, focused = this.isPrimaryFocused} = {}) {
		this.surfacePane?.syncBrowserView({visible, focused});
	}
	
	resizeToHost() {
		this.surfacePane?.resizeToHost();
	}
	
	clearDocument() {
		this.surfacePane?.clearDocument();
		this.refreshButton();
	}
}