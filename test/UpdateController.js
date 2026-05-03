import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import test from "node:test";

import {UpdateController} from "../Chimera/UpdateController.js";

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
		this.emit("update-downloaded", {version: "0.2.2"});
	}

	quitAndInstall() {
		this.installs += 1;
	}
}

function createController({packaged = true, dialogResponses = []} = {}) {
	const updater = new FakeUpdater();
	const messages = [];
	const events = [];
	const dialog = {
		async showMessageBox(options) {
			messages.push(options);
			return dialogResponses.shift() ?? {response: 0};
		},
	};
	const controller = new UpdateController({
		app: {isPackaged: packaged},
		dialog,
		logLifecycle: (event, details = {}) => events.push({event, details}),
		updaterLoader: async () => ({autoUpdater: updater}),
		logger: null,
	});

	return {controller, updater, messages, events};
}

test("prompts before downloading and installing an available update", async () => {
	const {controller, updater, messages} = createController();

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;

	assert.equal(updater.autoDownload, false);
	assert.equal(messages.length, 1);
	assert.equal(messages[0].message, "New version is available, update now?");
	assert.equal(messages[0].detail, "Version 0.2.2 is ready to download and install.");
	assert.deepEqual(messages[0].buttons, ["Update Now", "Later"]);
	assert.equal(updater.downloads, 1);
	assert.equal(updater.installs, 1);
});

test("does not download when the update prompt is dismissed", async () => {
	const {controller, updater} = createController({dialogResponses: [{response: 1}]});

	await controller.loadUpdater();
	updater.emit("update-available", {version: "0.2.2"});
	await controller.prompting;

	assert.equal(updater.downloads, 0);
	assert.equal(updater.installs, 0);
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
