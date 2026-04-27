import {app, BrowserWindow, ipcMain, Menu, protocol, WebContentsView} from "electron";
import pty from "node-pty";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {HTTYClientSession, HTTYDecoder, SESSION_STATUS} from "@socketry/htty";

import {browserDocumentForResponse} from "./browser-surface.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const httyJsRoot = path.resolve(projectRoot, "../htty-js");
const isE2E = process.env.CHIMERA_E2E === "1";

const httyHelloWorldScript = path.join(httyJsRoot, "examples/hello-world.mjs");
const httyBrowserDemoScript = path.join(httyJsRoot, "examples/browser-demo.mjs");
const SURFACE_VIEW_STATE_BRIDGE = `(() => {
	if (window.__chimeraSetViewState) {
		return;
	}

	let visible = true;
	let focused = true;
	const visibilityListeners = new Set();
	const nativeAddEventListener = document.addEventListener.bind(document);
	const nativeRemoveEventListener = document.removeEventListener.bind(document);

	const defineProperty = (target, name, descriptor) => {
		try {
			Object.defineProperty(target, name, descriptor);
		} catch {
			// Chromium may reject some document property overrides.
		}
	};

	const applyVisibilityState = (nextVisible) => {
		if (visible === nextVisible) {
			return;
		}

		visible = nextVisible;
		const event = new Event("visibilitychange");
		for (const listener of visibilityListeners) {
			if (typeof listener === "function") {
				listener.call(document, event);
			} else {
				listener.handleEvent?.(event);
			}
		}

		document.onvisibilitychange?.call(document, event);
		window.dispatchEvent(new Event(visible ? "pageshow" : "pagehide"));
	};

	const applyFocusState = (nextFocused) => {
		if (focused === nextFocused) {
			return;
		}

		focused = nextFocused;
		window.dispatchEvent(new Event(focused ? "focus" : "blur"));
	};

	document.addEventListener = (type, listener, options) => {
		if (type === "visibilitychange" && listener) {
			visibilityListeners.add(listener);
		}

		return nativeAddEventListener(type, listener, options);
	};

	document.removeEventListener = (type, listener, options) => {
		if (type === "visibilitychange" && listener) {
			visibilityListeners.delete(listener);
		}

		return nativeRemoveEventListener(type, listener, options);
	};

	defineProperty(document, "hidden", {
		configurable: true,
		get() {
			return !visible;
		},
	});

	defineProperty(document, "visibilityState", {
		configurable: true,
		get() {
			return visible ? "visible" : "hidden";
		},
	});

	defineProperty(document, "hasFocus", {
		configurable: true,
		value() {
			return focused;
		},
	});

	window.__chimeraSetViewState = ({visible: nextVisible, focused: nextFocused}) => {
		applyVisibilityState(Boolean(nextVisible));
		applyFocusState(Boolean(nextFocused));
	};
})();`;
protocol.registerSchemesAsPrivileged([
	{
		scheme: "htty",
		privileges: {
			standard: true,
			secure: true,
			supportFetchAPI: true,
			corsEnabled: true,
		},
	},
]);

let mainWindow = null;
let sessionCounter = 0;
let surfaceCounter = 0;
let activeSessionId = null;
let activeSurfaceId = null;

const sessions = new Map();
const surfaces = new Map();

function normalizeRequestPath(value = "/") {
	const text = String(value ?? "").trim();

	if (!text) {
		return "/";
	}

	if (text.startsWith("http://") || text.startsWith("https://")) {
		try {
			const url = new URL(text);
			return `${url.pathname || "/"}${url.search}`;
		} catch {
			return "/";
		}
	}

	if (text.startsWith("/")) {
		return text;
	}

	return `/${text}`;
}

function createDebugState() {
	return {
		packetCount: 0,
		packets: [],
		state: {status: SESSION_STATUS.IDLE},
		document: null,
		responseText: "No response yet.",
	};
}

function nextSurfaceId() {
	surfaceCounter += 1;
	return `surface-${surfaceCounter}`;
	}

function nextSessionId() {
	sessionCounter += 1;
	return `session-${sessionCounter}`;
}

