export class RendererCommandDispatcher {
	constructor(application, {ipcMain} = {}) {
		this.application = application;
		this.ipcMain = ipcMain;
	}
	
	register() {
		this.ipcMain.handle("chimera:get-sessions", (event) => {
			return this.application.controllerForSender(event.sender)?.snapshotSessions() ?? [];
		});
		
		this.ipcMain.handle("chimera:get-terminal-options", () => {
			return this.application.configuration.terminalOptions();
		});

		this.ipcMain.handle("chimera:set-active-session", (event, sessionId) => {
			return this.application.controllerForSender(event.sender)?.setActiveSession(sessionId) ?? null;
		});

		this.ipcMain.handle("chimera:set-session-title", (event, sessionId, title) => {
			return this.application.controllerForSender(event.sender)?.updateSessionTitle(sessionId, title) ?? null;
		});

		this.ipcMain.handle("chimera:set-session-transport-mode", (event, sessionId, mode) => {
			return this.application.controllerForSender(event.sender)?.setSessionTransportMode(sessionId, mode) ?? null;
		});

		this.ipcMain.handle("chimera:interrupt-session", (event, sessionId) => {
			return this.application.controllerForSender(event.sender)?.interruptSession(sessionId) ?? false;
		});

		this.ipcMain.handle("chimera:new-window", async () => {
			const controller = await this.application.createWindow();
			return {windowId: controller.id};
		});
		
		this.ipcMain.handle("chimera:move-session-to-new-window", (event, sessionId, options = {}) => {
			return this.application.moveSessionToNewWindow(this.application.controllerForSender(event.sender), sessionId, options);
		});
		
		this.ipcMain.handle("chimera:toggle-tab-bar", (event) => {
			const controller = this.application.controllerForSender(event.sender);
			controller?.toggleTabBar();
			return controller?.isTabBarHidden ?? false;
		});

		this.ipcMain.handle("chimera:start", (event, options = {}) => {
			const controller = this.application.controllerForSender(event.sender);
			const command = options.command || process.env.SHELL || "/bin/zsh";
			const args = Array.isArray(options.args) ? options.args : [];
			this.application.trace("ipc:start", {command, args, cwd: options.cwd, windowId: controller?.id ?? null});
			return controller?.createSession(command, args, {cwd: options.cwd}) ?? null;
		});

		this.ipcMain.handle("chimera:attach-browser", (event, sessionId, requestPath = "/") => {
			return this.application.controllerForSender(event.sender)?.attachBrowserSurface(sessionId, requestPath) ?? null;
		});

		this.ipcMain.handle("chimera:close-surface", (event, surfaceId) => {
			return this.application.controllerForSender(event.sender)?.closeSurface(surfaceId) ?? false;
		});

		this.ipcMain.handle("chimera:close-session", (event, sessionId) => {
			const controller = this.application.controllerForSender(event.sender);
			this.application.trace("ipc:close-session", {sessionId, windowId: controller?.id ?? null});
			return controller?.closeSession(sessionId) ?? false;
		});

		this.ipcMain.on("chimera:input", (event, {sessionId, data}) => {
			this.application.controllerForSender(event.sender)?.handleInput(sessionId, data);
		});

		this.ipcMain.on("chimera:resize", (event, {sessionId, cols, rows}) => {
			this.application.controllerForSender(event.sender)?.handleResize(sessionId, cols, rows);
		});

		this.ipcMain.on("chimera:surface-view-state", (event, {surfaceId, state}) => {
			this.application.controllerForSender(event.sender)?.syncSurfaceView(surfaceId, state);
		});
	}
}
