// End-to-end tests for WebSocket support in HTTY surface views.
//
// Each test is expressed in terms of observable page behaviour (message types,
// lifecycle events, etc.) rather than how the transport achieves it, so the
// suite stays valid across implementation changes.

import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import {fileURLToPath} from "node:url";

import {_electron as electron} from "playwright";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..", "..");

function shellQuote(value) {
	return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function exampleCommand(example) {
	return `node ${shellQuote(path.join(projectRoot, "examples", example))}`;
}

async function launchChimera() {
	const electronApp = await electron.launch({
		args: [projectRoot],
		env: {
			...process.env,
			CHIMERA_E2E: "1",
			CHIMERA_CONFIG_PATH: path.join(__dirname, "config.json"),
		},
	});

	const window = await electronApp.firstWindow();
	await window.waitForLoadState("domcontentloaded");
	await window.bringToFront();

	return {electronApp, window};
}

async function launchExampleFromShell(window, example) {
	// Wait for the initial shell session to appear (it is created asynchronously
	// on startup after the HTTY session negotiates).
	let sessionId = null;
	const deadline = Date.now() + 10000;
	while (!sessionId && Date.now() < deadline) {
		sessionId = await window.evaluate(() =>
			window.chimera.getSessions().then((sessions) => sessions[0]?.id ?? null),
		);
		if (!sessionId) await new Promise((r) => setTimeout(r, 100));
	}
	assert.ok(sessionId, "expected an initial shell session");
	await window.evaluate(({id, cmd}) => window.chimera.sendInput(id, cmd), {id: sessionId, cmd: `${exampleCommand(example)}\r`});
	await window.locator(".tab-panel:not([hidden]) .surface-panel:not([hidden])").first().waitFor({state: "visible"});
	return sessionId;
}

async function waitForActiveSurfaceId(window) {
	await window.waitForSelector(".surface-panel:not([hidden]) .surface-browser-host", {state: "visible"});
	const surfaceId = await window.evaluate(() =>
		document.querySelector(".surface-panel:not([hidden])")?.dataset.surfaceId ?? null,
	);
	assert.ok(surfaceId, "active surface should expose a surface ID");
	return surfaceId;
}

async function evaluateSurface(electronApp, surfaceId, script) {
	return electronApp.evaluate((_electron, {surfaceId, script}) => {
		return globalThis.chimeraE2E.evaluateSurface(surfaceId, script);
	}, {surfaceId, script});
}

async function pollSurface(electronApp, surfaceId, script, predicate, {timeout = 5000} = {}) {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		const value = await evaluateSurface(electronApp, surfaceId, script);
		if (predicate(value)) return value;
		await new Promise((resolve) => setTimeout(resolve, 100));
	}
	throw new Error(`Timed out waiting for surface condition: ${script}`);
}

// Wait for the page's self-test suite to finish and return the results object.
async function waitForPageTests(electronApp, surfaceId, {timeout = 45000} = {}) {
	// Wait for the demo page to load (title is set synchronously in the HTML head).
	await pollSurface(electronApp, surfaceId, "document.title", (t) => t === "WebSocket Demo", {timeout: 15000});

	// The module script runs after HTML parsing completes — poll until it has
	// initialised window.__wsResults rather than checking immediately.
	await pollSurface(electronApp, surfaceId,
		"typeof window.__wsResults !== 'undefined'", Boolean, {timeout: 10000})
		.catch(async () => {
			const partial = await evaluateSurface(electronApp, surfaceId, "window.__wsResults");
			throw new Error(
				"window.__wsResults never appeared within 10s. Partial: " + JSON.stringify(partial),
			);
		});

	try {
		await pollSurface(electronApp, surfaceId, "window.__wsResults?.done", Boolean, {timeout});
	} catch {
		// Timed out — read back whatever partial results exist so test failures
		// show the actual per-step reason rather than just "timed out".
		const partial = await evaluateSurface(electronApp, surfaceId, "window.__wsResults");
		throw new Error(
			"window.__wsResults.done never became true within " + timeout + "ms. " +
			"Partial results: " + JSON.stringify(partial),
		);
	}
	return evaluateSurface(electronApp, surfaceId, "window.__wsResults");
}

// Assert that a named case from the page's own test suite passed.
function assertPageTestPassed(results, name) {
	assert.ok(
		results,
		"page test results object should be present",
	);
	if (results.uncaughtError) {
		throw new Error(`Page test suite threw: ${results.uncaughtError}`);
	}
	const failure = results.failed?.find((f) => f.name === name);
	if (failure) {
		throw new assert.AssertionError({
			message: `Page test "${name}" failed: ${failure.reason}`,
			actual: "failed",
			expected: "passed",
		});
	}
	assert.ok(
		results.passed?.includes(name),
		`Page test "${name}" did not appear in passed list. Passed: ${JSON.stringify(results.passed)}`,
	);
}

// ─── Setup ────────────────────────────────────────────────────────────────────
//
// Each test gets its own Electron instance so sessions don't interfere.
// The page's self-test suite runs automatically on load.

// ─── Native WebSocket ─────────────────────────────────────────────────────────

test("surface pages use the native WebSocket constructor", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);

		// No polyfill — the native constructor is used directly.
		const wsName = await evaluateSurface(electronApp, surfaceId, "window.WebSocket.name");
		assert.equal(wsName, "WebSocket");
	} finally {
		await electronApp.close();
	}
});

// ─── Message type correctness ─────────────────────────────────────────────────

test("text WebSocket messages arrive as JS strings", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "text message is a string");
	} finally {
		await electronApp.close();
	}
});

test("JSON WebSocket messages can be parsed with JSON.parse", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "JSON round-trip");
	} finally {
		await electronApp.close();
	}
});

test("binary WebSocket messages arrive as ArrayBuffer when binaryType is arraybuffer", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "binary arrives as ArrayBuffer");
	} finally {
		await electronApp.close();
	}
});

test("binary WebSocket messages arrive as Blob when binaryType is blob", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "binary arrives as Blob");
	} finally {
		await electronApp.close();
	}
});

// ─── Connection lifecycle ─────────────────────────────────────────────────────

test("server-initiated WebSocket close delivers CloseEvent with code 1000", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "server close delivers code 1000");
	} finally {
		await electronApp.close();
	}
});

test("WebSocket readyState transitions correctly through the connection lifecycle", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "readyState is OPEN after open event");
		assertPageTestPassed(results, "readyState is CLOSED after close");
	} finally {
		await electronApp.close();
	}
});

// ─── Concurrency and message size ─────────────────────────────────────────────

test("multiple simultaneous WebSocket connections are independent", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId);
		assertPageTestPassed(results, "simultaneous connections are independent");
	} finally {
		await electronApp.close();
	}
});

test("text messages are delivered without truncation", {concurrency: false}, async () => {
	const {electronApp, window} = await launchChimera();
	try {
		await launchExampleFromShell(window, "websocket-demo.mjs");
		const surfaceId = await waitForActiveSurfaceId(window);
		const results = await waitForPageTests(electronApp, surfaceId, {timeout: 30000});
		assertPageTestPassed(results, "text message round-trips without truncation");
	} finally {
		await electronApp.close();
	}
});
