import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {_electron as electron} from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const configPath = path.join(__dirname, "config.json");
const primaryModifier = process.platform === "darwin" ? "Meta" : "Control";
const shellCommand = process.env.SHELL || "/bin/zsh";

async function launchChimera() {
	const electronApp = await electron.launch({
		args: [projectRoot],
		env: {
			...process.env,
			CHIMERA_CONFIG_PATH: configPath,
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

async function shellSessionId(window) {
	const sessions = await window.evaluate(() => window.chimera.getSessions());
	return sessions[0]?.id ?? null;
}

async function launchExampleFromShell(window, example) {
	const sessionId = await shellSessionId(window);
	assert.ok(sessionId, "expected an initial shell session");
	await window.evaluate(({id, cmd}) => window.chimera.sendInput(id, cmd), {id: sessionId, cmd: `node examples/${example}\r`});
	await window.locator(".tab-panel:not([hidden]) .surface-panel:not([hidden])").first().waitFor({state: "visible"});
	return sessionId;
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

test("interface full screen hides the tab bar", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	
	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		assert.equal(await window.locator(".tab-strip-shell").isVisible(), true);
		
		const enabled = await window.evaluate(() => window.chimera.toggleInterfaceFullScreen());
		assert.equal(enabled, true);
		await window.waitForSelector(".tab-strip-shell", {state: "hidden"});
		assert.equal(await window.locator(".terminal-panel:not([hidden]) .terminal-host").isVisible(), true);
		
		const disabled = await window.evaluate(() => window.chimera.toggleInterfaceFullScreen());
		assert.equal(disabled, false);
		await window.waitForSelector(".tab-strip-shell", {state: "visible"});
	} finally {
		await electronApp.close();
	}
});

test("interface full screen resizes active browser surfaces", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	
	try {
		await launchExampleFromShell(window, "hello-world.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const before = await window.evaluate((id) => window.chimera.evaluateSurface(id, "window.innerHeight"), surfaceId);
		
		const enabled = await window.evaluate(() => window.chimera.toggleInterfaceFullScreen());
		assert.equal(enabled, true);
		await window.waitForSelector(".tab-strip-shell", {state: "hidden"});
		await window.waitForFunction(async (id, previousHeight) => {
			const height = await window.chimera.evaluateSurface(id, "window.innerHeight");
			return Number(height) > Number(previousHeight);
		}, surfaceId, before);
	} finally {
		await electronApp.close();
	}
});

test("opens a new window with a shell tab using the primary window shortcut", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await window.waitForSelector(".tab-button", {state: "visible"});

		const newWindowPromise = electronApp.waitForEvent("window");
		await window.keyboard.press(`${primaryModifier}+N`);

		const newWindow = await newWindowPromise;
		await newWindow.waitForLoadState("domcontentloaded");
		await newWindow.waitForSelector(".tab-button", {state: "visible"});
		await newWindow.waitForSelector(".terminal-panel:not([hidden])", {state: "visible"});

		assert.equal(electronApp.windows().length, 2);
		assert.equal(await newWindow.locator(".tab-button").count(), 1);
	} finally {
		await electronApp.close();
	}
});

test("moves a shell session to a new window", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	
	try {
		await window.waitForSelector(".tab-button", {state: "visible"});
		const sessionId = await shellSessionId(window);
		assert.ok(sessionId, "expected an initial shell session");
		
		const newWindowPromise = electronApp.waitForEvent("window");
		const result = await window.evaluate((id) => window.chimera.moveSessionToNewWindow(id, {
			windowOptions: {
				fullscreen: false,
			},
		}), sessionId);
		assert.equal(result.sessionId, sessionId);
		
		const newWindow = await newWindowPromise;
		await newWindow.waitForLoadState("domcontentloaded");
		await newWindow.waitForSelector(".tab-button", {state: "visible"});
		await newWindow.waitForSelector(".terminal-panel", {state: "visible"});
		
		const movedSessions = await newWindow.evaluate(() => window.chimera.getSessions());
		assert.equal(movedSessions.length, 1);
		assert.equal(movedSessions[0].id, sessionId);
		assert.equal(await newWindow.locator(".tab-button").count(), 1);
		
		const isFullScreen = await newWindow.evaluate(() => window.outerWidth === screen.width && window.outerHeight === screen.height);
		assert.equal(isFullScreen, false);
	} finally {
		await electronApp.close();
	}
});

