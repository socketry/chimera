import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {BookmarksController} from "../../Chimera/BookmarksController.js";
import {Configuration} from "../../Chimera/Configuration.js";

function createConfigurationDirectory() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-bookmarks-"));
	const configPath = path.join(directory, "chimera.json");
	fs.writeFileSync(configPath, "{}");
	return {directory, configPath};
}

test("resolves bookmarks.json relative to the configuration file", () => {
	const {directory, configPath} = createConfigurationDirectory();
	const configuration = new Configuration({configPath});

	assert.equal(configuration.bookmarksPath(), path.join(directory, "bookmarks.json"));
});

test("loads bookmarks from bookmarks.json in document order", () => {
	const {directory, configPath} = createConfigurationDirectory();
	fs.mkdirSync(path.join(directory, "project"));
	fs.writeFileSync(path.join(directory, "bookmarks.json"), JSON.stringify([
		{
			title: "Production",
			command: "ssh",
			args: ["prod"],
		},
		{
			type: "separator",
		},
		{
			title: "Project Shell",
			command: "/bin/zsh",
			args: ["-lc", "exec $SHELL"],
			cwd: "project",
		},
		{
			title: "Servers",
			items: [
				{
					title: "Staging",
					command: "ssh",
					args: ["staging"],
				},
			],
		},
	]));

	const controller = new BookmarksController({
		configuration: new Configuration({configPath}),
	});

	assert.deepEqual(controller.bookmarks(), [
		{
			type: "command",
			title: "Production",
			command: "ssh",
			args: ["prod"],
			cwd: undefined,
		},
		{
			type: "separator",
		},
		{
			type: "command",
			title: "Project Shell",
			command: "/bin/zsh",
			args: ["-lc", "exec $SHELL"],
			cwd: path.join(directory, "project"),
		},
		{
			type: "group",
			title: "Servers",
			items: [
				{
					type: "command",
					title: "Staging",
					command: "ssh",
					args: ["staging"],
					cwd: undefined,
				},
			],
		},
	]);
});

test("returns no bookmarks when bookmarks.json is missing", () => {
	const {configPath} = createConfigurationDirectory();
	const controller = new BookmarksController({
		configuration: new Configuration({configPath}),
	});

	assert.deepEqual(controller.bookmarks(), []);
});

test("returns no bookmarks when bookmarks.json is invalid", () => {
	const {directory, configPath} = createConfigurationDirectory();
	const events = [];
	fs.writeFileSync(path.join(directory, "bookmarks.json"), JSON.stringify([
		{
			title: "Broken",
			args: ["missing-command"],
		},
	]));

	const controller = new BookmarksController({
		configuration: new Configuration({configPath}),
		trace: (event, details) => events.push({event, details}),
	});

	assert.deepEqual(controller.bookmarks(), []);
	assert.equal(events[0]?.event, "bookmarks:load-failed");
	assert.match(events[0]?.details.message, /requires a command/);
});