function toSurfaceURL(sessionId, requestPath = "/") {
	return `htty://${sessionId}${normalizeRequestPath(requestPath)}`;
}

function parseSurfaceURL(urlString) {
	const url = new URL(urlString);
	return {
		sessionId: url.host,
		requestPath: normalizeRequestPath(`${url.pathname || "/"}${url.search}`),
	};
}

function describeCommand(command, args = []) {
	return [command, ...args].join(" ");
}

function inferTitle(command, args = []) {
	const description = describeCommand(command, args);

	if (description === (process.env.SHELL || "/bin/zsh")) {
		return "Shell";
	}

	if (description.includes("examples/hello-world.mjs") || description.includes("examples/hello_world.rb")) {
		return "HTTY Hello World";
	}

	if (description.includes("examples/browser-demo.mjs") || description.includes("examples/browser_demo.rb")) {
		return "HTTY Browser Demo";
	}

	return args.length > 0 ? description : path.basename(command);
}

function createHttyDemoSession(scriptPath, title) {
	return createSession("node", [scriptPath], {cwd: httyJsRoot, title});
}

function snapshotSession(session) {
	return {
		id: session.id,
		title: session.title,
		command: session.command,
		commandLine: describeCommand(session.command, session.args),
		args: [...session.args],
		cwd: session.cwd,
		state: {...session.debugState.state},
		hasDocument: Boolean(session.debugState.document),
		lastSurfacePath: session.lastSurfacePath,
		exitInfo: session.exitInfo,
		isActive: session.id === activeSessionId,
	};
}

function snapshotSurface(surface) {
	return {
		id: surface.id,
		sessionId: surface.sessionId,
		requestPath: surface.requestPath,
		title: surface.title,
		isActive: surface.id === activeSurfaceId,
	};
}

function snapshotSessions() {
	return Array.from(sessions.values(), snapshotSession);
}

function snapshotDebugState(session) {
	if (!session) {
		return null;
	}

	return {
		sessionId: session.id,
		title: session.title,
		commandLine: describeCommand(session.command, session.args),
		packetCount: session.debugState.packetCount,
		packets: [...session.debugState.packets],
		state: {...session.debugState.state},
		document: session.debugState.document ? structuredClone(session.debugState.document) : null,
		lastSurfacePath: session.lastSurfacePath,
		responseText: session.debugState.responseText,
		exitInfo: session.exitInfo,
	};
}

function emitToRenderer(channel, payload) {
	mainWindow?.webContents.send(channel, payload);
}

function emitSessionCreated(session) {
	emitToRenderer("session:created", snapshotSession(session));
}

function emitSessionUpdated(session) {
	emitToRenderer("session:updated", snapshotSession(session));
}

function emitSessionRemoved(sessionId) {
	emitToRenderer("session:removed", {sessionId});
}

function emitSurfaceCreated(surface) {
	emitToRenderer("surface:created", snapshotSurface(surface));
}

function emitSurfaceUpdated(surface) {
	emitToRenderer("surface:updated", snapshotSurface(surface));
}

function emitSurfaceRemoved(surfaceId) {
	emitToRenderer("surface:removed", {surfaceId});
}

function updatePacketState(session, packet) {
	session.debugState.packetCount += 1;
	session.debugState.packets.unshift(packet);

	while (session.debugState.packets.length > 12) {
		session.debugState.packets.pop();
	}

	emitToRenderer("session:packet", {sessionId: session.id, packet});
}

function updateState(session, state) {
	session.debugState.state = {...state};
	emitToRenderer("session:state", {sessionId: session.id, state});
	emitSessionUpdated(session);
}

function updateDocument(session, payload) {
	session.debugState.document = payload ? structuredClone(payload) : null;
	emitToRenderer("session:document", {sessionId: session.id, payload});
	emitSessionUpdated(session);
}

function updateResponseText(session, text) {
	session.debugState.responseText = text;
	emitToRenderer("session:response", {sessionId: session.id, text});
}

function getSession(sessionId = activeSessionId) {
	return sessionId ? sessions.get(sessionId) : null;
}

function setActiveSession(sessionId) {
	activeSessionId = sessions.has(sessionId) ? sessionId : null;

	for (const session of sessions.values()) {
		emitSessionUpdated(session);
	}

	return activeSessionId;
}