test("ctrl-c interrupts hello world running in the shell", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const sessionId = await launchExampleFromShell(window, "hello-world.mjs");

		await window.evaluate((id) => window.chimera.interruptSession(id), sessionId);

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			const session = sessions.find((s) => s.id === id);
			return session && session.transportMode === "terminal";
		}, sessionId);
	} finally {
		await electronApp.close();
	}
});

test("a second shell tab remains usable while hello world is open in the first", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const firstSessionId = await launchExampleFromShell(window, "hello-world.mjs");

		await window.evaluate(() => window.chimera.start());
		const activeShellTab = window.locator(".tab-button-terminal.tab-button-active").first();
		await activeShellTab.waitFor({state: "visible"});
		await window.locator(".terminal-panel:not([hidden]) .terminal-host").click();

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === id && s.transportMode === "htty");
		}, firstSessionId);
	} finally {
		await electronApp.close();
	}
});

test("second shell tab activation restores terminal focus", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		await launchExampleFromShell(window, "hello-world.mjs");

		await window.evaluate(() => window.chimera.start());
		const activeShellTab = window.locator(".tab-button-terminal.tab-button-active").first();
		await activeShellTab.waitFor({state: "visible"});

		await window.waitForFunction(() => {
			const active = document.activeElement;
			return active?.classList?.contains("xterm-helper-textarea") === true;
		});
	} finally {
		await electronApp.close();
	}
});

test("second shell tab remains in terminal mode while hello world stays attached", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const firstSessionId = await launchExampleFromShell(window, "hello-world.mjs");

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === id && s.transportMode === "htty");
		}, firstSessionId);

		await window.evaluate(() => window.chimera.start());
		const activeShellTab = window.locator(".tab-button-terminal.tab-button-active").first();
		await activeShellTab.waitFor({state: "visible"});

		await window.waitForFunction(() => {
			const panel = document.querySelector(".terminal-panel:not([hidden])");
			return panel?.dataset.transportMode === "terminal";
		});

		const transportMode = await window.evaluate(() => {
			return document.querySelector(".terminal-panel:not([hidden])")?.dataset.transportMode ?? null;
		});
		assert.equal(transportMode, "terminal");
	} finally {
		await electronApp.close();
	}
});

test("hello world session stays attached while the second shell stays terminal", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const firstSessionId = await launchExampleFromShell(window, "hello-world.mjs");

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === id && s.transportMode === "htty");
		}, firstSessionId);

		await window.evaluate(() => window.chimera.start());
		const activeShellTab = window.locator(".tab-button-terminal.tab-button-active").first();
		await activeShellTab.waitFor({state: "visible"});

		await window.waitForFunction(async (firstId, shellCmd) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === firstId && s.transportMode === "htty") &&
				sessions.some((s) => s.command === shellCmd && s.transportMode === "terminal");
		}, firstSessionId, shellCommand);
	} finally {
		await electronApp.close();
	}
});

test("hello world surface stacks on the active terminal tab without switching tabs", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const sessionId = await shellSessionId(window);
		const initialTabCount = await window.locator(".tab-button").count();
		await window.evaluate((id) => window.chimera.sendInput(id, "node examples/hello-world.mjs\r"), sessionId);

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === id && s.transportMode === "htty" && s.state?.status === "attached" && s.state?.phase === "ready");
		}, sessionId);
		await window.waitForFunction(() => {
			return document.querySelector(".tab-panel:not([hidden]) .surface-panel:not([hidden]) .surface-browser-host");
		});
		assert.equal(await window.locator(".tab-button").count(), initialTabCount);
	} finally {
		await electronApp.close();
	}
});

test("running hello world inside the shell upgrades the active PTY session into an HTTY surface", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const sessions = await window.evaluate(() => window.chimera.getSessions());
		const firstSessionId = sessions[0]?.id;
		assert.ok(firstSessionId, "expected an initial shell session");

		await window.evaluate((sessionId) => {
			return window.chimera.sendInput(sessionId, "node examples/hello-world.mjs\r");
		}, firstSessionId);

		await window.waitForSelector(".tab-panel:not([hidden]) .surface-panel:not([hidden])", {state: "visible"});
		assert.equal(await window.locator(".tab-button").count(), 1);

		const latestSessions = await window.evaluate(() => window.chimera.getSessions());
		assert.equal(latestSessions.length, 1);
		assert.equal(latestSessions[0].transportMode, "htty");
	} finally {
		await electronApp.close();
	}
});

