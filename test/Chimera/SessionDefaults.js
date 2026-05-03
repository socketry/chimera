import assert from "node:assert/strict";
import os from "node:os";
import test from "node:test";

import {resolveSessionCwd} from "../../Chimera/SessionDefaults.js";

test("defaults shell sessions to the user's home directory", () => {
	assert.equal(resolveSessionCwd(), os.homedir() || process.cwd());
});

test("preserves an explicit shell session working directory", () => {
	assert.equal(resolveSessionCwd("/tmp"), "/tmp");
});
