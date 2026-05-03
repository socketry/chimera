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

test("resolves bookmarks relative to the configuration file", () => {
	const {directory, configPath} = createConfigurationDirectory();
	const configuration = new Configuration({configPath});

	assert.equal(configuration.bookmarksDirectory(), path.join(directory, "bookmarks"));
});

test("loads bookmark scripts from the bookmarks directory", () => {
	const {directory, configPath} = createConfigurationDirectory();
	const bookmarksDirectory = path.join(directory, "bookmarks");
	fs.mkdirSync(bookmarksDirectory);
	fs.writeFileSync(path.join(bookmarksDirectory, "zebra"), "#!/usr/bin/env sh\n");
	fs.writeFileSync(path.join(bookmarksDirectory, "alpha.sh"), "#!/usr/bin/env sh\n");
	fs.writeFileSync(path.join(bookmarksDirectory, ".hidden"), "#!/usr/bin/env sh\n");
	fs.mkdirSync(path.join(bookmarksDirectory, "folder"));

	const controller = new BookmarksController({
		configuration: new Configuration({configPath}),
	});

	assert.deepEqual(controller.bookmarks(), [
		{
			title: "alpha",
			path: path.join(bookmarksDirectory, "alpha.sh"),
			cwd: bookmarksDirectory,
		},
		{
			title: "zebra",
			path: path.join(bookmarksDirectory, "zebra"),
			cwd: bookmarksDirectory,
		},
	]);
});

test("returns no bookmarks when the bookmarks directory is missing", () => {
	const {configPath} = createConfigurationDirectory();
	const controller = new BookmarksController({
		configuration: new Configuration({configPath}),
	});

	assert.deepEqual(controller.bookmarks(), []);
});
