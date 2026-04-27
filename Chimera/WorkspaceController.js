import {TerminalTab} from "./tabs/TerminalTab.js";
import {SurfacePane} from "./tabs/SurfacePane.js";
import {SurfaceTab} from "./tabs/SurfaceTab.js";

export class WorkspaceController {
	constructor(windowApi, elements) {
		this.windowApi = windowApi;
		this.elements = elements;
		this.sessions = new Map();
		this.tabs = new Map();
		this.tabOrder = [];
		this.terminalTabsBySession = new Map();
		this.surfaceTabsBySession = new Map();
		this.surfacePanesById = new Map();
		this.activeTabId = null;
		this.draggedTabId = null;
		this.isInterfaceFullScreen = false;
		this.terminalOptions = {};
	}

	async initialize() {
		this.terminalOptions = await this.windowApi.getTerminalOptions();
		this.bindWindowEvents();
		this.bindDomEvents();

		const initialSessions = await this.windowApi.getSessions();
		for (const session of initialSessions) {
			this.upsertSession(session);
		}

		if (initialSessions.length === 0) {
			await this.windowApi.start();
		} else {
			const initialSession = initialSessions[0];
			if (initialSession?.showTerminalTab !== false) {
				this.activateTab(`terminal:${initialSession.id}`);
			}
		}

		this.updateEmptyState();
	}

	bindWindowEvents() {
		window.addEventListener("resize", () => {
			const activeTab = this.tabs.get(this.activeTabId);
			activeTab?.resizeToHost();
		});

		const notifyActiveTabHostViewChanged = (methodName) => {
			this.tabs.get(this.activeTabId)?.[methodName]?.();
		};

		document.addEventListener("visibilitychange", () => {
			notifyActiveTabHostViewChanged("onHostVisibilityChanged");
		});

		window.addEventListener("focus", () => {
			notifyActiveTabHostViewChanged("onHostFocusChanged");
		});

		window.addEventListener("blur", () => {
			notifyActiveTabHostViewChanged("onHostFocusChanged");
		});

		window.addEventListener("keydown", (event) => {
			if (this.shouldInterruptActiveSession(event)) {
				event.preventDefault();
				this.sendInterruptToActiveSession();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "n") {
				event.preventDefault();
				void this.windowApi.newWindow();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "t") {
				event.preventDefault();
				void this.windowApi.start();
				return;
			}

			if ((event.ctrlKey || event.metaKey) && event.key === "PageDown") {
				event.preventDefault();
				this.activateRelativeTab(1);
			}

			if ((event.ctrlKey || event.metaKey) && event.key === "PageUp") {
				event.preventDefault();
				this.activateRelativeTab(-1);
			}
		});

		this.windowApi.onSessionCreated((session) => {
			this.upsertSession(session);
			if (session.showTerminalTab !== false) {
				this.activateTab(`terminal:${session.id}`);
			}
		});

		this.windowApi.onSessionUpdated((session) => {
			this.upsertSession(session);
		});

		this.windowApi.onSessionRemoved(({sessionId}) => {
			this.removeSession(sessionId);
		});

		this.windowApi.onTerminalData(({sessionId, data}) => {
			const tab = this.tabs.get(this.terminalTabsBySession.get(sessionId));
			tab?.writeData(data);
		});

		this.windowApi.onDocument(({payload}) => {
			if (!payload?.surfaceId) {
				return;
			}

			const surfacePane = this.findSurfacePane(payload.surfaceId);
			surfacePane?.setDocumentSummary(payload);
			surfacePane?.tab.refreshButton();
		});

		this.windowApi.onSurfaceCreated((surface) => {
			const surfacePane = this.ensureSurfacePane(surface);
			this.activateTab(surfacePane.tab.id, {focusPrimary: true});
		});

		this.windowApi.onSurfaceUpdated((surface) => {
			const surfacePane = this.findSurfacePane(surface.id);
			surfacePane?.updateSurface(surface);
			surfacePane?.tab.refreshButton();
		});

		this.windowApi.onSurfaceRemoved(({surfaceId}) => {
			const surfacePane = this.findSurfacePane(surfaceId);
			if (!surfacePane) {
				return;
			}

			this.unregisterSurfacePane(surfacePane.sessionId, surfaceId);
			const tab = surfacePane.tab;
			const wasActive = tab.activePane === surfacePane;
			tab.removePane(surfacePane);
			if (wasActive && this.activeTabId === tab.id) {
				tab.focusPrimary({immediate: true});
			}
		});

		this.windowApi.onState(({sessionId}) => {
			this.refreshSessionTabs(sessionId);
		});

		this.windowApi.onExit(({sessionId, exitCode, signal}) => {
			const terminalTab = this.tabs.get(this.terminalTabsBySession.get(sessionId));
			terminalTab?.writeExit(exitCode, signal);
			this.refreshSessionTabs(sessionId);
		});

		this.windowApi.onCloseActiveTab(() => {
			if (this.activeTabId) {
				this.closeTab(this.activeTabId);
			}
		});
		
		this.windowApi.onInterfaceFullScreen(({enabled}) => {
			this.setInterfaceFullScreen(Boolean(enabled));
		});
	}
	