test("browser demo serves a surface via PTY-based HTTY transport", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const sessionId = await shellSessionId(window);
		await window.evaluate((id) => window.chimera.sendInput(id, "node examples/browser-demo.mjs\r"), sessionId);

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			return sessions.some((s) => s.id === id && s.transportMode === "htty" && s.state?.status === "attached" && s.state?.phase === "ready");
		}, sessionId);
		await window.waitForFunction(() => document.querySelector(".tab-panel:not([hidden]) .surface-panel:not([hidden])"));
		await window.locator(".tab-button-terminal.tab-button-active").first().waitFor({state: "visible"});
	} finally {
		await electronApp.close();
	}
});

test("platformer demo serves a full-canvas game surface", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	
	try {
		await launchExampleFromShell(window, "platformer-demo.mjs");
		await window.waitForFunction(() => document.querySelector(".tab-panel:not([hidden]) .surface-panel:not([hidden])"));
		const surfaceId = await waitForActiveSurfaceId(window);
		const text = await window.evaluate((id) => {
			return window.chimera.evaluateSurface(id, "document.title + ' ' + Boolean(document.querySelector('canvas#game'))");
		}, surfaceId);
		
		assert.equal(text, "HTTY Platformer true");
	} finally {
		await electronApp.close();
	}
});

test("configuration demo serves a light-dark aware configuration UI", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	
	try {
		await launchExampleFromShell(window, "chimera-configuration.mjs");
		await window.waitForFunction(() => document.querySelector(".tab-panel:not([hidden]) .surface-panel:not([hidden])"));
		const surfaceId = await waitForActiveSurfaceId(window);
		const result = await window.evaluate((id) => {
			return window.chimera.evaluateSurface(id, [
				"document.title",
				"Boolean(document.querySelector('form#config-form'))",
				"getComputedStyle(document.documentElement).colorScheme",
			].join(" + '|' + "));
		}, surfaceId);
		
		const [title, hasForm, colorScheme] = result.split("|");
		assert.equal(title, "Chimera Configuration");
		assert.equal(hasForm, "true");
		assert.match(colorScheme, /light|dark/);
	} finally {
		await electronApp.close();
	}
});

test("closing the surface tab returns the shell to terminal mode", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const sessionId = await launchExampleFromShell(window, "hello-world.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);

		await window.evaluate((id) => window.chimera.closeSurface(id), surfaceId);

		await window.waitForFunction(async (id) => {
			const sessions = await window.chimera.getSessions();
			const session = sessions.find((s) => s.id === id);
			return session && session.transportMode === "terminal";
		}, sessionId);
		await window.waitForFunction(() => {
			const active = document.activeElement;
			return active?.classList?.contains("xterm-helper-textarea") === true;
		});
	} finally {
		await electronApp.close();
	}
});

test("closing the only shell tab in a secondary window closes that window", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();

	try {
		const newWindowPromise = electronApp.waitForEvent("window");
		await window.keyboard.press(`${primaryModifier}+N`);
		const otherWindow = await newWindowPromise;
		await otherWindow.waitForLoadState("domcontentloaded");
		await otherWindow.waitForSelector(".terminal-panel", {state: "visible"});

		const otherSessionId = await otherWindow.evaluate(async () => {
			const sessions = await window.chimera.getSessions();
			return sessions[0]?.id ?? null;
		});
		assert.ok(otherSessionId, "expected a shell session in the secondary window");

		const closePromise = otherWindow.waitForEvent("close");
		await otherWindow.evaluate((sessionId) => {
			return window.chimera.closeSession(sessionId);
		}, otherSessionId);
		await closePromise;
		await electronApp.evaluate(({BrowserWindow}) => {
			return BrowserWindow.getAllWindows().length;
		}).then(async (count) => {
			if (count !== 1) {
				throw new Error(`Expected one remaining window, got ${count}`);
			}
		});
		assert.equal(await window.locator(".terminal-panel").isVisible(), true);
	} finally {
		await electronApp.close();
	}
});

