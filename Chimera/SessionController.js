import {spawn} from "node:child_process";
import pty from "node-pty";
import {SESSION_STATUS} from "@socketry/htty";
import {Session} from "@socketry/htty/Session";

import {
	describeCommand,
	inferTitle,
	normalizeRequestPath,
	sanitizeWindowTitle,
} from "./Utilities.js";
import {resolveSessionCwd} from "./SessionDefaults.js";
import {SurfaceController} from "./SurfaceController.js";

export class SessionController {
	constructor(delegate, options) {
		this.delegate = delegate;
		this.application = delegate.application;
		this.id = options.id;
		this.command = options.command;
		this.args = [...options.args];
		this.cwd = resolveSessionCwd(options.cwd);
		this.usePty = options.usePty !== false;
		this.showTerminalTab = options.showTerminalTab !== false;
		this.defaultTitle = inferTitle(this.command, this.args);
		this.title = sanitizeWindowTitle(options.title || this.defaultTitle, this.defaultTitle);
		this.browserDocumentRequests = new Map();
		this.surfaces = new Map();
		this.surfaceIdsByPath = new Map();
		this.lastSurfacePath = "/";
		this.document = null;
		this.closeSessionAfterExit = false;
		this.closeSurfacesWhenProcessExits = false;
		this.closing = false;
		this.session = null;
		this.processHandle = null;
	}

	// ── Session state accessors ────────────────────────────────────────────

	get client() { return this.session?.client ?? null; }
	get transportMode() { return this.session?.mode ?? "terminal"; }
	get exitInfo() { return this.session?.exitInfo ?? null; }

	// ── Identity & logging ─────────────────────────────────────────────────

	get commandLine() {
		return describeCommand(this.command, this.args);
	}

	trace(event, details = {}) {
		this.application.trace(event, details);
	}
	
	setDelegate(delegate) {
		this.delegate = delegate;
		this.application = delegate.application;
	}

	// ── Snapshots ──────────────────────────────────────────────────────────

	snapshot(isActive = false) {
		const snap = this.session?.snapshot(isActive) ?? {};
		return {
			...snap,
			transportMode: snap.mode ?? "terminal",
			id: this.id,
			title: this.title,
			command: this.command,
			commandLine: this.commandLine,
			args: [...this.args],
			cwd: this.cwd,
			showTerminalTab: this.showTerminalTab,
			hasDocument: Boolean(this.document),
			lastSurfacePath: this.lastSurfacePath,
			isActive,
		};
	}

	// ── Process lifecycle ──────────────────────────────────────────────────

	start() {
		this.trace("createSession:start", {
			sessionId: this.id,
			command: this.command,
			args: this.args,
			cwd: this.cwd,
			title: this.title,
		});

		const process = this.usePty ? this.#createPtyProcess() : this.#createPipeProcess();
		this.processHandle = process;

		this.session = new Session(process, {
			id: this.id,
			command: this.command,
			args: this.args,
			cwd: this.cwd,
			title: this.title,
			defaultTitle: this.defaultTitle,
			usePty: this.usePty,
			showTerminalTab: this.showTerminalTab,
		});

		this.#attachSessionListeners();

		this.trace("createSession:done", {sessionId: this.id});
	}

