import {TerminalTab} from "./tabs/terminal-tab.js";
import {SurfaceTab} from "./tabs/surface-tab.js";
import {DebugTab} from "./tabs/debug-tab.js";

function normalizeRequestPath(value, fallback = "/") {
	const text = String(value ?? "").trim();

	if (!text) {
		return fallback;
	}

	if (text.startsWith("http://") || text.startsWith("https://")) {
		try {
			const url = new URL(text);
			return `${url.pathname || "/"}${url.search}`;
		} catch {
			return fallback;
		}
	}

	if (text.startsWith("/")) {
		return text;
	}

	if (text.includes(" ")) {
		return fallback;
	}

	return `/${text}`;
}

export class WorkspaceController {
	constructor(windowApi, elements) {
		this.windowApi = windowApi;
		this.elements = elements;
		this.sessions = new Map();
		this.tabs = new Map();
		this.tabOrder = [];
		this.terminalTabsBySession = new Map();
		this.surfaceTabsBySession = new Map();
		this.activeTabId = null;
		this.draggedTabId = null;
		this.debugTab = null;
		this.debugSessionId = null;
	}

	async initialize() {
		this.bindWindowEvents();
		this.bindDomEvents();

		const initialSessions = await this.windowApi.getSessions();
		for (const session of initialSessions) {
			this.upsertSession(session);
		}

		if (initialSessions.length === 0) {
			await this.windowApi.start();
		} else {
			this.activateTab(`terminal:${initialSessions[0].id}`);
		}

		this.updateEmptyState();
		this.updateAddressBar();
	}

	bindWindowEvents() {
		window.addEventListener("resize", () => {
			const activeTab = this.tabs.get(this.activeTabId);
			if (activeTab instanceof TerminalTab) {
				activeTab.fit();
			} else if (activeTab instanceof SurfaceTab) {
				activeTab.syncBrowserView();
			}
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
			this.activateTab(`terminal:${session.id}`);
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

			const surfaceTab = this.findSurfaceTab(payload.surfaceId);
			surfaceTab?.setDocumentSummary(payload);
			void this.refreshDebugSnapshot();
		});

		this.windowApi.onSurfaceCreated((surface) => {
			const surfaceTab = this.ensureSurfaceTab(surface);
			this.activateTab(surfaceTab.id);
		});

		this.windowApi.onSurfaceUpdated((surface) => {
			this.findSurfaceTab(surface.id)?.updateSurface(surface);
			this.updateAddressBar();
		});

		this.windowApi.onSurfaceRemoved(({surfaceId}) => {
			const tab = this.findSurfaceTab(surfaceId);
			if (!tab) {
				return;
			}

			this.unregisterSurfaceTab(tab.sessionId, surfaceId);
			this.removeTab(tab.id);
		});

		this.windowApi.onResponse(({sessionId}) => {
			if (this.debugSessionId === sessionId) {
				void this.refreshDebugSnapshot();
			}
		});

		this.windowApi.onPacket(({sessionId}) => {
			if (this.debugSessionId === sessionId) {
				void this.refreshDebugSnapshot();
			}
		});

		this.windowApi.onState(({sessionId}) => {
			this.refreshSessionTabs(sessionId);
			if (this.debugSessionId === sessionId) {
				void this.refreshDebugSnapshot();
			}
		});

		this.windowApi.onExit(({sessionId, exitCode, signal}) => {
			const terminalTab = this.tabs.get(this.terminalTabsBySession.get(sessionId));
			terminalTab?.writeExit(exitCode, signal);
			this.refreshSessionTabs(sessionId);
			if (this.debugSessionId === sessionId) {
				void this.refreshDebugSnapshot();
			}
		});

		this.windowApi.onShowDebugTab(() => {
			this.showDebugTab();
		});

		this.windowApi.onFocusAddressBar(() => {
			this.focusAddressBar();
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

		if (activeTab instanceof TerminalTab) {
			return !target || !target.closest(".xterm");
		}

		return Boolean(this.getCurrentSessionId());
	}

	sendInterruptToActiveSession() {
		const sessionId = this.getCurrentSessionId();
		if (!sessionId) {
			return;
		}

		this.sendTerminalInput(sessionId, "\u0003");
	}

	bindDomEvents() {
		const {
			addressForm,
			addressInput,
		} = this.elements;

		addressForm.addEventListener("submit", async (event) => {
			event.preventDefault();
			await this.openAddress(addressInput.value);
		});
	}

	getSession(sessionId) {
		return sessionId ? this.sessions.get(sessionId) : null;
	}

	setDebugSession(sessionId) {
		this.debugSessionId = sessionId;
		this.updateAddressBar();
	}

	async refreshDebugSnapshot() {
		if (!this.debugTab) {
			return;
		}

		this.refreshDebugSessions();

		if (!this.debugSessionId || !this.sessions.has(this.debugSessionId)) {
			this.debugTab.renderDebugState(null);
			return;
		}

		const debugState = await this.windowApi.getSessionDebugState(this.debugSessionId);
		this.debugTab.renderDebugState(debugState);
		this.updateAddressBar();
	}

	refreshDebugSessions() {
		if (!this.debugTab) {
			return;
		}

		const sessionOptions = Array.from(this.sessions.values());

		if (!this.debugSessionId || !this.sessions.has(this.debugSessionId)) {
			this.debugSessionId = this.getCurrentSessionId() || sessionOptions[0]?.id || null;
		}

		this.debugTab.setSessions(sessionOptions, this.debugSessionId);
	}

	upsertSession(session) {
		this.sessions.set(session.id, session);

		let terminalTab = this.tabs.get(this.terminalTabsBySession.get(session.id));
		if (!terminalTab) {
			terminalTab = new TerminalTab(this, session);
			this.addTab(terminalTab, {activate: false});
			this.terminalTabsBySession.set(session.id, terminalTab.id);
		}

		terminalTab.updateSession(session);
		this.refreshSessionTabs(session.id);
		this.refreshDebugSessions();
		this.updateAddressBar();
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

		if (this.debugSessionId === sessionId) {
			this.debugSessionId = this.getCurrentSessionId() || Array.from(this.sessions.keys())[0] || null;
		}

		this.refreshDebugSessions();
		void this.refreshDebugSnapshot();
		this.updateAddressBar();
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
				this.activateTab(nextTabId);
			}
		}

		this.updateEmptyState();
		this.updateAddressBar();
	}

