import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_CONFIGURATION = {
	window: {
		width: 1440,
		height: 900,
		fullscreen: false,
		backgroundColor: "#050914",
		titleBarStyle: "hidden",
		titleBarOverlay: true,
		autoHideMenuBar: true,
	},
	theme: {
		stylesheet: null,
	},
	terminal: {
		fontFamily: '"SFMono-Regular", monospace',
		fontSize: 15,
		lineHeight: 1.0,
		scrollback: 1000,
	},
	updates: {
		enabled: true,
		autoCheck: true,
		recheckIntervalHours: 24,
	},
	profiles: {
		e2e: {
			window: {
				width: 1280,
				height: 800,
				fullscreen: false,
			},
		},
	},
};

function isObject(value) {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function mergeObjects(base, override) {
	const result = {...base};

	for (const [key, value] of Object.entries(override ?? {})) {
		if (isObject(value) && isObject(result[key])) {
			result[key] = mergeObjects(result[key], value);
		} else {
			result[key] = value;
		}
	}

	return result;
}

export class Configuration {
	constructor({configPath = Configuration.defaultConfigPath(), profileName = Configuration.defaultProfileName()} = {}) {
		this.configPath = configPath;
		this.profileName = profileName;
		this.fileConfiguration = this.loadFileConfiguration();
		this.configuration = mergeObjects(DEFAULT_CONFIGURATION, this.fileConfiguration);
	}

	static defaultConfigPath() {
		return process.env.CHIMERA_CONFIG_PATH || path.join(os.homedir(), ".local", "state", "chimera", "configuration.json");
	}

	static defaultProfileName() {
		return process.env.CHIMERA_CONFIG_PROFILE || (process.env.CHIMERA_E2E === "1" ? "e2e" : null);
	}

	loadFileConfiguration() {
		if (!fs.existsSync(this.configPath)) {
			return {};
		}

		const text = fs.readFileSync(this.configPath, "utf8");
		return JSON.parse(text);
	}

	reload() {
		this.fileConfiguration = this.loadFileConfiguration();
		this.configuration = mergeObjects(DEFAULT_CONFIGURATION, this.fileConfiguration);
		return this;
	}

	profileConfiguration() {
		if (!this.profileName) {
			return {};
		}

		return this.configuration.profiles?.[this.profileName] ?? {};
	}

	windowOptions() {
		return mergeObjects(this.configuration.window ?? {}, this.profileConfiguration().window ?? {});
	}

	terminalOptions() {
		return mergeObjects(this.configuration.terminal ?? {}, this.profileConfiguration().terminal ?? {});
	}

	updateOptions() {
		return mergeObjects(this.configuration.updates ?? {}, this.profileConfiguration().updates ?? {});
	}

	configurationDirectory() {
		return path.dirname(this.configPath);
	}

	themeConfiguration() {
		return mergeObjects(this.configuration.theme ?? {}, this.profileConfiguration().theme ?? {});
	}

	themeStylesheetPath() {
		const stylesheet = this.themeConfiguration().stylesheet;
		if (!stylesheet) return null;
		
		return path.isAbsolute(stylesheet)
			? stylesheet
			: path.resolve(this.configurationDirectory(), stylesheet);
	}

	themeStylesheet() {
		const stylesheetPath = this.themeStylesheetPath();
		if (!stylesheetPath) return null;
		
		return fs.readFileSync(stylesheetPath, "utf8");
	}

	bookmarksPath() {
		return path.join(this.configurationDirectory(), "bookmarks.json");
	}
}