function roundBounds(bounds) {
	return {
		x: Math.round(bounds.x),
		y: Math.round(bounds.y),
		width: Math.max(1, Math.round(bounds.width)),
		height: Math.max(1, Math.round(bounds.height)),
	};
}

function attachSurfaceView(surface) {
	if (!mainWindow) {
		return;
	}

	if (activeSurfaceId && activeSurfaceId !== surface.id) {
		detachSurfaceView(activeSurfaceId);
	}

	mainWindow.contentView.addChildView(surface.view);

	if (surface.bounds) {
		surface.view.setBounds(roundBounds(surface.bounds));
	}

	activeSurfaceId = surface.id;
	surface.visible = true;
}

function detachSurfaceView(surfaceId) {
	const surface = surfaces.get(surfaceId);
	if (!surface || !mainWindow) {
		if (activeSurfaceId === surfaceId) {
			activeSurfaceId = null;
		}
		return;
	}

	surface.visible = false;
	if (mainWindow.contentView.children.includes(surface.view)) {
		mainWindow.contentView.removeChildView(surface.view);
	}
	if (activeSurfaceId === surfaceId) {
		activeSurfaceId = null;
	}
}

function syncSurfaceView(surfaceId, state = {}) {
	const surface = surfaces.get(surfaceId);
	if (!surface) {
		return;
	}

	surface.bounds = state.bounds ?? surface.bounds;
	surface.focused = Boolean(state.focused);

	if (!state.visible) {
		void pushSurfaceViewState({...surface, visible: false, focused: false});
		surface.visible = false;
		surface.focused = false;
		detachSurfaceView(surfaceId);
		emitSurfaceUpdated(surface);
		return;
	}

	attachSurfaceView(surface);
	if (surface.bounds) {
		surface.view.setBounds(roundBounds(surface.bounds));
	}

	if (surface.focused) {
		surface.view.webContents.focus();
	}

	void pushSurfaceViewState(surface);

	emitSurfaceUpdated(surface);
}

function updateSurfacePath(surface, requestPath) {
	const session = sessions.get(surface.sessionId);
	if (!session) {
		return;
	}

	if (session.surfaceIdsByPath.get(surface.requestPath) === surface.id) {
		session.surfaceIdsByPath.delete(surface.requestPath);
	}

	surface.requestPath = requestPath;
	session.surfaceIdsByPath.set(requestPath, surface.id);
	emitSurfaceUpdated(surface);
}

function surfaceErrorResponse(status, message) {
	return new Response(message, {
		status,
		headers: {
			"content-type": "text/plain; charset=utf-8",
		},
	});
}

async function installSurfaceViewBridge(surface) {
	await surface.view.webContents.executeJavaScript(SURFACE_VIEW_STATE_BRIDGE);
}

async function pushSurfaceViewState(surface) {
	await surface.view.webContents.executeJavaScript(`window.__chimeraSetViewState?.(${JSON.stringify({
		visible: surface.visible,
		focused: surface.focused,
	})})`);
}

async function handleSurfaceRequest(surface, request) {
	const {sessionId, requestPath} = parseSurfaceURL(request.url);
	if (sessionId !== surface.sessionId) {
		return surfaceErrorResponse(403, "Cross-session HTTY navigation is not supported.");
	}

	const session = sessions.get(sessionId);
	if (!session?.httySession) {
		return surfaceErrorResponse(410, "HTTY session is no longer available.");
	}

	try {
		const response = await session.httySession.request({path: requestPath});
		const document = browserDocumentForResponse(response);

		updateSurfacePath(surface, requestPath);
		updateDocument(session, {
			surfaceId: surface.id,
			path: requestPath,
			response,
			document,
		});
		updateResponseText(session, JSON.stringify(response, null, 2));

		return new Response(document.body, {
			status: response.status,
			headers: {
				"content-type": document.contentType,
			},
		});
	} catch (error) {
		updateState(session, {status: SESSION_STATUS.ERROR, message: error.message});
		updateResponseText(session, error.message);
		return surfaceErrorResponse(500, error.message);
	}
}