	closeTab(tabId) {
		const tab = this.tabs.get(tabId);
		if (!tab) {
			return;
		}

		if (tab instanceof TerminalTab) {
			void this.windowApi.closeSession(tab.sessionId);
			return;
		}

		if (tab instanceof SurfaceTab) {
			void this.windowApi.closeSurface(tab.surfaceId);
			return;
		}

		if (tab instanceof DebugTab) {
			this.debugTab = null;
			this.removeTab(tab.id);
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

		if (nextTab instanceof DebugTab) {
			this.refreshDebugSessions();
			void this.refreshDebugSnapshot();
			if (this.debugSessionId) {
				void this.windowApi.setActiveSession(this.debugSessionId);
			}
		} else if (nextTab.sessionId) {
			this.debugSessionId = nextTab.sessionId;
			void this.windowApi.setActiveSession(nextTab.sessionId);
		}

		this.updateAddressBar();
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

	endTabDrag() {
		this.draggedTabId = null;
	}

	syncTabButtons() {
		for (const tabId of this.tabOrder) {
			const tab = this.tabs.get(tabId);
			if (tab) {
				this.elements.tabStrip.appendChild(tab.button);
			}
		}
	}

	showDebugTab() {
		if (!this.debugTab) {
			this.debugTab = new DebugTab(this);
			this.addTab(this.debugTab, {activate: false});
		}

		if (!this.debugSessionId) {
			this.debugSessionId = this.getCurrentSessionId() || Array.from(this.sessions.keys())[0] || null;
		}

		this.activateTab(this.debugTab.id);
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

		const session = this.getSession(surface.sessionId);
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

		if (activeTab instanceof DebugTab) {
			return this.debugSessionId;
		}

		return activeTab.sessionId;
	}

	updateEmptyState() {
		this.elements.emptyState.hidden = this.tabOrder.length > 0;
	}

	updateAddressBar() {
		const activeTab = this.tabs.get(this.activeTabId);
		const {
			addressInput,
			addressSubmitButton,
		} = this.elements;
		const isEditingAddress = document.activeElement === addressInput;

		if (!activeTab) {
			if (!isEditingAddress) {
				addressInput.value = "";
			}
			addressInput.placeholder = "Open a shell or surface tab";
			addressInput.setAttribute("aria-label", "No active tab");
			addressSubmitButton.disabled = true;
			addressSubmitButton.textContent = "Go";
			return;
		}

		const addressState = activeTab.getAddressState();
		if (!isEditingAddress) {
			addressInput.value = addressState.value;
		}
		addressInput.placeholder = activeTab instanceof SurfaceTab ? "Enter a request path" : "Enter a /path to open a surface tab";
		addressInput.setAttribute("aria-label", `${addressState.kind}: ${addressState.detail}`);
		addressSubmitButton.textContent = addressState.submitLabel;
		addressSubmitButton.disabled = !this.getCurrentSessionId();
	}

	focusAddressBar() {
		this.elements.addressInput.focus();
		this.elements.addressInput.select();
	}

	async openAddress(rawValue) {
		const sessionId = this.getCurrentSessionId();
		if (!sessionId) {
			return;
		}

		const activeTab = this.tabs.get(this.activeTabId);
		const fallback = activeTab instanceof SurfaceTab ? activeTab.requestPath : this.getSession(sessionId)?.lastSurfacePath || "/";
		const requestPath = normalizeRequestPath(rawValue, fallback);

		const surface = await this.windowApi.attachBrowser(sessionId, requestPath);
		const surfaceTab = this.ensureSurfaceTab(surface);
		this.activateTab(surfaceTab.id);
	}

	sendTerminalInput(sessionId, data) {
		this.windowApi.sendInput(sessionId, data);
	}

	resizeTerminal(sessionId, cols, rows) {
		this.windowApi.resize(sessionId, cols, rows);
	}
}