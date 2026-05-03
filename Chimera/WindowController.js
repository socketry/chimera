import {BrowserWindow} from "electron";

import {
	inferTitle,
	trace,
	roundBounds,
} from "./Utilities.js";
import {SessionController} from "./SessionController.js";

export class WindowController {
	constructor(application) {
		this.application = application;
		this.window = null;
		this.sessions = new Map();
		this.surfaces = new Map();
		this.activeSessionId = null;
		this.activeSurfaceId = null;
		this.isTabBarHidden = false;
	}

	get id() {
		return this.window?.id ?? null;
	}

	trace(event, details = {}) {
		trace(event, details);
	}

	windowOptions(overrides = {}) {
		return {
			...this.application.configuration.windowOptions(),
			...overrides,
			webPreferences: {
				preload: this.application.preloadPath,
				contextIsolation: true,
				nodeIntegration: false,
				...(overrides.webPreferences ?? {}),
			},
		};
	}

	async create({sessions = [], windowOptions = {}} = {}) {
		this.window = new BrowserWindow(this.windowOptions(windowOptions));
		this.application.windowControllers.set(this.id, this);

		this.window.on("resize", () => {
			if (this.activeSurfaceId) {
				this.syncSurfaceView(this.activeSurfaceId, {visible: true});
			}
		});

		this.window.on("closed", () => {
			const sessionIds = Array.from(this.sessions.keys());
			this.window = null;
			this.activeSurfaceId = null;
			this.activeSessionId = null;

			for (const sessionId of sessionIds) {
				this.closeSession(sessionId);
			}
			this.application.unregisterWindowController(this);
		});

		for (const session of sessions) {
			this.adoptSession(session, {emit: false});
		}
		
		await this.window.loadFile(this.application.rendererPath);
		await this.applyUserTheme();
		return this;
	}

	async applyUserTheme() {
		const stylesheet = this.application.configuration.themeStylesheet();
		if (!stylesheet) return;
		
		await this.window.webContents.insertCSS(stylesheet, {cssOrigin: "author"});
	}

	hasSender(sender) {
		return this.window?.webContents?.id === sender.id;
	}

	emitToRenderer(channel, payload) {
		if (!this.window || this.window.isDestroyed() || this.window.webContents.isDestroyed()) {
			return;
		}

		this.window.webContents.send(channel, payload);
	}

	focusMainRenderer(reason) {
		if (!this.window?.webContents || this.window.webContents.isDestroyed()) {
			return;
		}

		this.trace("focusMainRenderer", {windowId: this.id, reason});
		this.window.webContents.focus();
	}

	snapshotSessions() {
		return Array.from(this.sessions.values(), (session) => session.snapshot(session.id === this.activeSessionId));
	}

	getSession(sessionId = this.activeSessionId) {
		return sessionId ? this.sessions.get(sessionId) : null;
	}

	setActiveSession(sessionId) {
		this.activeSessionId = this.sessions.has(sessionId) ? sessionId : null;

		for (const session of this.sessions.values()) {
			this.emitSessionUpdated(session);
		}

		return this.activeSessionId;
	}

	emitSessionCreated(session) {
		this.emitToRenderer("session:created", session.snapshot(session.id === this.activeSessionId));
	}

	emitSessionUpdated(session) {
		this.emitToRenderer("session:updated", session.snapshot(session.id === this.activeSessionId));
	}

	emitSessionRemoved(sessionId) {
		this.emitToRenderer("session:removed", {sessionId});
	}

	emitSurfaceCreated(surface) {
		this.emitToRenderer("surface:created", surface.snapshot(surface.id === this.activeSurfaceId));
	}

	emitSurfaceUpdated(surface) {
		this.emitToRenderer("surface:updated", surface.snapshot(surface.id === this.activeSurfaceId));
	}

	emitSurfaceRemoved(surfaceId) {
		this.emitToRenderer("surface:removed", {surfaceId});
	}

	createSession(command = process.env.SHELL || "/bin/zsh", args = [], options = {}) {
		const session = new SessionController(this, {
			id: this.application.nextSessionId(),
			command,
			args,
			cwd: options.cwd,
			usePty: options.usePty,
			showTerminalTab: options.showTerminalTab,
			title: options.title || inferTitle(command, args),
		});

		this.sessions.set(session.id, session);
		this.setActiveSession(session.id);
		this.emitSessionCreated(session);
		session.start();
		this.trace("createSession:registered", {
			windowId: this.id,
			sessionId: session.id,
			sessionIds: Array.from(this.sessions.keys()),
		});
		return session.snapshot(true);
	}
	
	adoptSession(session, {emit = true} = {}) {
		session.setDelegate(this);
		this.sessions.set(session.id, session);
		this.setActiveSession(session.id);
		
		for (const surface of session.surfaces.values()) {
			this.surfaces.set(surface.id, surface);
		}
		
		if (emit) {
			this.emitSessionCreated(session);
			for (const surface of session.surfaces.values()) {
				this.emitSurfaceCreated(surface);
			}
		}
		
		this.trace("adoptSession", {
			windowId: this.id,
			sessionId: session.id,
			surfaceIds: Array.from(session.surfaces.keys()),
		});
		
		return session.snapshot(true);
	}
	
