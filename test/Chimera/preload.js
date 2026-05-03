import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const preloadPath = path.resolve(__dirname, "..", "..", "Chimera", "preload.cjs");
const preloadSource = fs.readFileSync(preloadPath, "utf8");

function loadPreload(environment = {}) {
	let exposed = null;
	const ipcInvocations = [];
	const context = {
		process: {
			env: environment,
		},
		require(name) {
			assert.equal(name, "electron");
			return {
				clipboard: {
					readText: () => "",
					writeText() {},
				},
				contextBridge: {
					exposeInMainWorld(name, value) {
						assert.equal(name, "chimera");
						exposed = value;
					},
				},
				ipcRenderer: {
					invoke(channel, ...args) {
						ipcInvocations.push({channel, args});
					},
					on() {},
					send() {},
				},
			};
		},
	};
	
	vm.runInNewContext(preloadSource, context, {filename: preloadPath});
	return {chimera: exposed, ipcInvocations};
}

test("does not expose surface evaluation outside e2e mode", () => {
	const {chimera} = loadPreload();
	
	assert.equal(typeof chimera.getSessions, "function");
	assert.equal(chimera.evaluateSurface, undefined);
});

test("does not expose surface evaluation in e2e mode", () => {
	const {chimera} = loadPreload({CHIMERA_E2E: "1"});
	
	assert.equal(typeof chimera.getSessions, "function");
	assert.equal(chimera.evaluateSurface, undefined);
});
