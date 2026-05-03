import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import test from "node:test";

import {UpdateController} from "../../Chimera/UpdateController.js";

class FakeUpdater extends EventEmitter {
	constructor() {
		super();
		this.autoDownload = true;
		this.downloads = 0;
		this.installs = 0;
	}

	async checkForUpdates() {
		this.emit("checking-for-update");
		return {updateInfo: {version: "0.2.2"}};
	}

	async downloadUpdate() {
		this.downloads += 1;
		this.emit("download-progress", {
			percent: 50,
			transferred: 5 * 1024 * 1024,
			total: 10 * 1024 * 1024,
		});
		this.emit("update-downloaded", {version: "0.2.2"});
	}

	quitAndInstall() {
		this.installs += 1;
	}
}

class FakeWebContents extends EventEmitter {
	constructor() {
		super();
		this.scripts = [];
	}

	async executeJavaScript(script) {
		this.scripts.push(script);
	}
}

class FakeBrowserWindow extends EventEmitter {
	static instances = [];

	constructor(options) {
		super();
		this.options = options;
		this.urls = [];
		this.closed = false;
		this.shown = false;
		this.webContents = new FakeWebContents();
		FakeBrowserWindow.instances.push(this);
	}

	async loadURL(url) {
		this.urls.push(url);
	}

	isDestroyed() {
		return this.closed;
	}

	close() {
		this.closed = true;
		this.emit("closed");
	}

	show() {
		this.shown = true;
	}
}

function createController({packaged = true, dialogResponses = [], options} = {}) {
	const updater = new FakeUpdater();
	const messages = [];
	const events = [];
	const intervals = [];
	const dialog = {
		async showMessageBox(options) {
			messages.push(options);
			return dialogResponses.shift() ?? {response: 0};
		},
	};
	FakeBrowserWindow.instances = [];
	const controller = new UpdateController({
		app: {isPackaged: packaged},
		BrowserWindow: FakeBrowserWindow,
		dialog,
		options,
		trace: (event, details = {}) => events.push({event, details}),
		updaterLoader: async () => ({autoUpdater: updater}),
		logger: null,
		setInterval(callback, delay) {
			const interval = {callback, delay, cleared: false};
			intervals.push(interval);
			return interval;
		},
		clearInterval(interval) {
			interval.cleared = true;
		},
	});

	return {controller, updater, messages, events, intervals};
}

function navigate(window, url) {
	const event = {
		prevented: false,
		preventDefault() {
			this.prevented = true;
		},
	};
	window.webContents.emit("will-navigate", event, url);
	return event;
}

test("shows an update window before downloading an available update", async () => {
	const {controller, updater, messages} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;

	assert.equal(updater.autoDownload, false);
	assert.equal(messages.length, 0);
	assert.equal(updater.downloads, 0);
	assert.equal(updater.installs, 0);
	assert.equal(FakeBrowserWindow.instances.length, 1);
	assert.match(decodeURIComponent(FakeBrowserWindow.instances[0].urls[0]), /Update Available/);
	assert.match(decodeURIComponent(FakeBrowserWindow.instances[0].urls[0]), /Download Update/);
});

test("downloads when the update window download action is selected", async () => {
	const {controller, updater} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;
	const event = navigate(FakeBrowserWindow.instances[0], "chimera-update://download");
	await controller.downloading;

	assert.equal(event.prevented, true);
	assert.equal(updater.downloads, 1);
	assert.equal(updater.installs, 0);
	assert.match(FakeBrowserWindow.instances[0].webContents.scripts.join("\n"), /Restart Chimera/);
});

test("does not download when the update window is dismissed", async () => {
	const {controller, updater} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;
	const window = FakeBrowserWindow.instances[0];
	const event = navigate(window, "chimera-update://later");

	assert.equal(event.prevented, true);
	assert.equal(window.closed, true);
	assert.equal(updater.downloads, 0);
	assert.equal(updater.installs, 0);
});

test("restart now installs after the update has downloaded", async () => {
	const {controller, updater} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;
	navigate(FakeBrowserWindow.instances[0], "chimera-update://download");
	await controller.downloading;

	assert.equal(await controller.restartNow(), true);
	assert.equal(updater.installs, 1);
});

test("restart now is ignored before the update is downloaded", async () => {
	const {controller, updater} = createController();

	await controller.loadUpdater();

	assert.equal(await controller.restartNow(), false);
	assert.equal(updater.installs, 0);
});

test("download progress updates the popup", async () => {
	const {controller, updater} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;
	navigate(FakeBrowserWindow.instances[0], "chimera-update://download");
	await controller.downloading;

	const scripts = FakeBrowserWindow.instances[0].webContents.scripts.join("\n");
	assert.match(scripts, /50/);
	assert.match(scripts, /5\.0 MB of 10 MB/);
});

test("schedules update rechecks every 24 hours", async () => {
	const {controller, updater, intervals} = createController();

	await controller.start();

	assert.equal(intervals.length, 1);
	assert.equal(intervals[0].delay, 24 * 60 * 60 * 1000);

	let checks = 0;
	updater.checkForUpdates = async () => {
		checks += 1;
	};
	intervals[0].callback();
	await new Promise((resolve) => setImmediate(resolve));

	assert.equal(checks, 1);
	controller.stop();
	assert.equal(intervals[0].cleared, true);
});

test("uses the configured update recheck interval", async () => {
	const {controller, intervals} = createController({
		options: {
			recheckIntervalHours: 6,
		},
	});

	await controller.start();

	assert.equal(intervals.length, 1);
	assert.equal(intervals[0].delay, 6 * 60 * 60 * 1000);
});

test("does not auto check when automatic update checks are disabled", async () => {
	const {controller, updater, intervals} = createController({
		options: {
			autoCheck: false,
		},
	});
	let checks = 0;
	updater.checkForUpdates = async () => {
		checks += 1;
	};

	await controller.start();

	assert.equal(checks, 0);
	assert.equal(intervals.length, 0);
});

test("manual checks still work when automatic update checks are disabled", async () => {
	const {controller, updater} = createController({
		options: {
			autoCheck: false,
		},
	});
	let checks = 0;
	updater.checkForUpdates = async () => {
		checks += 1;
	};

	await controller.checkForUpdates();

	assert.equal(checks, 1);
});

test("disables all update checks when updates are disabled", async () => {
	const {controller, messages} = createController({
		options: {
			enabled: false,
		},
	});

	await controller.start();
	await controller.checkForUpdates({userInitiated: true});

	assert.equal(messages.length, 1);
	assert.equal(messages[0].message, "Updates are disabled in Chimera configuration.");
});

test("manual checks report when Chimera is up to date", async () => {
	const {controller, updater, messages} = createController();

	await controller.loadUpdater();
	updater.checkForUpdates = async () => {
		updater.emit("checking-for-update");
		updater.emit("update-not-available", {version: "0.2.1"});
		return {updateInfo: {version: "0.2.1"}};
	};

	await controller.checkForUpdates({userInitiated: true});

	assert.equal(messages.length, 1);
	assert.equal(messages[0].message, "Chimera is up to date.");
});

test("manual checks explain when updates are disabled", async () => {
	const {controller, messages} = createController({packaged: false});

	await controller.checkForUpdates({userInitiated: true});

	assert.equal(messages.length, 1);
	assert.equal(messages[0].message, "Updates are only available in packaged builds.");
});
