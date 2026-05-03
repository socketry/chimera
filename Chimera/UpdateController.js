export class UpdateController {
	constructor({
		app,
		dialog,
		trace,
		updaterLoader = () => import("electron-updater"),
		environment = process.env,
		logger = console,
	} = {}) {
		this.app = app;
		this.dialog = dialog;
		this.trace = trace ?? (() => {});
		this.updaterLoader = updaterLoader;
		this.environment = environment;
		this.logger = logger;
		this.updater = null;
		this.ready = null;
		this.checking = null;
		this.prompting = null;
		this.installWhenDownloaded = false;
		this.lastCheckFoundUpdate = false;
	}

	updatesEnabled() {
		return Boolean(this.app?.isPackaged) && this.environment.CHIMERA_DISABLE_AUTO_UPDATE !== "1";
	}

	async start() {
		await this.checkForUpdates().catch((error) => {
			this.trace("updater:check-failed", {message: error.message});
		});
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

			if (this.installWhenDownloaded) {
				this.installWhenDownloaded = false;
				autoUpdater.quitAndInstall();
			}
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
					message: "Updates are only available in packaged builds.",
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

	async showUpdatePrompt(info) {
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

		this.installWhenDownloaded = true;
		const autoUpdater = await this.loadUpdater();

		try {
			await autoUpdater.downloadUpdate();
			return true;
		} catch (error) {
			this.installWhenDownloaded = false;
			this.trace("updater:download-failed", {message: error.message});
			await this.showMessage({
				type: "error",
				message: "Unable to download the update.",
				detail: error.message,
				buttons: ["OK"],
			});
			return false;
		}
	}

	showMessage(options) {
		return this.dialog.showMessageBox(options);
	}
}
