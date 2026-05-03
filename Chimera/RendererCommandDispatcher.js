import {ipcMain} from "electron";

export class RendererCommandDispatcher {
	constructor(application) {
		this.application = application;
	}
	
	register() {
		ipcMain.handle("chimera:get-sessions", (event) => {
			return this.application.controllerForSender(event.sender)?.snapshotSessions() ?? [];
		});
		
		ipcMain.handle("chimera:get-terminal-options", () => {
			return this.application.configuration.terminalOptions();
		});

		ipcMain.handle("chimera:set-active-session", (event, sessionId) => {
			return this.application.controllerForSender(event.sender)?.setActiveSession(sessionId) ?? null;
		});

		ipcMain.handle("chimera:set-session-title", (event, sessionId, title) => {
			return this.application.controllerForSender(event.sender)?.updateSessionTitle(sessionId, title) ?? null;
		});

		ipcMain.handle("chimera:set-session-transport-mode", (event, sessionId, mode) => {
			return this.application.controllerForSender(event.sender)?.setSessionTransportMode(sessionId, mode) ?? null;
		});

		ipcMain.handle("chimera:interrupt-session", (event, sessionId) => {
			return this.application.controllerForSender(event.sender)?.interruptSession(sessionId) ?? false;
		});

		ipcMain.handle("chimera:new-window", async () => {
			const controller = await this.application.createWindow();
			return {windowId: controller.id};
		});
		
		ipcMain.handle("chimera:move-session-to-new-window", (event, sessionId, options = {}) => {
			return this.application.moveSessionToNewWindow(this.application.controllerForSender(event.sender), sessionId, options);
		});
		
		ipcMain.handle("chimera:toggle-tab-bar", (event) => {
			const controller = this.application.controllerForSender(event.sender);
			controller?.toggleTabBar();
			return controller?.isTabBarHidden ?? false;
		});

		ipcMain.handle("chimera:start", (event, options = {}) => {
			const controller = this.application.controllerForSender(event.sender);
			const command = options.command || process.env.SHELL || "/bin/zsh";
			const args = Array.isArray(options.args) ? options.args : [];
			this.application.trace("ipc:start", {command, args, cwd: options.cwd, windowId: controller?.id ?? null});
			return controller?.createSession(command, args, {cwd: options.cwd}) ?? null;
		});

		ipcMain.handle("chimera:attach-browser", (event, sessionId, requestPath = "/") => {
			return this.application.controllerForSender(event.sender)?.attachBrowserSurface(sessionId, requestPath) ?? null;
		});

		ipcMain.handle("chimera:close-surface", (event, surfaceId) => {
			return this.application.controllerForSender(event.sender)?.closeSurface(surfaceId) ?? false;
		});

		ipcMain.handle("chimera:evaluate-surface", (event, surfaceId, script) => {
			const controller = this.application.controllerForSender(event.sender);
			const surface = controller?.surfaces.get(surfaceId);
			if (!surface) {
				return null;
			}

			return surface.view.webContents.executeJavaScript(script);
		});

		ipcMain.handle("chimera:close-session", (event, sessionId) => {
			const controller = this.application.controllerForSender(event.sender);
			this.application.trace("ipc:close-session", {sessionId, windowId: controller?.id ?? null});
			return controller?.closeSession(sessionId) ?? false;
		});

		ipcMain.on("chimera:input", (event, {sessionId, data}) => {
			this.application.controllerForSender(event.sender)?.handleInput(sessionId, data);
		});

		ipcMain.on("chimera:resize", (event, {sessionId, cols, rows}) => {
			this.application.controllerForSender(event.sender)?.handleResize(sessionId, cols, rows);
		});

		ipcMain.on("chimera:surface-view-state", (event, {surfaceId, state}) => {
			this.application.controllerForSender(event.sender)?.syncSurfaceView(surfaceId, state);
		});
	}
}
