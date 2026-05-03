const {clipboard, contextBridge, ipcRenderer} = require("electron");

const chimera = {
	getSessions() {
		return ipcRenderer.invoke("chimera:get-sessions");
	},
	getTerminalOptions() {
		return ipcRenderer.invoke("chimera:get-terminal-options");
	},
	setActiveSession(sessionId) {
		return ipcRenderer.invoke("chimera:set-active-session", sessionId);
	},
	setSessionTitle(sessionId, title) {
		return ipcRenderer.invoke("chimera:set-session-title", sessionId, title);
	},
	setSessionTransportMode(sessionId, mode) {
		return ipcRenderer.invoke("chimera:set-session-transport-mode", sessionId, mode);
	},
	interruptSession(sessionId) {
		return ipcRenderer.invoke("chimera:interrupt-session", sessionId);
	},
	newWindow() {
		return ipcRenderer.invoke("chimera:new-window");
	},
	moveSessionToNewWindow(sessionId, options) {
		return ipcRenderer.invoke("chimera:move-session-to-new-window", sessionId, options);
	},
	toggleTabBar() {
		return ipcRenderer.invoke("chimera:toggle-tab-bar");
	},
	start(options) {
		return ipcRenderer.invoke("chimera:start", options);
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
	onExit(callback) {
		ipcRenderer.on("session:exit", (_event, payload) => callback(payload));
	},
	onCloseActiveTab(callback) {
		ipcRenderer.on("chimera:close-active-tab", () => callback());
	},
	onActivateRelativeTab(callback) {
		ipcRenderer.on("chimera:activate-relative-tab", (_event, payload) => callback(payload));
	},
	onTabBarHidden(callback) {
		ipcRenderer.on("chimera:tab-bar-hidden", (_event, payload) => callback(payload));
	},
	onConfigurationUpdated(callback) {
		ipcRenderer.on("configuration:updated", (_event, payload) => callback(payload));
	},
	onShowReleases(callback) {
		ipcRenderer.on("chimera:show-releases", () => callback());
	},
	onShowBookmarksHelp(callback) {
		ipcRenderer.on("chimera:show-bookmarks-help", () => callback());
	},
};

contextBridge.exposeInMainWorld("chimera", chimera);
