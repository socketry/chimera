import assert from "node:assert/strict";
import test from "node:test";

import {RendererCommandDispatcher} from "../../Chimera/RendererCommandDispatcher.js";

function withMockIpcMain(callback) {
	const handlers = new Map();
	const listeners = new Map();
	return callback({
		handlers,
		listeners,
		ipcMain: {
			handle(channel, handler) {
				handlers.set(channel, handler);
			},
			on(channel, listener) {
				listeners.set(channel, listener);
			},
		},
	});
}

test("does not register surface evaluation", () => {
	withMockIpcMain(({handlers, ipcMain}) => {
		const dispatcher = new RendererCommandDispatcher({
			environment: {},
			configuration: {terminalOptions: () => ({})},
			controllerForSender: () => null,
			createWindow: async () => ({id: 1}),
			moveSessionToNewWindow: () => null,
			trace() {},
		}, {ipcMain});
		
		dispatcher.register();
		
		assert.equal(handlers.has("chimera:evaluate-surface"), false);
	});
});

test("does not register surface evaluation in e2e mode", () => {
	withMockIpcMain(({handlers, ipcMain}) => {
		const dispatcher = new RendererCommandDispatcher({
			environment: {CHIMERA_E2E: "1"},
			configuration: {terminalOptions: () => ({})},
			controllerForSender: () => null,
			createWindow: async () => ({id: 1}),
			moveSessionToNewWindow: () => null,
			trace() {},
		}, {ipcMain});
		
		dispatcher.register();
		
		assert.equal(handlers.has("chimera:evaluate-surface"), false);
	});
});
