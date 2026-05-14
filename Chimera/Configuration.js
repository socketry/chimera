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
	debug: {
		autoInspectSurfaces: false,
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

		try {
			const text = fs.readFileSync(this.configPath, "utf8");
			const configuration = JSON.parse(text);
			
			if (!isObject(configuration)) {
				console.log("Unable to load Chimera configuration:", new Error("Configuration file must contain a JSON object."));
				return {};
			}
			
			return configuration;
		} catch (error) {
			console.log("Unable to load Chimera configuration:", error);
			return {};
		}
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

	debugOptions() {
		return mergeObjects(this.configuration.debug ?? {}, this.profileConfiguration().debug ?? {});
	}

	setDebugOption(key, value) {
		const fileConfiguration = isObject(this.fileConfiguration) ? {...this.fileConfiguration} : {};
		const debug = isObject(fileConfiguration.debug) ? {...fileConfiguration.debug} : {};
		debug[key] = value;
		fileConfiguration.debug = debug;
		this.fileConfiguration = fileConfiguration;
		this.configuration = mergeObjects(DEFAULT_CONFIGURATION, this.fileConfiguration);
		this.persist();
	}

	persist() {
		fs.mkdirSync(this.configurationDirectory(), {recursive: true});
		fs.writeFileSync(this.configPath, `${JSON.stringify(this.fileConfiguration, null, "\t")}\n`);
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
		
		try {
			return fs.readFileSync(stylesheetPath, "utf8");
		} catch (error) {
			console.log("Unable to load Chimera theme stylesheet:", error);
			return null;
		}
	}

	bookmarksPath() {
		return path.join(this.configurationDirectory(), "bookmarks.json");
	}
}
