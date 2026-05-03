import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {Configuration} from "../../Chimera/Configuration.js";
import {createBookmarksEditorApp, readBookmarksText, writeBookmarksText} from "../../bin/chimera-bookmarks-editor";

function createConfigurationDirectory() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-bookmarks-editor-"));
	const configPath = path.join(directory, "chimera.json");
	fs.writeFileSync(configPath, "{}");
	return {directory, configuration: new Configuration({configPath})};
}

test("defaults to an empty bookmarks document when bookmarks.json is missing", () => {
	const {configuration} = createConfigurationDirectory();

	assert.equal(readBookmarksText(configuration.bookmarksPath()), "[]\n");
});

test("renders the bookmarks editor shell with initial data", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createBookmarksEditorApp({configuration});
	const response = app({method: "GET", path: "/", body: ""});
	const initialData = JSON.parse(response.body.match(/<script id="initial-data" type="application\/json">(.+)<\/script>/)[1]);

	assert.equal(response.status, 200);
	assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
	assert.match(response.body, /<main id="app"><\/main>/);
	assert.equal(initialData.bookmarksPath, configuration.bookmarksPath());
	assert.equal(initialData.bookmarksText, "[]\n");
	assert.match(response.body, /\/assets\/chimera-bookmarks-editor\.js/);
});

test("serves editor client assets", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createBookmarksEditorApp({configuration});
	const response = app({method: "GET", path: "/assets/chimera-bookmarks-editor.js", body: ""});

	assert.equal(response.status, 200);
	assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
	assert.match(response.body.toString(), /from "lit"/);
});

test("saves normalized bookmarks.json", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createBookmarksEditorApp({configuration});
	const response = app({
		method: "POST",
		path: "/save",
		body: JSON.stringify({
			bookmarks: JSON.stringify([
				{
					title: "Production",
					command: "ssh",
					args: ["prod"],
				},
			]),
		}),
	});

	assert.equal(response.status, 200);
	assert.deepEqual(JSON.parse(response.body), {saved: true});
	assert.deepEqual(JSON.parse(fs.readFileSync(configuration.bookmarksPath(), "utf8")), [
		{
			title: "Production",
			command: "ssh",
			args: ["prod"],
		},
	]);
});

test("rejects invalid bookmarks without writing bookmarks.json", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createBookmarksEditorApp({configuration});
	const response = app({
		method: "POST",
		path: "/save",
		body: JSON.stringify({
			bookmarks: JSON.stringify([{title: "Broken"}]),
		}),
	});

	assert.equal(response.status, 400);
	assert.match(JSON.parse(response.body).error, /requires a command/);
	assert.equal(fs.existsSync(configuration.bookmarksPath()), false);
});

test("validates bookmarks before writing text directly", () => {
	const {configuration} = createConfigurationDirectory();

	assert.throws(() => {
		writeBookmarksText(JSON.stringify([{title: "Broken"}]), {
			bookmarksPath: configuration.bookmarksPath(),
			bookmarksController: {
				normalizeItems() {
					throw new TypeError("broken bookmark");
				},
			},
		});
	}, /broken bookmark/);
});