	releaseSession(sessionId) {
		const session = this.sessions.get(sessionId);
		if (!session) {
			return null;
		}
		
		for (const surface of session.surfaces.values()) {
			this.detachSurfaceView(surface.id);
			this.surfaces.delete(surface.id);
		}
		
		this.sessions.delete(sessionId);
		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.sessions.keys().next().value ?? null;
		}
		
		this.emitSessionRemoved(sessionId);
		for (const remainingSession of this.sessions.values()) {
			this.emitSessionUpdated(remainingSession);
		}
		
		this.trace("releaseSession", {
			windowId: this.id,
			sessionId,
			remainingSessionIds: Array.from(this.sessions.keys()),
		});
		
		return session;
	}

	async attachBrowserSurface(sessionId = this.activeSessionId, requestPath = "/") {
		const session = this.getSession(sessionId);
		if (!session?.client) {
			throw new Error("No active HTTY session.");
		}

		const surface = await session.attachBrowserSurface(requestPath);
		return surface.snapshot(surface.id === this.activeSurfaceId);
	}

	attachSurfaceView(surface) {
		if (!this.window) {
			return;
		}

		const isAlreadyActive = this.activeSurfaceId === surface.id;
		const isAlreadyAttached = this.window.contentView.children.includes(surface.view);
		if (isAlreadyActive && isAlreadyAttached) {
			if (surface.bounds) {
				surface.view.setBounds(roundBounds(surface.bounds));
			}

			surface.visible = true;
			surface.view.setVisible(true);
			return;
		}

		this.trace("attachSurfaceView:start", {
			windowId: this.id,
			surfaceId: surface.id,
			sessionId: surface.sessionId,
			requestPath: surface.requestPath,
			activeSurfaceId: this.activeSurfaceId,
		});

		if (this.activeSurfaceId && this.activeSurfaceId !== surface.id) {
			const activeSurface = this.surfaces.get(this.activeSurfaceId);
			if (activeSurface) {
				activeSurface.visible = false;
				activeSurface.view.setVisible(false);
			}
		}

		if (!this.window.contentView.children.includes(surface.view)) {
			this.window.contentView.addChildView(surface.view);
		}

		if (surface.bounds) {
			surface.view.setBounds(roundBounds(surface.bounds));
		}

		this.activeSurfaceId = surface.id;
		surface.visible = true;
		surface.view.setVisible(true);

		this.trace("attachSurfaceView:done", {
			windowId: this.id,
			surfaceId: surface.id,
			sessionId: surface.sessionId,
			activeSurfaceId: this.activeSurfaceId,
		});
	}

	detachSurfaceView(surfaceId) {
		const surface = this.surfaces.get(surfaceId);
		this.trace("detachSurfaceView:start", {
			windowId: this.id,
			surfaceId,
			hasSurface: Boolean(surface),
			activeSurfaceId: this.activeSurfaceId,
		});

		if (!surface || !this.window) {
			if (this.activeSurfaceId === surfaceId) {
				this.activeSurfaceId = null;
				this.focusMainRenderer("detachSurfaceView:missing-surface");
			}
			return;
		}

		surface.visible = false;
		if (this.window.isDestroyed()) {
			if (this.activeSurfaceId === surfaceId) {
				this.activeSurfaceId = null;
			}
			return;
		}

		try {
			surface.view.setVisible(false);
			if (this.window.contentView.children.includes(surface.view)) {
				this.window.contentView.removeChildView(surface.view);
			}
		} catch {
			// Ignore teardown races when Electron destroys the view before we detach it.
		}

		if (this.activeSurfaceId === surfaceId) {
			this.activeSurfaceId = null;
			this.focusMainRenderer("detachSurfaceView:active-surface-removed");
		}
	}

	syncSurfaceView(surfaceId, state = {}) {
		const surface = this.surfaces.get(surfaceId);
		if (!surface) {
			return;
		}

		surface.applyViewState(state);

		if (!state.visible) {
			try {
				surface.view.setVisible(false);
			} catch {
				// Ignore teardown races when the surface view is already gone.
			}
			if (this.activeSurfaceId === surfaceId) {
				this.activeSurfaceId = null;
				this.focusMainRenderer("syncSurfaceView:hidden");
			}
			this.emitSurfaceUpdated(surface);
			return;
		}

		this.attachSurfaceView(surface);
		if (surface.bounds) {
			surface.view.setBounds(roundBounds(surface.bounds));
		}

		if (surface.focused) {
			surface.view.webContents.focus();
		}

		this.emitSurfaceUpdated(surface);
	}

	closeSurface(surfaceId) {
		const surface = this.surfaces.get(surfaceId);
		this.trace("closeSurface:start", {
			windowId: this.id,
			surfaceId,
			hasSurface: Boolean(surface),
			activeSurfaceId: this.activeSurfaceId,
		});
		if (!surface) {
			return false;
		}

		this.detachSurfaceView(surfaceId);
		const session = this.sessions.get(surface.sessionId);
		session?.closeSurface(surfaceId);
		this.trace("closeSurface:done", {
			windowId: this.id,
			surfaceId,
			sessionId: surface.sessionId,
			remainingSurfaceIds: session ? Array.from(session.surfaces.keys()) : [],
			activeSurfaceId: this.activeSurfaceId,
		});
		return true;
	}

	showActiveSurfaceDeveloperTools() {
		const surface = this.activeSurfaceId ? this.surfaces.get(this.activeSurfaceId) : null;
		return surface?.showDeveloperTools() ?? false;
	}

	closeSession(sessionId) {
		const session = this.sessions.get(sessionId);
		this.trace("closeSession:start", {
			windowId: this.id,
			sessionId,
			hasSession: Boolean(session),
			activeSessionId: this.activeSessionId,
			sessionIds: Array.from(this.sessions.keys()),
		});

		if (!session) {
			return false;
		}

		session.close();
		this.finalizeSessionRemoval(sessionId);

		this.trace("closeSession:done", {
			windowId: this.id,
			sessionId,
			activeSessionId: this.activeSessionId,
			remainingSessionIds: Array.from(this.sessions.keys()),
		});
		return true;
	}

	finalizeSessionRemoval(sessionId) {
		if (!this.sessions.has(sessionId)) {
			return false;
		}

		this.sessions.delete(sessionId);

		if (this.activeSessionId === sessionId) {
			this.activeSessionId = this.sessions.keys().next().value ?? null;
		}

		this.emitSessionRemoved(sessionId);
		for (const remainingSession of this.sessions.values()) {
			this.emitSessionUpdated(remainingSession);
		}

		if (this.sessions.size === 0 && this.window && !this.window.isDestroyed()) {
			this.window.close();
		}

		return true;
	}

	updateSessionTitle(sessionId, title) {
		const session = this.sessions.get(sessionId);
		return session?.updateTitle(title) ?? null;
	}

	setSessionTransportMode(sessionId, mode) {
		const session = this.getSession(sessionId);
		return session?.setTransportMode(mode) ?? null;
	}

	interruptSession(sessionId) {
		return this.getSession(sessionId)?.sendInterrupt() ?? false;
	}

	closeActiveTab() {
		this.emitToRenderer("chimera:close-active-tab", {});
	}

	activateRelativeTab(offset) {
		if (!Number.isFinite(offset) || offset === 0) {
			return;
		}

		this.emitToRenderer("chimera:activate-relative-tab", {offset});
	}
	
	toggleTabBar(force) {
		this.isTabBarHidden = typeof force === "boolean" ? force : !this.isTabBarHidden;
		this.emitToRenderer("chimera:tab-bar-hidden", {hidden: this.isTabBarHidden});
	}

	sessionControllerDidEmitTerminalData(session, data) {
		this.emitToRenderer("session:terminal-data", {sessionId: session.id, data});
	}

	sessionControllerDidUpdateState(session, state) {
		this.emitToRenderer("session:state", {sessionId: session.id, state});
	}

	sessionControllerDidUpdateDocument(session, payload) {
		this.emitToRenderer("session:document", {sessionId: session.id, payload});
	}

	sessionControllerDidExit(session, {exitCode, signal}) {
		this.emitToRenderer("session:exit", {sessionId: session.id, exitCode, signal});
		if (session.closeSessionAfterExit && session.surfaces.size === 0) {
			this.finalizeSessionRemoval(session.id);
		}
	}

	sessionControllerDidUpdateSnapshot(session) {
		if (!this.sessions.has(session.id)) {
			return;
		}

		this.emitSessionUpdated(session);
	}

	sessionControllerDidCreateSurface(_session, surface) {
		this.surfaces.set(surface.id, surface);
		this.emitSurfaceCreated(surface);
	}

	sessionControllerDidUpdateSurface(_session, surface) {
		this.emitSurfaceUpdated(surface);
	}

	sessionControllerDidRemoveSurface(_session, surface) {
		this.surfaces.delete(surface.id);
		this.emitSurfaceRemoved(surface.id);
	}

	sessionControllerDidCloseLastSurface(session) {
		const interruptSent = session.interruptAfterLastSurfaceClosed();
		if (!interruptSent) {
			this.finalizeSessionRemoval(session.id);
		}
	}

	sessionControllerDidRequestBookmarksRefresh() {
		this.application.buildApplicationMenu();
	}

	sessionControllerDidRequestInitialSurface(session) {
		this.attachBrowserSurface(session.id, "/").catch((error) => {
			session.handleSurfaceRequestError(error);
		});
	}

	handleInput(sessionId, data) {
		this.getSession(sessionId)?.sendInput(data);
	}

	handleResize(sessionId, cols, rows) {
		this.getSession(sessionId)?.resize(cols, rows);
	}
}
