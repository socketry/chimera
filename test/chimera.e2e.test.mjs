import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {_electron as electron} from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";

async function launchChimera() {
	const electronApp = await electron.launch({
		args: [projectRoot],
		env: {
			...process.env,
			CHIMERA_E2E: "1",
		},
	});

	const window = await electronApp.firstWindow();
	await window.waitForLoadState("domcontentloaded");

	return {electronApp, window};
}

async function waitForActiveSurfaceId(window) {
	await window.waitForSelector(".surface-panel:not([hidden]) .surface-browser-host", {state: "visible"});

	const surfaceId = await window.evaluate(() => {
		return document.querySelector(".surface-panel:not([hidden])")?.dataset.surfaceId ?? null;
	});

	assert.ok(surfaceId, "active surface should expose a surface ID");
	return surfaceId;
}

async function waitForSurfaceDebugState(window, predicate, {surfaceId = null, timeout = 30000} = {}) {
	const deadline = Date.now() + timeout;

	while (Date.now() < deadline) {
		const targetSurfaceId = surfaceId ?? await window.evaluate(() => {
			return document.querySelector(".surface-panel:not([hidden])")?.dataset.surfaceId ?? null;
		});

		if (targetSurfaceId) {
			const state = await window.evaluate(async (id) => {
				return window.chimera.getSurfaceDebugState(id);
			}, targetSurfaceId);

			if (state && predicate(state)) {
				return state;
			}
		}

		await new Promise((resolve) => setTimeout(resolve, 50));
	}

	throw new Error("Timed out waiting for the active surface browser view state.");
}

async function evaluateSurface(window, surfaceId, script) {
	return window.evaluate(async ({surfaceId, script}) => {
		return window.chimera.evaluateSurface(surfaceId, script);
	}, {surfaceId, script});
}

async function clickMenuItem(electronApp, ...labels) {
	await electronApp.evaluate(({Menu}, itemLabels) => {
		const menu = Menu.getApplicationMenu();
		if (!menu) {
			throw new Error("Application menu is not available.");
		}

		let items = menu.items;
		let target = null;

		for (const label of itemLabels) {
			target = items.find((item) => item.label === label);
			if (!target) {
				throw new Error(`Could not find menu item: ${label}`);
			}

			items = target.submenu?.items ?? [];
		}

		target.click();
	}, labels);
}


test("shows xterm on first load", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		await window.waitForSelector(".terminal-panel", {state: "visible"});
		await window.waitForSelector(".terminal-host .xterm", {state: "attached"});

		const host = window.locator(".terminal-host");
		const box = await host.boundingBox();
		assert.ok(box, "terminal host should have a layout box");
		assert.ok(box.width > 0, "terminal host should have positive width");
		assert.ok(box.height > 0, "terminal host should have positive height");

		const xterm = window.locator(".terminal-host .xterm");
		assert.equal(await xterm.count(), 1);
		await xterm.waitFor({state: "visible"});
		assert.equal(await window.locator("#empty-state").isHidden(), true);
	} finally {
		await electronApp.close();
	}
});

test("opens a new shell tab with the primary tab shortcut", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		const initialCount = await window.locator(".tab-button").count();

		await window.keyboard.press(`${primaryModifier}+T`);
		await window.waitForFunction((expectedCount) => {
			return document.querySelectorAll(".tab-button").length > expectedCount;
		}, initialCount);

		assert.equal(await window.locator(".tab-button").count(), initialCount + 1);
	} finally {
		await electronApp.close();
	}
});

test("launches the hello world example twice", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		await window.waitForFunction(() => {
			return Array.from(document.querySelectorAll(".tab-button")).some((node) => node.getAttribute("aria-label")?.includes("hello-world.mjs"));
		});

		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		await window.waitForFunction(() => {
			const commandTabs = Array.from(document.querySelectorAll(".tab-button")).filter((node) => node.getAttribute("aria-label")?.includes("hello-world.mjs"));
			return commandTabs.length >= 2;
		});

		const commandTabs = window.locator('.tab-button[aria-label*="hello-world.mjs"]');
		assert.ok((await commandTabs.count()) >= 2, "should create a second hello-world session tab");
	} finally {
		await electronApp.close();
	}
});

test("ctrl-c interrupts hello world from the attached surface tab", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		const surfaceTab = window.locator('.tab-button[aria-label*="HTTY Hello World /"]');
		await surfaceTab.waitFor({state: "visible"});
		await surfaceTab.click();
		const activeSurfaceTab = window.locator('.tab-button-active[aria-label*="HTTY Hello World /"]');
		await activeSurfaceTab.waitFor({state: "visible"});

		await window.keyboard.press("Control+C");
		const exitedCommandTab = window.locator('.tab-button-exited[aria-label*="hello-world.mjs"]');
		await exitedCommandTab.waitFor({state: "visible"});
	} finally {
		await electronApp.close();
	}
});