	setInterfaceFullScreen(enabled) {
		this.isInterfaceFullScreen = enabled;
		document.body.classList.toggle("interface-full-screen", enabled);
		
		requestAnimationFrame(() => {
			const activeTab = this.tabs.get(this.activeTabId);
			activeTab?.resizeToHost();
		});
	}

	shouldInterruptActiveSession(event) {
		if (!event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") {
			return false;
		}

		const activeTab = this.tabs.get(this.activeTabId);
		if (!activeTab || !activeTab.sessionId) {
			return false;
		}

		const target = event.target instanceof HTMLElement ? event.target : document.activeElement;
		if (target && (target.closest("input, textarea, select, [contenteditable='true']") || target.isContentEditable)) {
			return false;
		}

		return activeTab.shouldInterceptInterrupt(target);
	}

	sendInterruptToActiveSession() {
		const sessionId = this.getCurrentSessionId();
		if (!sessionId) {
			return;
		}

		void this.windowApi.interruptSession(sessionId);
	}

	setSessionTransportMode(sessionId, mode) {
		if (!sessionId) {
			return;
		}

		void this.windowApi.setSessionTransportMode(sessionId, mode);
	}

	bindDomEvents() {}

	getSession(sessionId) {
		return sessionId ? this.sessions.get(sessionId) : null;
	}

	upsertSession(session) {
		this.sessions.set(session.id, session);

		let terminalTab = this.tabs.get(this.terminalTabsBySession.get(session.id));
		if (session.showTerminalTab !== false && !terminalTab) {
			terminalTab = new TerminalTab(this, session);
			this.addTab(terminalTab, {activate: false});
			this.terminalTabsBySession.set(session.id, terminalTab.id);
		}

		terminalTab?.updateSession(session);
		this.refreshSessionTabs(session.id);
		this.ensureHiddenSessionSurface(session);
	}

	ensureHiddenSessionSurface(session) {
		if (!session || session.showTerminalTab !== false) {
			return;
		}

		if (session.state?.status !== "attached" || session.state?.phase !== "ready" || session.transportMode !== "htty" || session.exitInfo) {
			return;
		}

		const surfaceTabs = this.surfaceTabsBySession.get(session.id);
		if (surfaceTabs?.size) {
			return;
		}

		void this.windowApi.attachBrowser(session.id, session.lastSurfacePath || "/");
	}

	removeSession(sessionId) {
		this.sessions.delete(sessionId);

		const terminalTabId = this.terminalTabsBySession.get(sessionId);
		if (terminalTabId) {
			this.removeTab(terminalTabId);
			this.terminalTabsBySession.delete(sessionId);
		}

		const surfaceTabs = this.surfaceTabsBySession.get(sessionId);
		if (surfaceTabs) {
			for (const tabId of surfaceTabs.values()) {
				this.removeTab(tabId);
			}
			this.surfaceTabsBySession.delete(sessionId);
		}
		
		for (const [surfaceId, entry] of Array.from(this.surfacePanesById.entries())) {
			if (entry.pane.sessionId === sessionId) {
				this.surfacePanesById.delete(surfaceId);
			}
		}

	}

	refreshSessionTabs(sessionId) {
		const session = this.sessions.get(sessionId);
		const terminalTab = this.tabs.get(this.terminalTabsBySession.get(sessionId));
		terminalTab?.updateSession(session);

		const surfaceTabs = this.surfaceTabsBySession.get(sessionId);
		if (surfaceTabs) {
			for (const tabId of surfaceTabs.values()) {
				this.tabs.get(tabId)?.updateSession(session);
			}
		}
		
		for (const {pane} of this.surfacePanesById.values()) {
			if (pane.sessionId === sessionId) {
				pane.updateSession(session);
				pane.tab.refreshButton();
			}
		}
	}

