import {app, BrowserWindow, ipcMain, Menu, protocol} from "electron";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {Configuration} from "./Configuration.js";
import {DarwinWindowController} from "./DarwinWindowController.js";
import {logLifecycle} from "./Utilities.js";
import {WindowController} from "./WindowController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ChimeraApplication {
	constructor() {
		this.windowControllers = new Map();
		this.sessionCounter = 0;
		this.surfaceCounter = 0;
		this.configuration = new Configuration();
		this.rendererPath = path.join(__dirname, "renderer.html");
		this.preloadPath = path.join(__dirname, "preload.cjs");
	}

	logLifecycle(event, details = {}) {
		logLifecycle(event, details);
	}

	nextSessionId() {
		this.sessionCounter += 1;
		return `session-${this.sessionCounter}`;
	}

	nextSurfaceId() {
		this.surfaceCounter += 1;
		return `surface-${this.surfaceCounter}`;
	}

	registerPrivilegedSchemes() {
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
	}

	windowControllerClass() {
		return process.platform === "darwin" ? DarwinWindowController : WindowController;
	}

	async createWindow(options = {}) {
		const WindowControllerClass = this.windowControllerClass();
		const controller = await new WindowControllerClass(this).create(options);
		this.windowControllers.set(controller.id, controller);
		return controller;
	}

	async showReleaseNotes() {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		controller.window?.focus();
		controller.emitToRenderer("chimera:show-release-notes");
	}
	
	async moveSessionToNewWindow(sourceController, sessionId, options = {}) {
		const session = sourceController?.releaseSession(sessionId);
		if (!session) {
			return null;
		}
		
		const controller = await this.createWindow({
			sessions: [session],
			windowOptions: options.windowOptions ?? {},
		});
		controller.window?.focus();
		
		if (sourceController.sessions.size === 0 && sourceController.window && !sourceController.window.isDestroyed()) {
			sourceController.window.close();
		}
		
		return {
			windowId: controller.id,
			sessionId,
		};
	}

	unregisterWindowController(controller) {
		if (controller.id) {
			this.windowControllers.delete(controller.id);
			return;
		}

		for (const [windowId, candidate] of this.windowControllers.entries()) {
			if (candidate === controller) {
				this.windowControllers.delete(windowId);
				break;
			}
		}
	}

	controllerForSender(sender) {
		const browserWindow = BrowserWindow.fromWebContents(sender);
		return browserWindow ? this.windowControllers.get(browserWindow.id) ?? null : null;
	}

	focusedWindowController() {
		const browserWindow = BrowserWindow.getFocusedWindow();
		return browserWindow ? this.windowControllers.get(browserWindow.id) ?? null : null;
	}

	buildApplicationMenu() {
		const template = [
			...(process.platform === "darwin" ? [{role: "appMenu"}] : []),
			{
				label: "Session",
				submenu: [
					{
						label: "New Window",
						accelerator: "CmdOrCtrl+N",
						click: () => {
							void this.createWindow();
						},
					},
					{
						label: "New Tab",
						accelerator: "CmdOrCtrl+T",
						click: () => {
							this.focusedWindowController()?.createSession();
						},
					},
					{
						label: "Close Tab",
						accelerator: "CmdOrCtrl+W",
						click: () => {
							this.focusedWindowController()?.closeActiveTab();
						},
					},
					{
						label: "Previous Tab",
						accelerator: "CmdOrCtrl+Shift+Left",
						click: () => {
							this.focusedWindowController()?.activateRelativeTab(-1);
						},
					},
					{
						label: "Next Tab",
						accelerator: "CmdOrCtrl+Shift+Right",
						click: () => {
							this.focusedWindowController()?.activateRelativeTab(1);
						},
					},
				],
			},
			{role: "editMenu"},
			{
				label: "View",
				submenu: [
					{
						label: "Toggle Tab Bar",
						accelerator: "CmdOrCtrl+Shift+F",
						click: () => {
							this.focusedWindowController()?.toggleTabBar();
						},
					},
					{type: "separator"},
					{role: "resetZoom"},
					{role: "zoomIn"},
					{role: "zoomOut"},
					{type: "separator"},
					{role: "reload"},
					{role: "forceReload"},
					{role: "toggleDevTools"},
				],
			},
			{role: "windowMenu"},
			{
				label: "Help",
				submenu: [
					{
						label: "Release Notes",
						click: () => {
							void this.showReleaseNotes();
						},
					},
				],
			},
		];

		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	}

	registerIpcHandlers() {
		ipcMain.handle("chimera:get-sessions", (event) => {
			return this.controllerForSender(event.sender)?.snapshotSessions() ?? [];
		});
		
		ipcMain.handle("chimera:get-terminal-options", () => {
			return this.configuration.terminalOptions();
		});

		ipcMain.handle("chimera:set-active-session", (event, sessionId) => {
			return this.controllerForSender(event.sender)?.setActiveSession(sessionId) ?? null;
		});

		ipcMain.handle("chimera:set-session-title", (event, sessionId, title) => {
			return this.controllerForSender(event.sender)?.updateSessionTitle(sessionId, title) ?? null;
		});

		ipcMain.handle("chimera:set-session-transport-mode", (event, sessionId, mode) => {
			return this.controllerForSender(event.sender)?.setSessionTransportMode(sessionId, mode) ?? null;
		});

		ipcMain.handle("chimera:interrupt-session", (event, sessionId) => {
			return this.controllerForSender(event.sender)?.interruptSession(sessionId) ?? false;
		});

		ipcMain.handle("chimera:new-window", async () => {
			const controller = await this.createWindow();
			return {windowId: controller.id};
		});
		
		ipcMain.handle("chimera:move-session-to-new-window", (event, sessionId, options = {}) => {
			return this.moveSessionToNewWindow(this.controllerForSender(event.sender), sessionId, options);
		});
		
		ipcMain.handle("chimera:toggle-tab-bar", (event) => {
			const controller = this.controllerForSender(event.sender);
			controller?.toggleTabBar();
			return controller?.isTabBarHidden ?? false;
		});

		ipcMain.handle("chimera:start", (event, options = {}) => {
			const controller = this.controllerForSender(event.sender);
			const command = options.command || process.env.SHELL || "/bin/zsh";
			const args = Array.isArray(options.args) ? options.args : [];
			this.logLifecycle("ipc:start", {command, args, cwd: options.cwd, windowId: controller?.id ?? null});
			return controller?.createSession(command, args, {cwd: options.cwd}) ?? null;
		});

		ipcMain.handle("chimera:attach-browser", (event, sessionId, requestPath = "/") => {
			return this.controllerForSender(event.sender)?.attachBrowserSurface(sessionId, requestPath) ?? null;
		});

		ipcMain.handle("chimera:close-surface", (event, surfaceId) => {
			return this.controllerForSender(event.sender)?.closeSurface(surfaceId) ?? false;
		});

		ipcMain.handle("chimera:evaluate-surface", (event, surfaceId, script) => {
			const controller = this.controllerForSender(event.sender);
			const surface = controller?.surfaces.get(surfaceId);
			if (!surface) {
				return null;
			}

			return surface.view.webContents.executeJavaScript(script);
		});

		ipcMain.handle("chimera:close-session", (event, sessionId) => {
			const controller = this.controllerForSender(event.sender);
			this.logLifecycle("ipc:close-session", {sessionId, windowId: controller?.id ?? null});
			return controller?.closeSession(sessionId) ?? false;
		});

		ipcMain.on("chimera:input", (event, {sessionId, data}) => {
			this.controllerForSender(event.sender)?.handleInput(sessionId, data);
		});

		ipcMain.on("chimera:resize", (event, {sessionId, cols, rows}) => {
			this.controllerForSender(event.sender)?.handleResize(sessionId, cols, rows);
		});

		ipcMain.on("chimera:surface-view-state", (event, {surfaceId, state}) => {
			this.controllerForSender(event.sender)?.syncSurfaceView(surfaceId, state);
		});
	}

	async configureAutoUpdates() {
		if (!app.isPackaged || process.env.CHIMERA_DISABLE_AUTO_UPDATE === "1") {
			return;
		}

		const electronUpdater = await import("electron-updater");
		const {autoUpdater} = electronUpdater.default ?? electronUpdater;

		autoUpdater.logger = console;

		autoUpdater.on("checking-for-update", () => {
			this.logLifecycle("updater:checking");
		});

		autoUpdater.on("update-available", (info) => {
			this.logLifecycle("updater:update-available", {version: info.version});
		});

		autoUpdater.on("update-not-available", (info) => {
			this.logLifecycle("updater:update-not-available", {version: info.version});
		});

		autoUpdater.on("update-downloaded", (info) => {
			this.logLifecycle("updater:update-downloaded", {version: info.version});
		});

		autoUpdater.on("error", (error) => {
			this.logLifecycle("updater:error", {message: error.message});
		});

		await autoUpdater.checkForUpdatesAndNotify().catch((error) => {
			this.logLifecycle("updater:check-failed", {message: error.message});
		});
	}

	async start() {
		this.registerPrivilegedSchemes();
		await app.whenReady();
		this.registerIpcHandlers();
		await this.createWindow();
		this.buildApplicationMenu();
		void this.configureAutoUpdates();

		app.on("activate", () => {
			if (BrowserWindow.getAllWindows().length === 0) {
				void this.createWindow();
			}
		});

		app.on("window-all-closed", () => {
			if (process.platform !== "darwin") {
				app.quit();
			}
		});
	}
}