async function createSurface(sessionId, requestPath) {
	const session = sessions.get(sessionId);
	if (!session) {
		throw new Error("No active HTTY session.");
	}

	const normalizedPath = normalizeRequestPath(requestPath);
	const existingId = session.surfaceIdsByPath.get(normalizedPath);
	if (existingId) {
		return surfaces.get(existingId);
	}

	const id = nextSurfaceId();
	const view = new WebContentsView({
		webPreferences: {
			contextIsolation: true,
			nodeIntegration: false,
			sandbox: true,
			partition: `htty-surface:${id}`,
		},
	});

	const surface = {
		id,
		sessionId,
		requestPath: normalizedPath,
		title: session.title,
		view,
		visible: false,
		focused: false,
		bounds: null,
	};

	if (typeof view.setBackgroundColor === "function") {
		view.setBackgroundColor("#050914");
	}
	view.setVisible(false);
	view.webContents.setWindowOpenHandler(() => ({action: "deny"}));
	await view.webContents.session.protocol.handle("htty", (request) => handleSurfaceRequest(surface, request));
	view.webContents.on("did-finish-load", () => {
		void installSurfaceViewBridge(surface).then(() => pushSurfaceViewState(surface));
	});
	view.webContents.on("did-navigate", (_event, url) => {
		const {requestPath} = parseSurfaceURL(url);
		updateSurfacePath(surface, requestPath);
	});
	view.webContents.on("page-title-updated", (event) => {
		event.preventDefault();
	});

	surfaces.set(id, surface);
	session.surfaceIds.add(id);
	session.surfaceIdsByPath.set(normalizedPath, id);
	emitSurfaceCreated(surface);
	return surface;
}

async function attachBrowserSurface(sessionId = activeSessionId, rawPath = "/") {
	const session = getSession(sessionId);
	const requestPath = normalizeRequestPath(rawPath);

	if (!session?.httySession) {
		throw new Error("No active HTTY session.");
	}

	const surface = await createSurface(sessionId, requestPath);
	const targetURL = toSurfaceURL(sessionId, requestPath);
	if (surface.view.webContents.getURL() !== targetURL) {
		await surface.view.webContents.loadURL(targetURL);
	} else {
		emitSurfaceUpdated(surface);
	}

	return snapshotSurface(surface);
}

function closeSurface(surfaceId) {
	const surface = surfaces.get(surfaceId);
	if (!surface) {
		return false;
	}

	detachSurfaceView(surfaceId);
	const session = sessions.get(surface.sessionId);
	if (session) {
		session.surfaceIds.delete(surfaceId);
		if (session.surfaceIdsByPath.get(surface.requestPath) === surfaceId) {
			session.surfaceIdsByPath.delete(surface.requestPath);
		}
	}

	surfaces.delete(surfaceId);
	if (mainWindow && mainWindow.contentView.children.includes(surface.view)) {
		mainWindow.contentView.removeChildView(surface.view);
	}
	surface.view.webContents.close({waitForBeforeUnload: false});
	emitSurfaceRemoved(surfaceId);
	return true;
}

async function getSurfaceDebugState(surfaceId) {
	const surface = surfaces.get(surfaceId);
	if (!surface) {
		return null;
	}

	return {
		...snapshotSurface(surface),
		url: surface.view.webContents.getURL(),
		title: surface.view.webContents.getTitle(),
		textContent: await surface.view.webContents.executeJavaScript("document.body.innerText"),
	};
}

function closeSession(sessionId) {
	const session = sessions.get(sessionId);

	if (!session) {
		return false;
	}

	for (const surfaceId of Array.from(session.surfaceIds)) {
		closeSurface(surfaceId);
	}

	sessions.delete(sessionId);
	session.browserDocumentRequests.clear();

	try {
		session.httySession?.close({sendClosePacket: false});
	} catch {
		// Ignore teardown errors while closing a tab.
	}

	session.httySession = null;

	if (session.terminalProcess) {
		const terminal = session.terminalProcess;
		session.terminalProcess = null;
		terminal.kill();
	}

	if (activeSessionId === sessionId) {
		activeSessionId = sessions.keys().next().value ?? null;
	}

	emitSessionRemoved(sessionId);

	for (const remainingSession of sessions.values()) {
		emitSessionUpdated(remainingSession);
	}

	return true;
}

