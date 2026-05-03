import {html, render} from "lit";

import {initialData, postJson, refreshChimeraConfiguration} from "/support/client/HTTYTool.js";

const data = initialData();
const app = document.getElementById("app");

let configuration = parseConfiguration(data.configText);
let rawJson = `${JSON.stringify(configuration, null, "\t")}\n`;
let notice = null;
let dirty = false;
let saving = false;

function parseConfiguration(text) {
	try {
		const parsed = JSON.parse(text || "{}");
		return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
	} catch {
		return {};
	}
}

function numberValue(value, fallback = "") {
	const number = Number(value);
	return Number.isFinite(number) ? number : fallback;
}

function updateAt(path, value) {
	const keys = path.split(".");
	let target = configuration;
	for (const key of keys.slice(0, -1)) {
		target[key] ||= {};
		target = target[key];
	}
	target[keys.at(-1)] = value;
	syncJson();
	markDirty();
}

function syncJson() {
	rawJson = `${JSON.stringify(configuration, null, "\t")}\n`;
}

function markDirty() {
	dirty = true;
	notice = null;
	renderApp();
}

function setRawJson(value) {
	rawJson = value;
	configuration = parseConfiguration(value);
	markDirty();
}

async function saveConfiguration(event) {
	event.preventDefault();
	if (!dirty || saving) return;
	if (!event.currentTarget.reportValidity()) return;

	syncJson();
	saving = true;
	renderApp();

	try {
		await postJson("/save", {configuration: rawJson});
		await refreshChimeraConfiguration();
		dirty = false;
		notice = {kind: "success", text: "Configuration saved."};
	} catch (error) {
		notice = {kind: "error", text: error.message || "Could not save configuration."};
	} finally {
		saving = false;
		renderApp();
	}
}

function textInput(label, path, {placeholder = "", type = "text", min, step} = {}) {
	const value = path.split(".").reduce((object, key) => object?.[key], configuration);
	return html`
		<label>
			${label}
			<input
				type=${type}
				placeholder=${placeholder}
				.value=${value ?? ""}
				min=${min ?? ""}
				step=${step ?? ""}
				@input=${(event) => updateAt(path, type === "number" ? numberValue(event.currentTarget.value) : event.currentTarget.value)}
			>
		</label>
	`;
}

function checkboxInput(label, path) {
	const value = path.split(".").reduce((object, key) => object?.[key], configuration);
	return html`
		<label class="checkbox">
			<input type="checkbox" .checked=${Boolean(value)} @change=${(event) => updateAt(path, event.currentTarget.checked)}>
			${label}
		</label>
	`;
}

function selectInput(label, path, values) {
	const value = path.split(".").reduce((object, key) => object?.[key], configuration);
	return html`
		<label>
			${label}
			<select .value=${value ?? ""} @change=${(event) => updateAt(path, event.currentTarget.value)}>
				${values.map((option) => html`<option value=${option}>${option}</option>`)}
			</select>
		</label>
	`;
}

function renderApp() {
	render(html`
		<header>
			<div class="header-copy">
				<h1>Configuration</h1>
				<p>Edit <code>${data.configPath}</code>.</p>
			</div>
			<div class="header-actions">
				${notice ? html`<span class="notice" data-kind=${notice.kind}>${notice.text}</span>` : dirty ? html`<span class="notice" data-kind="dirty">Unsaved changes</span>` : ""}
				<button class="save-button" type="submit" form="configuration-form" data-dirty=${dirty} ?disabled=${!dirty || saving}>${saving ? "Saving..." : "Save"}</button>
			</div>
		</header>
		<form id="configuration-form" @submit=${saveConfiguration}>
			<fieldset>
				<legend>Window</legend>
				<div class="grid">
					${textInput("Width", "window.width", {type: "number", min: 320})}
					${textInput("Height", "window.height", {type: "number", min: 240})}
					${textInput("Background", "window.backgroundColor")}
					${selectInput("Title Bar Style", "window.titleBarStyle", ["hidden", "default", "hiddenInset"])}
					${checkboxInput("Start full screen", "window.fullscreen")}
					${checkboxInput("Use titlebar overlay", "window.titleBarOverlay")}
					${checkboxInput("Auto-hide menu bar", "window.autoHideMenuBar")}
				</div>
			</fieldset>

			<fieldset>
				<legend>Terminal</legend>
				<div class="grid">
					${textInput("Font Family", "terminal.fontFamily")}
					${textInput("Font Size", "terminal.fontSize", {type: "number", min: 8, step: 1})}
					${textInput("Line Height", "terminal.lineHeight", {type: "number", min: 0.8, step: 0.05})}
					${textInput("Scrollback", "terminal.scrollback", {type: "number", min: 0, step: 100})}
				</div>
			</fieldset>

			<fieldset>
				<legend>Theme</legend>
				${textInput("Stylesheet Path", "theme.stylesheet", {placeholder: "theme.css or /absolute/path/theme.css"})}
			</fieldset>

			<fieldset>
				<legend>Updates</legend>
				<div class="grid">
					${checkboxInput("Enable updates", "updates.enabled")}
					${checkboxInput("Check automatically", "updates.autoCheck")}
					${textInput("Recheck Interval (hours)", "updates.recheckIntervalHours", {type: "number", min: 0, step: 1})}
				</div>
			</fieldset>

			<details>
				<summary>JSON</summary>
				<textarea spellcheck="false" .value=${rawJson} @input=${(event) => setRawJson(event.currentTarget.value)}></textarea>
			</details>
		</form>
	`, app);
}

renderApp();
