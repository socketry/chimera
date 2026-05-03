import {app, BrowserWindow, dialog, protocol} from "electron";
import path from "node:path";
import {fileURLToPath} from "node:url";

import {BookmarksController} from "./BookmarksController.js";
import {Configuration} from "./Configuration.js";
import {DarwinWindowController} from "./DarwinWindowController.js";
import {LinuxWindowController} from "./LinuxWindowController.js";
import {MenuController} from "./MenuController.js";
import {RendererCommandDispatcher} from "./RendererCommandDispatcher.js";
import {trace} from "./Utilities.js";
import {UpdateController} from "./UpdateController.js";
import {WindowController} from "./WindowController.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class ChimeraApplication {
	constructor() {
		this.windowControllers = new Map();
		this.sessionCounter = 0;
		this.surfaceCounter = 0;
		this.configuration = new Configuration();
		this.bookmarksController = new BookmarksController({
			configuration: this.configuration,
			trace: this.trace.bind(this),
		});
		this.menuController = new MenuController(this);
		this.rendererCommandDispatcher = new RendererCommandDispatcher(this);
		this.rendererPath = path.join(__dirname, "renderer.html");
		this.preloadPath = path.join(__dirname, "preload.cjs");
		this.updateController = new UpdateController({
			app,
			BrowserWindow,
			dialog,
			options: this.configuration.updateOptions(),
			trace: this.trace.bind(this),
		});
	}

	trace(event, details = {}) {
		trace(event, details);
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
		if (process.platform === "darwin") {
			return DarwinWindowController;
		}
		
		if (process.platform === "linux") {
			return LinuxWindowController;
		}
		
		return WindowController;
	}

	async createWindow(options = {}) {
		const WindowControllerClass = this.windowControllerClass();
		const controller = await new WindowControllerClass(this).create(options);
		this.windowControllers.set(controller.id, controller);
		return controller;
	}

	async showReleases() {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		controller.window?.focus();
		controller.emitToRenderer("chimera:show-releases");
	}

	async showBookmarksHelp() {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		controller.window?.focus();
		controller.emitToRenderer("chimera:show-bookmarks-help");
	}

	async editBookmarks() {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		const editorPath = this.bookmarksEditorPath();
		const command = this.shellCommandForScript(editorPath);
		controller.window?.focus();
		controller.createSession(process.env.SHELL || "/bin/zsh", ["-lc", command], {
			cwd: path.dirname(editorPath),
			title: "Edit Bookmarks",
		});
	}

	async editConfiguration() {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		const editorPath = this.configurationEditorPath();
		const command = this.shellCommandForScript(editorPath);
		controller.window?.focus();
		controller.createSession(process.env.SHELL || "/bin/zsh", ["-lc", command], {
			cwd: path.dirname(editorPath),
			title: "Edit Configuration",
		});
	}

	async reloadConfiguration() {
		this.configuration.reload();
		this.updateController.setOptions(this.configuration.updateOptions());
		this.buildApplicationMenu();

		await Promise.all(Array.from(this.windowControllers.values(), (controller) => {
			return controller.applyConfiguration?.();
		}));
	}

	async openBookmark(bookmark) {
		const controller = this.focusedWindowController() ?? Array.from(this.windowControllers.values())[0] ?? await this.createWindow();
		controller.window?.focus();
		controller.createSession(bookmark.command, bookmark.args, {
			cwd: bookmark.cwd,
			title: bookmark.title,
		});
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

	applicationRoot() {
		return path.dirname(__dirname);
	}

	bookmarksEditorPath() {
		if (app.isPackaged) {
			return path.join(process.resourcesPath, "app.asar.unpacked", "bin", "chimera-bookmarks-editor");
		}

		return path.join(this.applicationRoot(), "bin", "chimera-bookmarks-editor");
	}

	configurationEditorPath() {
		if (app.isPackaged) {
			return path.join(process.resourcesPath, "app.asar.unpacked", "bin", "chimera-configuration-editor");
		}

		return path.join(this.applicationRoot(), "bin", "chimera-configuration-editor");
	}

	shellQuote(value) {
		return `'${String(value).replaceAll("'", "'\\''")}'`;
	}

	shellCommandForScript(scriptPath) {
		return `exec ${this.shellQuote(scriptPath)}`;
	}

	focusedWindowController() {
		const browserWindow = BrowserWindow.getFocusedWindow();
		return browserWindow ? this.windowControllers.get(browserWindow.id) ?? null : null;
	}

	buildApplicationMenu() {
		this.menuController.buildApplicationMenu();
	}

	registerIpcHandlers() {
		this.rendererCommandDispatcher.register();
	}

	async start() {
		this.registerPrivilegedSchemes();
		await app.whenReady();
		this.registerIpcHandlers();
		await this.createWindow();
		this.buildApplicationMenu();
		void this.updateController.start();

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
