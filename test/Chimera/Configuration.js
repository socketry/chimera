import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {Configuration} from "../../Chimera/Configuration.js";

test("uses an application state directory for the default configuration", () => {
	const previousConfigPath = process.env.CHIMERA_CONFIG_PATH;

	delete process.env.CHIMERA_CONFIG_PATH;
	const configurationPath = Configuration.defaultConfigPath();
	if (previousConfigPath === undefined) {
		delete process.env.CHIMERA_CONFIG_PATH;
	} else {
		process.env.CHIMERA_CONFIG_PATH = previousConfigPath;
	}

	assert.equal(configurationPath, path.join(os.homedir(), ".local", "state", "chimera", "configuration.json"));
});

test("resolves theme stylesheet relative to the configuration file", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	const stylesheetPath = path.join(directory, "theme.css");
	
	fs.writeFileSync(configPath, JSON.stringify({
		theme: {
			stylesheet: "theme.css",
		},
	}));
	fs.writeFileSync(stylesheetPath, ":root { --accent: hotpink; }");
	
	const configuration = new Configuration({configPath});
	
	assert.equal(configuration.themeStylesheetPath(), stylesheetPath);
	assert.equal(configuration.themeStylesheet(), ":root { --accent: hotpink; }");
});

test("profile theme configuration overrides the default theme", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	const defaultStylesheetPath = path.join(directory, "default.css");
	const profileStylesheetPath = path.join(directory, "profile.css");
	
	fs.writeFileSync(configPath, JSON.stringify({
		theme: {
			stylesheet: defaultStylesheetPath,
		},
		profiles: {
			light: {
				theme: {
					stylesheet: profileStylesheetPath,
				},
			},
		},
	}));
	
	const configuration = new Configuration({configPath, profileName: "light"});
	
	assert.equal(configuration.themeStylesheetPath(), profileStylesheetPath);
});

test("profile terminal configuration overrides the default terminal options", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	
	fs.writeFileSync(configPath, JSON.stringify({
		terminal: {
			fontSize: 14,
			scrollback: 500,
		},
		profiles: {
			large: {
				terminal: {
					fontSize: 20,
					fontFamily: "Monaco, monospace",
				},
			},
		},
	}));
	
	const configuration = new Configuration({configPath, profileName: "large"});
	
	assert.equal(configuration.terminalOptions().fontSize, 20);
	assert.equal(configuration.terminalOptions().fontFamily, "Monaco, monospace");
	assert.equal(configuration.terminalOptions().scrollback, 500);
});

test("update configuration defaults to automatic daily checks", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");

	fs.writeFileSync(configPath, "{}");

	const configuration = new Configuration({configPath});

	assert.deepEqual(configuration.updateOptions(), {
		enabled: true,
		autoCheck: true,
		recheckIntervalHours: 24,
	});
});

test("profile update configuration overrides the default update options", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");

	fs.writeFileSync(configPath, JSON.stringify({
		updates: {
			autoCheck: true,
			recheckIntervalHours: 24,
		},
		profiles: {
			quiet: {
				updates: {
					autoCheck: false,
					recheckIntervalHours: 72,
				},
			},
		},
	}));

	const configuration = new Configuration({configPath, profileName: "quiet"});

	assert.deepEqual(configuration.updateOptions(), {
		enabled: true,
		autoCheck: false,
		recheckIntervalHours: 72,
	});
});
