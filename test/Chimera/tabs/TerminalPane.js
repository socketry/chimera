import assert from "node:assert/strict";
import test from "node:test";
import {HTTY_BOOTSTRAP_IDENTIFIER} from "@socketry/htty";

import {decodeHttyBootstrap, installHttyBootstrapHandler} from "../../../Chimera/tabs/TerminalPane.js";

test("decodes raw HTTY bootstrap requests", () => {
	assert.deepEqual(decodeHttyBootstrap("raw"), {mode: "raw"});
	assert.deepEqual(decodeHttyBootstrap(" RAW "), {mode: "raw"});
	assert.equal(decodeHttyBootstrap("framed"), null);
	assert.equal(decodeHttyBootstrap(null), null);
});

test("registers an xterm DCS handler for the HTTY bootstrap", () => {
	let registeredIdentifier = null;
	let registeredCallback = null;
	const bootstraps = [];

	const disposable = installHttyBootstrapHandler({
		parser: {
			registerDcsHandler(identifier, callback) {
				registeredIdentifier = identifier;
				registeredCallback = callback;
				return {
					dispose() {
						registeredCallback = null;
					},
				};
			},
		},
	}, (bootstrap) => {
		bootstraps.push(bootstrap);
	});

	assert.deepEqual(registeredIdentifier, HTTY_BOOTSTRAP_IDENTIFIER);
	assert.equal(registeredCallback("raw", []), true);
	assert.deepEqual(bootstraps, [{mode: "raw"}]);
	assert.equal(registeredCallback("framed", []), false);

	disposable.dispose();
	assert.equal(registeredCallback, null);
});
