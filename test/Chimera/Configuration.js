import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {Configuration} from "../../Chimera/Configuration.js";

function captureConsoleLog(callback) {
	const originalLog = console.log;
	const logs = [];
	
	console.log = (...args) => {
		logs.push(args);
	};
	
	try {
		return {result: callback(), logs};
	} finally {
		console.log = originalLog;
	}
}

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

test("falls back to defaults when configuration JSON is invalid", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	
	fs.writeFileSync(configPath, "{nope");
	
	const {result: configuration, logs} = captureConsoleLog(() => new Configuration({configPath}));
	
	assert.equal(configuration.windowOptions().width, 1440);
	assert.equal(configuration.terminalOptions().fontSize, 15);
	assert.equal(logs.length, 1);
	assert.equal(logs[0][0], "Unable to load Chimera configuration:");
	assert.ok(logs[0][1] instanceof SyntaxError);
});

test("falls back to defaults when configuration JSON is not an object", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	
	fs.writeFileSync(configPath, "[]");
	
	const {result: configuration, logs} = captureConsoleLog(() => new Configuration({configPath}));
	
	assert.equal(configuration.terminalOptions().fontSize, 15);
	assert.equal(logs.length, 1);
	assert.equal(logs[0][0], "Unable to load Chimera configuration:");
	assert.equal(logs[0][1].message, "Configuration file must contain a JSON object.");
});

test("missing theme stylesheets return null", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	const stylesheetPath = path.join(directory, "missing.css");
	
	fs.writeFileSync(configPath, JSON.stringify({
		theme: {
			stylesheet: "missing.css",
		},
	}));
	
	const configuration = new Configuration({configPath});
	
	assert.equal(configuration.themeStylesheetPath(), stylesheetPath);
	const {result: stylesheet, logs} = captureConsoleLog(() => configuration.themeStylesheet());
	assert.equal(stylesheet, null);
	assert.equal(logs.length, 1);
	assert.equal(logs[0][0], "Unable to load Chimera theme stylesheet:");
	assert.equal(logs[0][1].code, "ENOENT");
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

test("reload rereads configuration from disk", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");

	fs.writeFileSync(configPath, JSON.stringify({
		terminal: {
			fontSize: 14,
		},
	}));

	const configuration = new Configuration({configPath});
	assert.equal(configuration.terminalOptions().fontSize, 14);

	fs.writeFileSync(configPath, JSON.stringify({
		terminal: {
			fontSize: 22,
		},
	}));

	configuration.reload();

	assert.equal(configuration.terminalOptions().fontSize, 22);
});

test("reload falls back to defaults when configuration JSON becomes invalid", () => {
	const directory = fs.mkdtempSync(path.join(os.tmpdir(), "chimera-config-"));
	const configPath = path.join(directory, "chimera.json");
	
	fs.writeFileSync(configPath, JSON.stringify({
		terminal: {
			fontSize: 18,
		},
		theme: {
			stylesheet: "missing.css",
		},
	}));
	
	const configuration = new Configuration({configPath});
	assert.equal(configuration.terminalOptions().fontSize, 18);
	assert.equal(captureConsoleLog(() => configuration.themeStylesheet()).result, null);
	
	fs.writeFileSync(configPath, "{broken");
	const {logs} = captureConsoleLog(() => configuration.reload());
	
	assert.equal(configuration.terminalOptions().fontSize, 15);
	assert.equal(logs.length, 1);
	assert.equal(logs[0][0], "Unable to load Chimera configuration:");
	assert.ok(logs[0][1] instanceof SyntaxError);
});
