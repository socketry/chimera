export class UpdateController {
	constructor({
		app,
		BrowserWindow,
		dialog,
		options = {},
		trace,
		updaterLoader = () => import("electron-updater"),
		environment = process.env,
		logger = console,
		setInterval = globalThis.setInterval,
		clearInterval = globalThis.clearInterval,
	} = {}) {
		this.app = app;
		this.BrowserWindow = BrowserWindow;
		this.dialog = dialog;
		this.options = {
			enabled: true,
			autoCheck: true,
			recheckIntervalHours: 24,
			...options,
		};
		this.trace = trace ?? (() => {});
		this.updaterLoader = updaterLoader;
		this.environment = environment;
		this.logger = logger;
		this.setInterval = setInterval;
		this.clearInterval = clearInterval;
		this.updater = null;
		this.ready = null;
		this.checking = null;
		this.prompting = null;
		this.lastCheckFoundUpdate = false;
		this.updateWindow = null;
		this.downloaded = false;
		this.downloading = null;
		this.recheckTimer = null;
	}

	updatesEnabled() {
		return Boolean(this.options.enabled) && Boolean(this.app?.isPackaged) && this.environment.CHIMERA_DISABLE_AUTO_UPDATE !== "1";
	}

	updatesDisabledMessage() {
		if (!this.options.enabled) {
			return "Updates are disabled in Chimera configuration.";
		}

		if (this.environment.CHIMERA_DISABLE_AUTO_UPDATE === "1") {
			return "Updates are disabled by the environment.";
		}

		return "Updates are only available in packaged builds.";
	}

	automaticChecksEnabled() {
		return this.updatesEnabled() && Boolean(this.options.autoCheck);
	}

	recheckIntervalMilliseconds() {
		const hours = Number(this.options.recheckIntervalHours);
		if (!Number.isFinite(hours) || hours <= 0) {
			return null;
		}

		return hours * 60 * 60 * 1000;
	}

	async start() {
		if (this.automaticChecksEnabled()) {
			await this.checkForUpdates().catch((error) => {
				this.trace("updater:check-failed", {message: error.message});
			});
		}
		this.scheduleRechecks();
	}

	stop() {
		if (this.recheckTimer) {
			this.clearInterval(this.recheckTimer);
			this.recheckTimer = null;
		}
	}

	scheduleRechecks() {
		const interval = this.recheckIntervalMilliseconds();
		if (!this.automaticChecksEnabled() || !interval || this.recheckTimer) {
			return;
		}

		this.recheckTimer = this.setInterval(() => {
			void this.checkForUpdates().catch((error) => {
				this.trace("updater:check-failed", {message: error.message});
			});
		}, interval);
	}

	async loadUpdater() {
		if (!this.updatesEnabled()) {
			return null;
		}

		if (!this.ready) {
			this.ready = this.updaterLoader().then((electronUpdater) => {
				const {autoUpdater} = electronUpdater.default ?? electronUpdater;
				this.updater = autoUpdater;
				this.configureUpdater(autoUpdater);
				return autoUpdater;
			});
		}

		return this.ready;
	}

	configureUpdater(autoUpdater) {
		autoUpdater.logger = this.logger;
		autoUpdater.autoDownload = false;

		autoUpdater.on("checking-for-update", () => {
			this.lastCheckFoundUpdate = false;
			this.trace("updater:checking");
		});

		autoUpdater.on("update-available", (info) => {
			this.lastCheckFoundUpdate = true;
			this.trace("updater:update-available", {version: info.version});
			void this.promptForUpdate(info);
		});

		autoUpdater.on("update-not-available", (info) => {
			this.trace("updater:update-not-available", {version: info.version});
		});

		autoUpdater.on("update-downloaded", (info) => {
			this.trace("updater:update-downloaded", {version: info.version});
			this.handleUpdateDownloaded(info);
		});

		autoUpdater.on("download-progress", (progress) => {
			this.trace("updater:download-progress", {
				percent: progress.percent,
				transferred: progress.transferred,
				total: progress.total,
			});
			void this.updateDownloadProgress(progress);
		});

		autoUpdater.on("error", (error) => {
			this.trace("updater:error", {message: error.message});
		});
	}

	async checkForUpdates({userInitiated = false} = {}) {
		if (!this.updatesEnabled()) {
			if (userInitiated) {
				await this.showMessage({
					type: "info",
					message: this.updatesDisabledMessage(),
					buttons: ["OK"],
				});
			}

			return null;
		}

		if (this.checking) {
			return this.checking;
		}

		this.checking = this.performUpdateCheck({userInitiated}).finally(() => {
			this.checking = null;
		});

		return this.checking;
	}

	async performUpdateCheck({userInitiated}) {
		const autoUpdater = await this.loadUpdater();

		try {
			const result = await autoUpdater.checkForUpdates();

			if (userInitiated && !this.lastCheckFoundUpdate) {
				await this.showMessage({
					type: "info",
					message: "Chimera is up to date.",
					buttons: ["OK"],
				});
			}

			return result;
		} catch (error) {
			this.trace("updater:check-failed", {message: error.message});

			if (userInitiated) {
				await this.showMessage({
					type: "error",
					message: "Unable to check for updates.",
					detail: error.message,
					buttons: ["OK"],
				});
			}

			return null;
		}
	}

	async promptForUpdate(info = {}) {
		if (this.prompting) {
			return this.prompting;
		}

		this.prompting = this.showUpdatePrompt(info).finally(() => {
			this.prompting = null;
		});

		return this.prompting;
	}

	async showUpdatePrompt(info = {}) {
		if (this.BrowserWindow) {
			await this.showUpdateWindow(info);
			return true;
		}

		const {response} = await this.showMessage({
			type: "info",
			message: "New version is available, update now?",
			detail: info.version ? `Version ${info.version} is ready to download and install.` : undefined,
			buttons: ["Update Now", "Later"],
			defaultId: 0,
			cancelId: 1,
		});

		if (response !== 0) {
			return false;
		}

		return this.downloadUpdate(info);
	}

	async downloadUpdate(info = {}) {
		if (this.downloading) {
			return this.downloading;
		}

		this.downloading = this.performDownloadUpdate(info).finally(() => {
			this.downloading = null;
		});

		return this.downloading;
	}

	async performDownloadUpdate(info = {}) {
		const autoUpdater = await this.loadUpdater();

		try {
			await this.showUpdateWindow(info);
			await this.showDownloadProgress();
			await autoUpdater.downloadUpdate();
			return true;
		} catch (error) {
			this.trace("updater:download-failed", {message: error.message});
			await this.showUpdateError(error);
			if (!this.BrowserWindow) {
				await this.showMessage({
					type: "error",
					message: "Unable to download the update.",
					detail: error.message,
					buttons: ["OK"],
				});
			}
			return false;
		}
	}

	async showUpdateWindow(info = {}) {
		if (!this.BrowserWindow) {
			return null;
		}

		if (this.updateWindow && !this.updateWindow.isDestroyed?.()) {
			return this.updateWindow;
		}

		this.downloaded = false;
		const window = new this.BrowserWindow({
			width: 420,
			height: 220,
			resizable: false,
			minimizable: false,
			maximizable: false,
			show: false,
			title: "Chimera Update",
			webPreferences: {
				contextIsolation: true,
				nodeIntegration: false,
			},
		});
		this.updateWindow = window;

		window.on?.("closed", () => {
			if (this.updateWindow === window) {
				this.updateWindow = null;
			}
		});
		window.webContents?.on?.("will-navigate", (event, url) => {
			if (url === "chimera-update://download") {
				event.preventDefault();
				void this.downloadUpdate(info);
			} else if (url === "chimera-update://restart") {
				event.preventDefault();
				void this.restartNow();
			} else if (url === "chimera-update://later") {
				event.preventDefault();
				window.close?.();
			}
		});

		const version = info.version ? `Version ${this.escapeHtml(info.version)} is available.` : "An update is available.";
		await window.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(`<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Chimera Update</title>
		<style>
			:root { color-scheme: light dark; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
			body { margin: 0; padding: 24px; }
			h1 { margin: 0 0 8px; font-size: 20px; font-weight: 650; }
			p { margin: 0 0 18px; color: color-mix(in srgb, CanvasText 72%, transparent); font-size: 13px; }
			progress { width: 100%; height: 14px; }
			progress[hidden] { display: none; }
			.status { margin-top: 10px; min-height: 18px; font-size: 12px; color: color-mix(in srgb, CanvasText 65%, transparent); }
			.actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 22px; }
			a { border: 0; border-radius: 6px; padding: 8px 14px; background: AccentColor; color: AccentColorText; font-size: 13px; text-decoration: none; }
			a.secondary { background: color-mix(in srgb, CanvasText 10%, transparent); color: CanvasText; }
			a[hidden] { display: none; }
			a[aria-disabled="true"] { pointer-events: none; opacity: 0.48; filter: grayscale(1); }
		</style>
	</head>
	<body>
		<h1>Update Available</h1>
		<p id="description">${version}</p>
		<progress id="progress" max="100" value="0" hidden></progress>
		<div id="status" class="status">Download the update now?</div>
		<div class="actions">
			<a id="later" class="secondary" href="chimera-update://later">Later</a>
			<a id="download" href="chimera-update://download">Download Update</a>
			<a id="restart" aria-disabled="true" hidden>Restart Now</a>
		</div>
	</body>
</html>`)}`);
		window.show?.();

		return window;
	}

	async closeUpdateWindow() {
		const window = this.updateWindow;
		this.updateWindow = null;
		if (window && !window.isDestroyed?.()) {
			window.close?.();
		}
	}

	async showDownloadProgress() {
		const window = this.updateWindow;
		if (!window || window.isDestroyed?.()) {
			return;
		}

		await window.webContents?.executeJavaScript?.(`
			document.querySelector("h1").textContent = "Downloading Update";
			document.getElementById("description").textContent = "Chimera is downloading the update.";
			document.getElementById("progress").hidden = false;
			document.getElementById("status").textContent = "Preparing download...";
			document.getElementById("later").hidden = true;
			document.getElementById("download").hidden = true;
		`);
	}

	async updateDownloadProgress(progress = {}) {
		const window = this.updateWindow;
		if (!window || window.isDestroyed?.()) {
			return;
		}

		const percent = Number.isFinite(progress.percent) ? Math.max(0, Math.min(100, progress.percent)) : 0;
		const transferred = this.formatBytes(progress.transferred);
		const total = this.formatBytes(progress.total);
		const status = total ? `${Math.round(percent)}% (${transferred} of ${total})` : `${Math.round(percent)}%`;

		await window.webContents?.executeJavaScript?.(`
			document.getElementById("progress").value = ${JSON.stringify(percent)};
			document.getElementById("status").textContent = ${JSON.stringify(status)};
		`);
	}

	async handleUpdateDownloaded() {
		this.downloaded = true;
		const window = this.updateWindow;
		if (!window || window.isDestroyed?.()) {
			return;
		}

		await window.webContents?.executeJavaScript?.(`
			document.querySelector("h1").textContent = "Update Ready";
			document.getElementById("status").textContent = "Restart Chimera to finish installing the update.";
			const restart = document.getElementById("restart");
			restart.href = "chimera-update://restart";
			restart.hidden = false;
			restart.setAttribute("aria-disabled", "false");
		`);
		window.show?.();
	}

	async showUpdateError(error) {
		const window = this.updateWindow;
		if (!window || window.isDestroyed?.()) {
			return;
		}

		await window.webContents?.executeJavaScript?.(`
			document.querySelector("h1").textContent = "Update Failed";
			document.getElementById("description").textContent = "Chimera could not download the update.";
			document.getElementById("progress").hidden = true;
			document.getElementById("status").textContent = ${JSON.stringify(error.message)};
			document.getElementById("later").hidden = false;
			document.getElementById("download").hidden = false;
		`);
	}

	async restartNow() {
		if (!this.downloaded) {
			return false;
		}

		const autoUpdater = await this.loadUpdater();
		autoUpdater.quitAndInstall();
		return true;
	}

	showMessage(options) {
		return this.dialog.showMessageBox(options);
	}

	formatBytes(value) {
		if (!Number.isFinite(value) || value <= 0) {
			return "";
		}

		const units = ["B", "KB", "MB", "GB"];
		let amount = value;
		let unit = units[0];
		for (let index = 1; index < units.length && amount >= 1024; index += 1) {
			amount /= 1024;
			unit = units[index];
		}

		return `${amount >= 10 || unit === "B" ? Math.round(amount) : amount.toFixed(1)} ${unit}`;
	}

	escapeHtml(value) {
		return String(value)
			.replaceAll("&", "&amp;")
			.replaceAll("<", "&lt;")
			.replaceAll(">", "&gt;")
			.replaceAll('"', "&quot;");
	}
}
