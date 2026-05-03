import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {Configuration} from "../../Chimera/Configuration.js";
import {createConfigurationEditorApp, readConfigurationText, writeConfigurationText} from "../../bin/chimera-configuration-editor";

function createConfigurationDirectory() {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-configuration-editor-"));
	const configPath = path.join(directory, "chimera.json");
	fs.writeFileSync(configPath, "{}");
	return {directory, configPath, configuration: new Configuration({configPath})};
}

test("defaults to the effective configuration when the configuration file is missing", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-configuration-editor-"));
	const configPath = path.join(directory, "chimera.json");
	const configuration = new Configuration({configPath});

	assert.deepEqual(JSON.parse(readConfigurationText(configuration)), configuration.configuration);
});

test("renders the configuration editor shell with initial data", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createConfigurationEditorApp({configuration});
	const response = app({method: "GET", path: "/", body: ""});
	const initialData = JSON.parse(response.body.match(/<script id="initial-data" type="application\/json">(.+)<\/script>/)[1]);

	assert.equal(response.status, 200);
	assert.equal(response.headers["content-type"], "text/html; charset=utf-8");
	assert.match(response.body, /<main id="app"><\/main>/);
	assert.equal(initialData.configPath, configuration.configPath);
	assert.equal(initialData.configText, "{}");
	assert.match(response.body, /\/assets\/chimera-configuration-editor\.js/);
});

test("serves editor client assets", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createConfigurationEditorApp({configuration});
	const response = app({method: "GET", path: "/assets/chimera-configuration-editor.js", body: ""});

	assert.equal(response.status, 200);
	assert.equal(response.headers["content-type"], "text/javascript; charset=utf-8");
	assert.match(response.body.toString(), /from "lit"/);
});

test("saves normalized configuration json", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createConfigurationEditorApp({configuration});
	const response = app({
		method: "POST",
		path: "/save",
		body: JSON.stringify({
			configuration: JSON.stringify({
				updates: {
					enabled: true,
					autoCheck: false,
					recheckIntervalHours: 12,
				},
			}),
		}),
	});

	assert.equal(response.status, 200);
	assert.deepEqual(JSON.parse(response.body), {saved: true});
	assert.deepEqual(JSON.parse(fs.readFileSync(configuration.configPath, "utf8")), {
		updates: {
			enabled: true,
			autoCheck: false,
			recheckIntervalHours: 12,
		},
	});
});

test("rejects invalid configuration without writing", () => {
	const {configuration} = createConfigurationDirectory();
	const app = createConfigurationEditorApp({configuration});
	const response = app({
		method: "POST",
		path: "/save",
		body: JSON.stringify({
			configuration: "[]",
		}),
	});

	assert.equal(response.status, 400);
	assert.match(JSON.parse(response.body).error, /JSON object/);
	assert.equal(fs.readFileSync(configuration.configPath, "utf8"), "{}");
});

test("validates configuration text before writing directly", () => {
	const {configuration} = createConfigurationDirectory();

	assert.throws(() => {
		writeConfigurationText("[]", {configPath: configuration.configPath});
	}, /JSON object/);
});
