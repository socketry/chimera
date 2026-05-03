import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {Application} from "@socketry/htty";

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".local", "state", "chimera", "configuration.json");
const configPath = process.env.CHIMERA_CONFIG_PATH || DEFAULT_CONFIG_PATH;

const DEFAULT_CONFIGURATION = {
	window: {
		width: 1440,
		height: 900,
		fullscreen: true,
		backgroundColor: "#050914",
		titleBarStyle: "hidden",
		titleBarOverlay: true,
		autoHideMenuBar: true,
	},
	terminal: {
		fontFamily: '"SFMono-Regular", monospace',
		fontSize: 15,
		lineHeight: 1.0,
		scrollback: 1000,
	},
	theme: {
		stylesheet: null,
	},
	updates: {
		enabled: true,
		autoCheck: true,
		recheckIntervalHours: 24,
	},
};

function readConfiguration() {
	if (!fs.existsSync(configPath)) {
		return {};
	}
	
	return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

function writeConfiguration(configuration) {
	fs.mkdirSync(path.dirname(configPath), {recursive: true});
	fs.writeFileSync(configPath, `${JSON.stringify(configuration, null, "\t")}\n`);
}

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

function normalizeBoolean(value) {
	return value === true || value === "true" || value === "on";
}

function numberOrDefault(value, fallback) {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function normalizeConfiguration(input) {
	return {
		window: {
			width: numberOrDefault(input.window?.width, DEFAULT_CONFIGURATION.window.width),
			height: numberOrDefault(input.window?.height, DEFAULT_CONFIGURATION.window.height),
			fullscreen: normalizeBoolean(input.window?.fullscreen),
			backgroundColor: String(input.window?.backgroundColor || DEFAULT_CONFIGURATION.window.backgroundColor),
			titleBarStyle: String(input.window?.titleBarStyle || DEFAULT_CONFIGURATION.window.titleBarStyle),
			titleBarOverlay: normalizeBoolean(input.window?.titleBarOverlay),
			autoHideMenuBar: normalizeBoolean(input.window?.autoHideMenuBar),
		},
		terminal: {
			fontFamily: String(input.terminal?.fontFamily || DEFAULT_CONFIGURATION.terminal.fontFamily),
			fontSize: numberOrDefault(input.terminal?.fontSize, DEFAULT_CONFIGURATION.terminal.fontSize),
			lineHeight: numberOrDefault(input.terminal?.lineHeight, DEFAULT_CONFIGURATION.terminal.lineHeight),
			scrollback: Math.max(0, Math.floor(numberOrDefault(input.terminal?.scrollback, DEFAULT_CONFIGURATION.terminal.scrollback))),
		},
		theme: {
			stylesheet: input.theme?.stylesheet ? String(input.theme.stylesheet) : null,
		},
		updates: {
			enabled: normalizeBoolean(input.updates?.enabled),
			autoCheck: normalizeBoolean(input.updates?.autoCheck),
			recheckIntervalHours: Math.max(0, numberOrDefault(input.updates?.recheckIntervalHours, DEFAULT_CONFIGURATION.updates.recheckIntervalHours)),
		},
	};
}

function htmlEscape(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

function scriptJson(value) {
	return JSON.stringify(value).replaceAll("</", "<\\/");
}

function response(body, status = 200, headers = {}) {
	return {
		status,
		headers: {
			"content-type": "text/html; charset=utf-8",
			...headers,
		},
		body,
	};
}

function renderPage({saved = false, error = null} = {}) {
	const fileConfiguration = readConfiguration();
	const configuration = mergeObjects(DEFAULT_CONFIGURATION, fileConfiguration);
	const configJson = scriptJson(configuration);
	
	return response(`<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Chimera Configuration</title>
		<style>
			:root {
				color-scheme: light dark;
				--bg: #07111f;
				--panel: rgba(8, 14, 24, 0.82);
				--text: #eef6ff;
				--muted: #9fb0c8;
				--accent: #7dd3fc;
				--border: rgba(148, 163, 184, 0.18);
				--control: rgba(5, 11, 21, 0.72);
			}
			
			@media (prefers-color-scheme: light) {
				:root {
					--bg: #eef3f8;
					--panel: rgba(255, 255, 255, 0.82);
					--text: #0f172a;
					--muted: #64748b;
					--accent: #0369a1;
					--border: rgba(15, 23, 42, 0.14);
					--control: rgba(255, 255, 255, 0.92);
				}
			}
			
			* {
				box-sizing: border-box;
			}
			
			body {
				margin: 0;
				min-height: 100vh;
				padding: 28px;
				background:
					radial-gradient(circle at top left, color-mix(in srgb, var(--accent) 20%, transparent), transparent 28%),
					var(--bg);
				color: var(--text);
				font: 15px/1.45 "Avenir Next", "Helvetica Neue", sans-serif;
			}
			
			main {
				max-width: 940px;
				margin: 0 auto;
				display: grid;
				gap: 18px;
			}
			
			header,
			fieldset,
			.actions,
			.notice {
				border: 1px solid var(--border);
				border-radius: 18px;
				background: var(--panel);
				backdrop-filter: blur(18px);
				box-shadow: 0 18px 60px rgba(0, 0, 0, 0.18);
			}
			
			header {
				padding: 22px 24px;
			}
			
			h1,
			h2,
			p {
				margin: 0;
			}
			
			h1 {
				font-size: clamp(28px, 5vw, 44px);
				letter-spacing: -0.04em;
			}
			
			p {
				color: var(--muted);
			}
			
			form {
				display: grid;
				gap: 18px;
			}
			
			fieldset {
				display: grid;
				gap: 14px;
				margin: 0;
				padding: 20px;
			}
			
			legend {
				padding: 0 8px;
				color: var(--accent);
				font-weight: 700;
				letter-spacing: 0.04em;
				text-transform: uppercase;
			}
			
			.grid {
				display: grid;
				grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
				gap: 14px;
			}
			
			label {
				display: grid;
				gap: 6px;
				color: var(--muted);
				font-size: 13px;
				font-weight: 650;
			}
			
			input,
			select {
				width: 100%;
				border: 1px solid var(--border);
				border-radius: 12px;
				background: var(--control);
				color: var(--text);
				font: inherit;
				padding: 10px 12px;
			}
			
			.checkbox {
				display: flex;
				align-items: center;
				gap: 9px;
				min-height: 42px;
			}
			
			.checkbox input {
				width: auto;
			}
			
			.actions {
				display: flex;
				align-items: center;
				justify-content: space-between;
				gap: 16px;
				padding: 16px 18px;
			}
			
			button {
				border: 0;
				border-radius: 999px;
				padding: 10px 16px;
				background: var(--accent);
				color: Canvas;
				font: inherit;
				font-weight: 750;
				cursor: pointer;
			}
			
			code {
				color: var(--accent);
			}
			
			.notice {
				padding: 14px 16px;
			}
		</style>
	</head>
	<body>
		<main>
			<header>
				<h1>Chimera Configuration</h1>
				<p>Editing <code>${htmlEscape(configPath)}</code>. Restart Chimera to apply window and terminal startup settings.</p>
			</header>
			
			${saved ? '<div class="notice">Saved configuration.</div>' : ""}
			${error ? `<div class="notice">Could not save: ${htmlEscape(error.message)}</div>` : ""}
			
			<form id="config-form">
				<fieldset>
					<legend>Window</legend>
					<div class="grid">
						<label>Width <input name="window.width" type="number" min="320"></label>
						<label>Height <input name="window.height" type="number" min="240"></label>
						<label>Background <input name="window.backgroundColor"></label>
						<label>Title Bar Style
							<select name="window.titleBarStyle">
								<option value="hidden">hidden</option>
								<option value="default">default</option>
								<option value="hiddenInset">hiddenInset</option>
							</select>
						</label>
						<label class="checkbox"><input name="window.fullscreen" type="checkbox"> Start full screen</label>
						<label class="checkbox"><input name="window.titleBarOverlay" type="checkbox"> Use titlebar overlay</label>
						<label class="checkbox"><input name="window.autoHideMenuBar" type="checkbox"> Auto-hide menu bar</label>
					</div>
				</fieldset>
				
				<fieldset>
					<legend>Terminal</legend>
					<div class="grid">
						<label>Font Family <input name="terminal.fontFamily"></label>
						<label>Font Size <input name="terminal.fontSize" type="number" min="8" step="1"></label>
						<label>Line Height <input name="terminal.lineHeight" type="number" min="0.8" step="0.05"></label>
						<label>Scrollback <input name="terminal.scrollback" type="number" min="0" step="100"></label>
					</div>
				</fieldset>
				
				<fieldset>
					<legend>Theme</legend>
					<label>Stylesheet Path <input name="theme.stylesheet" placeholder="theme.css or /absolute/path/theme.css"></label>
				</fieldset>

				<fieldset>
					<legend>Updates</legend>
					<div class="grid">
						<label class="checkbox"><input name="updates.enabled" type="checkbox"> Enable updates</label>
						<label class="checkbox"><input name="updates.autoCheck" type="checkbox"> Check automatically</label>
						<label>Recheck Interval (hours) <input name="updates.recheckIntervalHours" type="number" min="0" step="1"></label>
					</div>
				</fieldset>
				
				<div class="actions">
					<p>Custom theme paths are resolved relative to the configuration file.</p>
					<button type="submit">Save Configuration</button>
				</div>
			</form>
		</main>
		
		<script>
			const configuration = ${configJson};
			const form = document.getElementById("config-form");
			
			function setValue(name, value) {
				const field = form.elements[name];
				if (!field) return;
				if (field.type === "checkbox") {
					field.checked = Boolean(value);
				} else {
					field.value = value ?? "";
				}
			}
			
			setValue("window.width", configuration.window?.width);
			setValue("window.height", configuration.window?.height);
			setValue("window.backgroundColor", configuration.window?.backgroundColor);
			setValue("window.titleBarStyle", configuration.window?.titleBarStyle);
			setValue("window.fullscreen", configuration.window?.fullscreen);
			setValue("window.titleBarOverlay", configuration.window?.titleBarOverlay);
			setValue("window.autoHideMenuBar", configuration.window?.autoHideMenuBar);
			setValue("terminal.fontFamily", configuration.terminal?.fontFamily);
			setValue("terminal.fontSize", configuration.terminal?.fontSize);
			setValue("terminal.lineHeight", configuration.terminal?.lineHeight);
			setValue("terminal.scrollback", configuration.terminal?.scrollback);
			setValue("theme.stylesheet", configuration.theme?.stylesheet);
			setValue("updates.enabled", configuration.updates?.enabled);
			setValue("updates.autoCheck", configuration.updates?.autoCheck);
			setValue("updates.recheckIntervalHours", configuration.updates?.recheckIntervalHours);
			
			function formDataObject() {
				const data = new FormData(form);
				return {
					window: {
						width: data.get("window.width"),
						height: data.get("window.height"),
						backgroundColor: data.get("window.backgroundColor"),
						titleBarStyle: data.get("window.titleBarStyle"),
						fullscreen: form.elements["window.fullscreen"].checked,
						titleBarOverlay: form.elements["window.titleBarOverlay"].checked,
						autoHideMenuBar: form.elements["window.autoHideMenuBar"].checked,
					},
					terminal: {
						fontFamily: data.get("terminal.fontFamily"),
						fontSize: data.get("terminal.fontSize"),
						lineHeight: data.get("terminal.lineHeight"),
						scrollback: data.get("terminal.scrollback"),
					},
					theme: {
						stylesheet: data.get("theme.stylesheet"),
					},
					updates: {
						enabled: form.elements["updates.enabled"].checked,
						autoCheck: form.elements["updates.autoCheck"].checked,
						recheckIntervalHours: data.get("updates.recheckIntervalHours"),
					},
				};
			}
			
			form.addEventListener("submit", async (event) => {
				event.preventDefault();
				const response = await fetch("/save", {
					method: "POST",
					headers: {"content-type": "application/json"},
					body: JSON.stringify(formDataObject()),
				});
				document.open();
				document.write(await response.text());
				document.close();
			});
		</script>
	</body>
</html>`);
}

Application.open(({method, path, body}) => {
	if (method === "POST" && path === "/save") {
		try {
			const current = readConfiguration();
			const next = normalizeConfiguration(JSON.parse(body || "{}"));
			writeConfiguration(mergeObjects(current, next));
			return renderPage({saved: true});
		} catch (error) {
			return renderPage({error});
		}
	}
	
	return renderPage();
});
