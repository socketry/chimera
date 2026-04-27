const {clipboard, contextBridge, ipcRenderer} = require("electron");

contextBridge.exposeInMainWorld("chimera", {
	getSessions() {
		return ipcRenderer.invoke("chimera:get-sessions");
	},
	getSessionDebugState(sessionId) {
		return ipcRenderer.invoke("chimera:get-session-debug-state", sessionId);
	},
	setActiveSession(sessionId) {
		return ipcRenderer.invoke("chimera:set-active-session", sessionId);
	},
	start(options) {
		return ipcRenderer.invoke("chimera:start", options);
	},
	launchHelloWorld() {
		return ipcRenderer.invoke("chimera:launch-hello-world");
	},
	launchBrowserDemo() {
		return ipcRenderer.invoke("chimera:launch-browser-demo");
	},
	attachBrowser(sessionId, requestPath = "/") {
		return ipcRenderer.invoke("chimera:attach-browser", sessionId, requestPath);
	},
	closeSurface(surfaceId) {
		return ipcRenderer.invoke("chimera:close-surface", surfaceId);
	},
	syncSurfaceView(surfaceId, state) {
		ipcRenderer.send("chimera:surface-view-state", {surfaceId, state});
	},
	getSurfaceDebugState(surfaceId) {
		return ipcRenderer.invoke("chimera:get-surface-debug-state", surfaceId);
	},
	evaluateSurface(surfaceId, script) {
		return ipcRenderer.invoke("chimera:evaluate-surface", surfaceId, script);
	},
	closeSession(sessionId) {
		return ipcRenderer.invoke("chimera:close-session", sessionId);
	},
	sendInput(sessionId, data) {
		ipcRenderer.send("chimera:input", {sessionId, data});
	},
	resize(sessionId, cols, rows) {
		ipcRenderer.send("chimera:resize", {sessionId, cols, rows});
	},
	writeClipboardText(text) {
		clipboard.writeText(text);
	},
	readClipboardText() {
		return clipboard.readText();
	},
	onSessionCreated(callback) {
		ipcRenderer.on("session:created", (_event, session) => callback(session));
	},
	onSessionUpdated(callback) {
		ipcRenderer.on("session:updated", (_event, session) => callback(session));
	},
	onSessionRemoved(callback) {
		ipcRenderer.on("session:removed", (_event, payload) => callback(payload));
	},
	onTerminalData(callback) {
		ipcRenderer.on("session:terminal-data", (_event, payload) => callback(payload));
	},
	onPacket(callback) {
		ipcRenderer.on("session:packet", (_event, payload) => callback(payload));
	},
	onState(callback) {
		ipcRenderer.on("session:state", (_event, payload) => callback(payload));
	},
	onDocument(callback) {
		ipcRenderer.on("session:document", (_event, payload) => callback(payload));
	},
	onSurfaceCreated(callback) {
		ipcRenderer.on("surface:created", (_event, payload) => callback(payload));
	},
	onSurfaceUpdated(callback) {
		ipcRenderer.on("surface:updated", (_event, payload) => callback(payload));
	},
	onSurfaceRemoved(callback) {
		ipcRenderer.on("surface:removed", (_event, payload) => callback(payload));
	},
	onResponse(callback) {
		ipcRenderer.on("session:response", (_event, payload) => callback(payload));
	},
	onExit(callback) {
		ipcRenderer.on("session:exit", (_event, payload) => callback(payload));
	},
	onShowDebugTab(callback) {
		ipcRenderer.on("chimera:show-debug-tab", () => callback());
	},
	onFocusAddressBar(callback) {
		ipcRenderer.on("chimera:focus-address-bar", () => callback());
	},
});