function createMainWindow() {
	mainWindow = new BrowserWindow({
		width: isE2E ? 1280 : 1440,
		height: isE2E ? 800 : 900,
		fullscreen: !isE2E,
		backgroundColor: "#050914",
		titleBarStyle: process.platform === "darwin" ? "hiddenInset" : "hidden",
		autoHideMenuBar: process.platform !== "darwin",
		webPreferences: {
			preload: path.join(__dirname, "preload.cjs"),
			contextIsolation: true,
			nodeIntegration: false,
		},
	});

	mainWindow.loadFile(path.join(__dirname, "renderer.html"));
	mainWindow.on("resize", () => {
		if (activeSurfaceId) {
			syncSurfaceView(activeSurfaceId, {visible: true});
		}
	});

	mainWindow.on("closed", () => {
		mainWindow = null;

		for (const sessionId of Array.from(sessions.keys())) {
			closeSession(sessionId);
		}
	});
}

function showDebugTab() {
	emitToRenderer("chimera:show-debug-tab", {});
}

function focusAddressBar() {
	emitToRenderer("chimera:focus-address-bar", {});
}

function buildApplicationMenu() {
	const template = [
		...(process.platform === "darwin" ? [{role: "appMenu"}] : []),
		{
			label: "Session",
			submenu: [
				{
					label: "New Tab",
					accelerator: "CmdOrCtrl+T",
					click: () => createSession(),
				},
				{
					label: "Open Shell",
					accelerator: "CmdOrCtrl+Shift+S",
					click: () => createSession(),
				},
				{
					label: "Launch HTTY Hello World",
					accelerator: "CmdOrCtrl+Shift+H",
					click: () => createHttyDemoSession(httyHelloWorldScript, "HTTY Hello World"),
				},
				{
					label: "Launch HTTY Browser Demo",
					accelerator: "CmdOrCtrl+Shift+B",
					click: () => createHttyDemoSession(httyBrowserDemoScript, "HTTY Browser Demo"),
				},
				{type: "separator"},
				{
					label: "Focus Address Bar",
					accelerator: "CmdOrCtrl+L",
					click: () => focusAddressBar(),
				},
				{
					label: "Close Tab",
					accelerator: "CmdOrCtrl+W",
					click: () => closeSession(activeSessionId),
				},
			],
		},
		{
			label: "View",
			submenu: [
				{
					label: "Show Debug Tab",
					accelerator: "CmdOrCtrl+Shift+D",
					click: () => showDebugTab(),
				},
				{role: "toggleDevTools"},
				{role: "togglefullscreen"},
				{role: "reload"},
				{role: "forceReload"},
			],
		},
		{role: "windowMenu"},
	];

	Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function createSession(command = process.env.SHELL || "/bin/zsh", args = [], options = {}) {
	const sessionId = nextSessionId();
	const cwd = options.cwd || process.cwd();
	const title = options.title || inferTitle(command, args);
	const decoder = new HTTYDecoder();

	const session = {
		id: sessionId,
		title,
		command,
		args: [...args],
		cwd,
		decoder,
		debugState: createDebugState(),
		exitInfo: null,
		browserDocumentRequests: new Map(),
		surfaceIds: new Set(),
		surfaceIdsByPath: new Map(),
		httySession: null,
		terminalProcess: null,
		lastSurfacePath: "/",
	};

	const httySession = new HTTYClientSession((packet) => {
		session.terminalProcess?.write(packet);
	});

	session.httySession = httySession;

	httySession.on("state", (state) => {
		updateState(session, state);

		if (state.status === SESSION_STATUS.ATTACHED && !session.debugState.document) {
			attachBrowserSurface(session.id, "/").catch((error) => {
				updateState(session, {status: SESSION_STATUS.ERROR, message: error.message});
				updateResponseText(session, error.message);
			});
		}

		if (state.status === SESSION_STATUS.CLOSING || state.status === SESSION_STATUS.CLOSED || state.status === SESSION_STATUS.ERROR) {
			session.browserDocumentRequests.clear();
		}
	});

	const terminalProcess = pty.spawn(command, args, {
		name: "xterm-256color",
		cols: 120,
		rows: 40,
		cwd,
		env: process.env,
	});

	session.terminalProcess = terminalProcess;
	sessions.set(sessionId, session);
	setActiveSession(sessionId);
	emitSessionCreated(session);
	updateResponseText(session, `Starting ${describeCommand(command, args)}...\n`);

	terminalProcess.onData((data) => {
		const {plainText, packets} = decoder.push(data);

		if (plainText) {
			emitToRenderer("session:terminal-data", {sessionId, data: plainText});
		}

		for (const packet of packets) {
			if (packet.isReady()) {
				httySession.start();

				updatePacketState(session, {
					type: packet.type,
					payloadLength: packet.payload.length,
					preview: "ready",
				});

				continue;
			}

			httySession.handlePacket(packet);

			updatePacketState(session, {
				type: packet.type,
				payloadLength: packet.payload.length,
				preview: Buffer.from(packet.payload).toString("hex").slice(0, 80),
			});
		}
	});

	terminalProcess.onExit(({exitCode, signal}) => {
		session.exitInfo = {exitCode, signal};
		session.browserDocumentRequests.clear();

		try {
			httySession.close({sendClosePacket: false});
		} catch {
			// Ignore close errors on process exit.
		}

		session.httySession = null;
		session.terminalProcess = null;

		emitToRenderer("session:exit", {sessionId, exitCode, signal});
		emitSessionUpdated(session);
	});

	return snapshotSession(session);
}

app.whenReady().then(() => {
	createMainWindow();
	buildApplicationMenu();

	ipcMain.handle("chimera:get-sessions", () => {
		return snapshotSessions();
	});

	ipcMain.handle("chimera:get-session-debug-state", (_event, sessionId) => {
		return snapshotDebugState(getSession(sessionId));
	});

	ipcMain.handle("chimera:set-active-session", (_event, sessionId) => {
		return setActiveSession(sessionId);
	});

	ipcMain.handle("chimera:start", (_event, options = {}) => {
		const command = options.command || process.env.SHELL || "/bin/zsh";
		const args = Array.isArray(options.args) ? options.args : [];
		return createSession(command, args, {cwd: options.cwd});
	});

	ipcMain.handle("chimera:launch-hello-world", () => {
		return createHttyDemoSession(httyHelloWorldScript, "HTTY Hello World");
	});

	ipcMain.handle("chimera:launch-browser-demo", () => {
		return createHttyDemoSession(httyBrowserDemoScript, "HTTY Browser Demo");
	});

	ipcMain.handle("chimera:attach-browser", (_event, sessionId, requestPath = "/") => {
		return attachBrowserSurface(sessionId, requestPath);
	});

	ipcMain.handle("chimera:close-surface", (_event, surfaceId) => {
		return closeSurface(surfaceId);
	});

	ipcMain.handle("chimera:get-surface-debug-state", (_event, surfaceId) => {
		return getSurfaceDebugState(surfaceId);
	});

	ipcMain.handle("chimera:evaluate-surface", (_event, surfaceId, script) => {
		const surface = surfaces.get(surfaceId);
		if (!surface) {
			return null;
		}

		return surface.view.webContents.executeJavaScript(script);
	});

	ipcMain.handle("chimera:close-session", (_event, sessionId) => {
		return closeSession(sessionId);
	});

	ipcMain.on("chimera:input", (_event, {sessionId, data}) => {
		getSession(sessionId)?.terminalProcess?.write(data);
	});

	ipcMain.on("chimera:resize", (_event, {sessionId, cols, rows}) => {
		getSession(sessionId)?.terminalProcess?.resize(cols, rows);
	});

	ipcMain.on("chimera:surface-view-state", (_event, {surfaceId, state}) => {
		syncSurfaceView(surfaceId, state);
	});

	app.on("activate", () => {
		if (BrowserWindow.getAllWindows().length === 0) {
			createMainWindow();
			buildApplicationMenu();
		}
	});
});

app.on("window-all-closed", () => {
	if (process.platform !== "darwin") {
		app.quit();
	}
});