	#createPtyProcess() {
		return pty.spawn(this.command, this.args, {
			name: "xterm-256color",
			cols: 120,
			rows: 40,
			cwd: this.cwd,
			encoding: null,
			env: this.#childEnvironment(),
		});
	}

	#createPipeProcess() {
		const child = spawn(this.command, this.args, {
			cwd: this.cwd,
			env: this.#childEnvironment(),
			stdio: ["pipe", "pipe", "pipe"],
		});

		const stdoutListeners = new Set();
		const stderrListeners = new Set();
		const exitListeners = new Set();
		let stdinClosed = false;

		child.stdout?.on("data", (chunk) => { for (const fn of stdoutListeners) fn(chunk); });
		child.stderr?.on("data", (chunk) => { for (const fn of stderrListeners) fn(chunk); });
		child.stdin?.on("close", () => { stdinClosed = true; });
		child.stdin?.on("error", (error) => {
			if (error?.code === "EPIPE") { stdinClosed = true; return; }
			throw error;
		});
		child.on("exit", (exitCode, signal) => {
			stdinClosed = true;
			for (const fn of exitListeners) fn({exitCode, signal});
		});

		return {
			onStdout(callback) {
				stdoutListeners.add(callback);
				return {dispose() { stdoutListeners.delete(callback); }};
			},
			onStderr(callback) {
				stderrListeners.add(callback);
				return {dispose() { stderrListeners.delete(callback); }};
			},
			onExit(callback) {
				exitListeners.add(callback);
				return {dispose() { exitListeners.delete(callback); }};
			},
			write(data) {
				if (!child.stdin?.writable || stdinClosed) return false;
				const chunk = Buffer.isBuffer(data) || data instanceof Uint8Array
					? Buffer.from(data)
					: Buffer.from(String(data), "latin1");
				try {
					child.stdin.write(chunk);
					return true;
				} catch (error) {
					if (error?.code === "EPIPE") { stdinClosed = true; return false; }
					throw error;
				}
			},
			resize() { return false; },
			kill() { child.kill(); },
			signal(sig) { child.kill(sig); },
		};
	}
	
	#childEnvironment() {
		return {
			...process.env,
			HTTY: "1",
		};
	}

	// ── Session event wiring ───────────────────────────────────────────────

	#attachSessionListeners() {
		const {session} = this;

		session.on("terminal-data", (text) => {
			this.delegate.sessionControllerDidEmitTerminalData(this, text);
		});

		session.on("state", (state) => {
			this.delegate.sessionControllerDidUpdateState(this, state);
			if (state.status === SESSION_STATUS.ATTACHED && state.phase === "ready") {
				this.requestInitialSurface();
			}
		});

		session.on("snapshot", () => {
			this.delegate.sessionControllerDidUpdateSnapshot(this);
		});

		session.on("title", (title) => {
			this.title = title;
			for (const surface of this.surfaces.values()) {
				if (!surface.hasExplicitTitle) {
					surface.title = title;
					this.delegate.sessionControllerDidUpdateSurface(this, surface);
				}
			}
		});

		session.on("reset", () => {
			this.trace("sessionController:reset-to-terminal-mode", {
				sessionId: this.id,
			});
		});

		session.on("attached", () => {
			this.requestInitialSurface();
		});

		session.on("exit", ({exitCode, signal}) => {
			this.trace("terminalProcess:exit", {
				sessionId: this.id,
				exitCode,
				signal,
				sessionSurfaceIds: Array.from(this.surfaces.keys()),
				hasDocument: Boolean(this.document),
			});

			this.browserDocumentRequests.clear();

			if (this.closeSessionAfterExit && this.closeSurfacesWhenProcessExits) {
				this.close();
			}

			this.delegate.sessionControllerDidExit(this, {exitCode, signal});
		});
	}
	
	requestInitialSurface() {
		if (!this.document && !this.browserDocumentRequests.has("/")) {
			this.delegate.sessionControllerDidRequestInitialSurface(this);
		}
	}
	
	// ── Mode control ───────────────────────────────────────────────────────

	isHttyActive() {
		return this.session?.isHttyActive() ?? false;
	}

	setTransportMode(mode) {
		if (!this.session) return this.snapshot(this.delegate.activeSessionId === this.id);

		const prev = this.session.mode;
		const next = this.session.setMode(mode);

		if (prev !== next) {
			this.trace("sessionController:set-transport-mode", {
				sessionId: this.id,
				transportMode: next,
				state: this.session.state,
			});
		}

		return this.snapshot(this.delegate.activeSessionId === this.id);
	}

	// ── Surface management ─────────────────────────────────────────────────

	async attachBrowserSurface(requestPath = "/") {
		if (!this.session?.client) {
			throw new Error("No active HTTY session.");
		}

		const normalizedPath = normalizeRequestPath(requestPath);
		const existingRequest = this.browserDocumentRequests.get(normalizedPath);
		if (existingRequest) return existingRequest;

		const request = this.#attachBrowserSurface(normalizedPath);
		this.browserDocumentRequests.set(normalizedPath, request);
		try {
			return await request;
		} finally {
			this.browserDocumentRequests.delete(normalizedPath);
		}
	}

	async #attachBrowserSurface(normalizedPath) {
		this.trace("attachBrowserSurface:start", {
			sessionId: this.id,
			requestPath: normalizedPath,
			hasDocument: Boolean(this.document),
			sessionSurfaceIds: Array.from(this.surfaces.keys()),
		});

		const surface = await this.createOrReuseSurface(normalizedPath);
		await surface.load(normalizedPath);

		this.trace("attachBrowserSurface:done", {
			surfaceId: surface.id,
			sessionId: this.id,
			requestPath: normalizedPath,
		});

		return surface;
	}

	async createOrReuseSurface(requestPath) {
		const normalizedPath = normalizeRequestPath(requestPath);
		const existingId = this.surfaceIdsByPath.get(normalizedPath);
		if (existingId) {
			this.trace("createSurface:reuse", {
				sessionId: this.id,
				requestPath: normalizedPath,
				existingId,
				sessionSurfaceIds: Array.from(this.surfaces.keys()),
			});
			return this.surfaces.get(existingId);
		}

		const surface = await SurfaceController.create(this, {
			id: this.application.nextSurfaceId(),
			sessionController: this,
			requestPath: normalizedPath,
		});

		this.surfaces.set(surface.id, surface);
		this.surfaceIdsByPath.set(normalizedPath, surface.id);
		this.trace("createSurface:done", {
			surfaceId: surface.id,
			sessionId: this.id,
			requestPath: normalizedPath,
			sessionSurfaceIds: Array.from(this.surfaces.keys()),
		});
		this.delegate.sessionControllerDidCreateSurface(this, surface);
		return surface;
	}

	closeSurface(surfaceId) {
		const surface = this.surfaces.get(surfaceId);
		if (!surface) return false;

		this.surfaces.delete(surfaceId);
		if (this.surfaceIdsByPath.get(surface.requestPath) === surfaceId) {
			this.surfaceIdsByPath.delete(surface.requestPath);
		}

		surface.close();
		this.delegate.sessionControllerDidRemoveSurface(this, surface);
		if (!this.closing && this.surfaces.size === 0) {
			this.delegate.sessionControllerDidCloseLastSurface(this);
		}

		return true;
	}

	// ── Surface event forwarding ───────────────────────────────────────────

	handleSurfaceDocument(surface, requestPath, response, document) {
		this.handleSurfacePathChange(surface, requestPath);
		const payload = {surfaceId: surface.id, path: requestPath, response, document};
		this.document = structuredClone(payload);
		this.delegate.sessionControllerDidUpdateDocument(this, payload);
		this.delegate.sessionControllerDidUpdateSnapshot(this);
	}

	handleSurfaceRequestError(error) {
		this.session.updateState({status: SESSION_STATUS.ERROR, message: error.message});
	}

	handleSurfacePathChange(surface, requestPath) {
		const normalizedPath = normalizeRequestPath(requestPath);
		if (this.surfaceIdsByPath.get(surface.requestPath) === surface.id) {
			this.surfaceIdsByPath.delete(surface.requestPath);
		}

		surface.setPath(normalizedPath);
		this.lastSurfacePath = normalizedPath;
		this.surfaceIdsByPath.set(normalizedPath, surface.id);
		this.delegate.sessionControllerDidUpdateSurface(this, surface);
	}

	handleSurfaceTitleChange(surface, title) {
		const fallback = this.title || "HTTY";
		const nextTitle = sanitizeWindowTitle(title, fallback);
		if (surface.title === nextTitle && surface.hasExplicitTitle) return;

		surface.setTitle(nextTitle);
		this.trace("updateSurfaceTitle", {surfaceId: surface.id, sessionId: this.id, title: nextTitle});
		this.delegate.sessionControllerDidUpdateSurface(this, surface);
	}

	surfaceControllerDidNavigate(surface, requestPath) {
		this.handleSurfacePathChange(surface, requestPath);
	}

	surfaceControllerDidReceiveTitle(surface, title) {
		this.handleSurfaceTitleChange(surface, title);
	}

	surfaceControllerDidRequestInterrupt() {
		return this.sendInterrupt();
	}

	surfaceControllerDidChange(surface) {
		this.delegate.sessionControllerDidUpdateSurface(this, surface);
	}

	// ── Input & interrupts ─────────────────────────────────────────────────

	sendInput(data) {
		return this.session?.sendInput(data) ?? false;
	}

	sendInterrupt() {
		this.trace("sendInterrupt", {
			sessionId: this.id,
			hasSession: Boolean(this.session),
			isHttyActive: this.session?.isHttyActive() ?? false,
		});
		
		if (!this.showTerminalTab) {
			this.closeSessionAfterExit = true;
			this.closeSurfacesWhenProcessExits = true;
			this.close();
			return true;
		}
		
		return this.session?.sendInterrupt() ?? false;
	}

	resize(cols, rows) {
		this.session?.resize(cols, rows);
	}

	interruptAfterLastSurfaceClosed() {
		this.closeSessionAfterExit = true;
		this.closeSurfacesWhenProcessExits = false;
		
		if (this.exitInfo || !this.session) return false;
		
		return this.session.sendInterrupt();
	}

	updateTitle(title) {
		const nextTitle = sanitizeWindowTitle(title, this.defaultTitle);
		this.session?.updateTitle(nextTitle);
		return this.snapshot(this.delegate.activeSessionId === this.id);
	}

	close() {
		if (this.closing) return;
		this.closing = true;

		for (const surfaceId of Array.from(this.surfaces.keys())) {
			this.delegate.closeSurface(surfaceId);
		}

		this.browserDocumentRequests.clear();
		this.session?.close();
	}
}