	addTab(tab, {activate = false} = {}) {
		this.tabs.set(tab.id, tab);
		this.tabOrder.push(tab.id);
		this.elements.tabStrip.appendChild(tab.button);
		this.elements.viewStack.appendChild(tab.panel);
		this.updateEmptyState();

		if (activate || !this.activeTabId) {
			this.activateTab(tab.id);
		} else {
			tab.setActive(false);
		}
	}

	removeTab(tabId) {
		const tab = this.tabs.get(tabId);
		if (!tab) {
			return;
		}

		this.tabs.delete(tabId);
		this.tabOrder = this.tabOrder.filter((id) => id !== tabId);
		tab.dispose();

		if (this.activeTabId === tabId) {
			this.activeTabId = null;
			const nextTabId = this.tabOrder[0] ?? null;
			if (nextTabId) {
				this.activateTab(nextTabId, {focusPrimary: true});
			}
		}

		this.updateEmptyState();
	}

	closeTab(tabId) {
		const tab = this.tabs.get(tabId);
		if (!tab) {
			return;
		}

		const request = tab.closeRequest();
		if (request?.kind === "surface") {
			void this.windowApi.closeSurface(request.surfaceId);
		} else if (request?.kind === "session") {
			void this.windowApi.closeSession(request.sessionId);
		}
	}

	activateTab(tabId, options = {}) {
		const nextTab = this.tabs.get(tabId);
		if (!nextTab) {
			return;
		}

		this.activeTabId = tabId;

		for (const id of this.tabOrder) {
			this.tabs.get(id)?.setActive(id === tabId, id === tabId ? options : undefined);
		}

		if (nextTab.sessionId) {
			void this.windowApi.setActiveSession(nextTab.sessionId);
		}

		this.updateEmptyState();
	}

	activateRelativeTab(offset) {
		if (this.tabOrder.length === 0) {
			return;
		}

		const currentIndex = this.tabOrder.indexOf(this.activeTabId);
		const safeIndex = currentIndex === -1 ? 0 : currentIndex;
		const nextIndex = (safeIndex + offset + this.tabOrder.length) % this.tabOrder.length;
		this.activateTab(this.tabOrder[nextIndex]);
	}

	handleTabButtonKeyDown(tabId, event) {
		const currentIndex = this.tabOrder.indexOf(tabId);
		if (currentIndex === -1) {
			return;
		}

		if (event.key === "ArrowRight") {
			event.preventDefault();
			this.activateTab(this.tabOrder[(currentIndex + 1) % this.tabOrder.length]);
			return;
		}

		if (event.key === "ArrowLeft") {
			event.preventDefault();
			this.activateTab(this.tabOrder[(currentIndex - 1 + this.tabOrder.length) % this.tabOrder.length]);
			return;
		}

		if (event.key === "Home") {
			event.preventDefault();
			this.activateTab(this.tabOrder[0]);
			return;
		}

		if (event.key === "End") {
			event.preventDefault();
			this.activateTab(this.tabOrder[this.tabOrder.length - 1]);
		}
	}

	beginTabDrag(tabId) {
		this.draggedTabId = tabId;
	}
	
	isDragOutsideWindow(event) {
		if (!event || typeof event.screenX !== "number" || typeof event.screenY !== "number") {
			return false;
		}
		
		const left = window.screenX;
		const top = window.screenY;
		const right = left + window.outerWidth;
		const bottom = top + window.outerHeight;
		
		return event.screenX < left || event.screenX > right || event.screenY < top || event.screenY > bottom;
	}

	previewTabDrop(targetTabId, clientX) {
		const targetTab = this.tabs.get(targetTabId);
		if (!targetTab || !this.draggedTabId || this.draggedTabId === targetTabId) {
			return;
		}

		const targetRect = targetTab.button.getBoundingClientRect();
		const insertAfter = clientX > targetRect.left + targetRect.width / 2;
		const draggedButton = this.tabs.get(this.draggedTabId)?.button;
		if (!draggedButton) {
			return;
		}

		if (insertAfter) {
			targetTab.button.insertAdjacentElement("afterend", draggedButton);
		} else {
			targetTab.button.insertAdjacentElement("beforebegin", draggedButton);
		}
	}