test("ctrl-c interrupts hello world after switching back to the terminal tab", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		const surfaceTab = window.locator('.tab-button[aria-label*="HTTY Hello World /"]');
		await surfaceTab.waitFor({state: "visible"});

		const commandTab = window.locator('.tab-button[aria-label*="hello-world.mjs"]');
		await commandTab.waitFor({state: "visible"});

		await commandTab.click();
		const activeCommandTab = window.locator('.tab-button-active[aria-label*="hello-world.mjs"]');
		await activeCommandTab.waitFor({state: "visible"});
		await window.locator('.terminal-panel:not([hidden]) .terminal-host').click();

		await window.keyboard.press("Control+C");
		const exitedCommandTab = window.locator('.tab-button-exited[aria-label*="hello-world.mjs"]');
		await exitedCommandTab.waitFor({state: "visible"});
	} finally {
		await electronApp.close();
	}
});

test("terminal tab activation restores terminal focus", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		await window.locator('.tab-button[aria-label*="HTTY Hello World /"]').waitFor({state: "visible"});

		const commandTab = window.locator('.tab-button[aria-label*="hello-world.mjs"]');
		await commandTab.click();
		await window.locator('.terminal-panel:not([hidden]) .terminal-host').click();

		await window.waitForFunction(() => {
			const active = document.activeElement;
			return active?.classList?.contains("xterm-helper-textarea") === true;
		});
	} finally {
		await electronApp.close();
	}
});

test("hello world surface renders without switching tabs", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Hello World");
		await waitForSurfaceDebugState(window, (state) => state.textContent.includes("Hello World from HTTY"));
	} finally {
		await electronApp.close();
	}
});


test("surface browser view receives visibilitychange when switching tabs", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Browser Demo");
		const surfaceId = await waitForActiveSurfaceId(window);
		await waitForSurfaceDebugState(window, (state) => {
			return state.id === surfaceId && state.textContent.toLowerCase().includes("htty browser demo");
		}, {surfaceId});
		await evaluateSurface(window, surfaceId, `(() => {
			window.__chimeraVisibilityEvents = [];
			const record = () => {
				window.__chimeraVisibilityEvents.push(document.visibilityState);
			};

			document.onvisibilitychange = record;
			window.__chimeraVisibilityEvents.push(document.visibilityState);
		})();`);

		const commandTab = window.locator('.tab-button[aria-label*="browser-demo.mjs"]');
		await commandTab.waitFor({state: "visible"});
		await commandTab.click();
		await window.locator('.tab-button-active[aria-label*="browser-demo.mjs"]').waitFor({state: "visible"});

		const surfaceTab = window.locator('.tab-button[aria-label*="HTTY Browser Demo /"]');
		await surfaceTab.waitFor({state: "visible"});
		await surfaceTab.first().click();

		const visibilityEvents = await evaluateSurface(window, surfaceId, "window.__chimeraVisibilityEvents || []");
		assert.deepEqual(visibilityEvents, ["visible", "hidden", "visible"]);
	} finally {
		await electronApp.close();
	}
});

test("opens the debug tab from the toolbar button", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		await window.waitForSelector(".terminal-panel", {state: "visible"});
		await clickMenuItem(electronApp, "View", "Show Debug Tab");
		await window.waitForSelector(".debug-panel", {state: "visible"});
		await window.waitForSelector(".debug-panel .packet-log", {state: "attached"});

		const activeDebugTab = window.locator('.tab-button-active[aria-label="Debug"]');
		await activeDebugTab.waitFor({state: "visible"});
		assert.equal(await window.locator(".debug-panel").isVisible(), true);
	} finally {
		await electronApp.close();
	}
});

test("launches the browser demo and shows the attached surface", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Browser Demo");
		await waitForSurfaceDebugState(window, (state) => {
			const text = state.textContent.toLowerCase();
			return text.includes("htty browser demo") && text.includes("request:") && text.includes("get /");
		});

		const activeSurfaceTab = window.locator('.tab-button-active[aria-label*="/"]');
		await activeSurfaceTab.waitFor({state: "visible"});
		assert.equal(await window.locator(".surface-panel").last().isVisible(), true);
	} finally {
		await electronApp.close();
	}
});

test("opens a second surface tab from the address bar", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await clickMenuItem(electronApp, "Session", "Launch HTTY Browser Demo");
		const initialSurfaceTab = window.locator('.tab-button[aria-label*=" /"]');
		await initialSurfaceTab.first().waitFor({state: "visible"});

		await window.locator("#address-input").fill("/second-path");
		await window.locator("#address-submit").click();

		const activeSecondSurfaceTab = window.locator('.tab-button-active[aria-label*="/second-path"]');
		await activeSecondSurfaceTab.waitFor({state: "visible"});
		await waitForSurfaceDebugState(window, (state) => state.textContent.includes("GET /second-path"));

		const matchingTabs = window.locator('.tab-button[aria-label*="/second-path"]');
		assert.ok((await matchingTabs.count()) >= 1, "should create a surface tab for the requested path");
		const allSurfaceTabs = window.locator('.tab-button[aria-label*="HTTY Browser Demo /"]');
		assert.ok((await allSurfaceTabs.count()) >= 2, "should keep the original surface tab and add a second one");
	} finally {
		await electronApp.close();
	}
});