	commitTabDrop(targetTabId, clientX) {
		if (!this.draggedTabId) {
			return;
		}

		const sourceIndex = this.tabOrder.indexOf(this.draggedTabId);
		const targetIndex = this.tabOrder.indexOf(targetTabId);
		if (sourceIndex === -1 || targetIndex === -1 || sourceIndex === targetIndex) {
			this.endTabDrag();
			return;
		}

		const targetTab = this.tabs.get(targetTabId);
		const targetRect = targetTab?.button.getBoundingClientRect();
		const insertAfter = targetRect ? clientX > targetRect.left + targetRect.width / 2 : false;

		this.tabOrder.splice(sourceIndex, 1);
		const nextIndex = sourceIndex < targetIndex ? targetIndex + (insertAfter ? 0 : -1) : targetIndex + (insertAfter ? 1 : 0);
		this.tabOrder.splice(Math.max(0, nextIndex), 0, this.draggedTabId);
		this.syncTabButtons();
		this.endTabDrag();
	}

	endTabDrag(event) {
		const tabId = this.draggedTabId;
		this.draggedTabId = null;
		
		if (!tabId || !this.isDragOutsideWindow(event)) {
			return;
		}
		
		const tab = this.tabs.get(tabId);
		if (tab?.sessionId) {
			void this.windowApi.moveSessionToNewWindow(tab.sessionId, {
				windowOptions: {
					fullscreen: false,
				},
			});
		}
	}

	syncTabButtons() {
		for (const tabId of this.tabOrder) {
			const tab = this.tabs.get(tabId);
			if (tab) {
				this.elements.tabStrip.appendChild(tab.button);
			}
		}
	}

	findSurfaceTab(surfaceId) {
		for (const sessionTabs of this.surfaceTabsBySession.values()) {
			const tabId = sessionTabs.get(surfaceId);
			if (tabId) {
				return this.tabs.get(tabId) ?? null;
			}
		}

		return null;
	}
	
	findSurfacePane(surfaceId) {
		return this.surfacePanesById.get(surfaceId)?.pane ?? null;
	}
	
	ensureSurfacePane(surface) {
		const existing = this.surfacePanesById.get(surface.id);
		if (existing) {
			return existing.pane;
		}
		
		const tab = this.tabs.get(this.terminalTabsBySession.get(surface.sessionId));
		if (!tab) {
			return this.ensureSurfaceTab(surface).surfacePane;
		}
		
		const session = this.getSession(surface.sessionId) ?? {
			id: surface.sessionId,
			title: surface.title ?? "HTTY",
			state: {status: "idle"},
			exitInfo: null,
			commandLine: surface.title ?? "HTTY",
			lastSurfacePath: surface.requestPath,
		};
		const pane = new SurfacePane(tab, session, surface);
		tab.pushPane(pane, {activate: tab.id === this.activeTabId});
		this.surfacePanesById.set(surface.id, {tabId: tab.id, pane});
		return pane;
	}
	
	unregisterSurfacePane(_sessionId, surfaceId) {
		this.surfacePanesById.delete(surfaceId);
	}

	ensureSurfaceTab(surface) {
		let sessionTabs = this.surfaceTabsBySession.get(surface.sessionId);
		if (!sessionTabs) {
			sessionTabs = new Map();
			this.surfaceTabsBySession.set(surface.sessionId, sessionTabs);
		}

		const existingId = sessionTabs.get(surface.id);
		if (existingId) {
			return this.tabs.get(existingId);
		}

		const session = this.getSession(surface.sessionId) ?? {
			id: surface.sessionId,
			title: surface.title ?? "HTTY",
			state: {status: "idle"},
			exitInfo: null,
			commandLine: surface.title ?? "HTTY",
			lastSurfacePath: surface.requestPath,
		};
		const tab = new SurfaceTab(this, session, surface);
		this.addTab(tab, {activate: false});
		sessionTabs.set(surface.id, tab.id);
		return tab;
	}

	unregisterSurfaceTab(sessionId, surfaceId) {
		const sessionTabs = this.surfaceTabsBySession.get(sessionId);
		if (!sessionTabs) {
			return;
		}

		sessionTabs.delete(surfaceId);
		if (sessionTabs.size === 0) {
			this.surfaceTabsBySession.delete(sessionId);
		}
	}

	getCurrentSessionId() {
		const activeTab = this.tabs.get(this.activeTabId);
		if (!activeTab) {
			return null;
		}

		return activeTab.sessionId;
	}

	updateEmptyState() {
		this.elements.emptyState.hidden = this.tabOrder.length > 0;
	}

	sendTerminalInput(sessionId, data) {
		this.windowApi.sendInput(sessionId, data);
	}

	resizeTerminal(sessionId, cols, rows) {
		this.windowApi.resize(sessionId, cols, rows);
	}
}