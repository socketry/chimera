import assert from "node:assert/strict";
import test from "node:test";

import {
	CHIMERA_BOOKMARKS_REFRESH_PATH,
	WellKnownController,
} from "../../Chimera/WellKnownController.js";

test("ignores routes outside the Chimera well-known namespace", () => {
	const controller = new WellKnownController({
		wellKnownControllerDidRequestBookmarksRefresh() {
			throw new Error("should not refresh bookmarks");
		},
	});

	assert.equal(controller.handleRequest({request: new Request("https://chimera.local/", {method: "POST"}), path: "/"}), null);
});

test("refreshes bookmarks with the Chimera bookmarks well-known route", () => {
	let refreshes = 0;
	const controller = new WellKnownController({
		wellKnownControllerDidRequestBookmarksRefresh() {
			refreshes += 1;
		},
	});
	const response = controller.handleRequest({
		request: new Request("https://chimera.local/.well-known/chimera/bookmarks/refresh", {method: "POST"}),
		path: CHIMERA_BOOKMARKS_REFRESH_PATH,
	});

	assert.equal(response.status, 204);
	assert.equal(refreshes, 1);
});

test("rejects non-POST bookmark refresh requests", async () => {
	let refreshes = 0;
	const controller = new WellKnownController({
		wellKnownControllerDidRequestBookmarksRefresh() {
			refreshes += 1;
		},
	});
	const response = controller.handleRequest({
		request: new Request("https://chimera.local/.well-known/chimera/bookmarks/refresh", {method: "GET"}),
		path: CHIMERA_BOOKMARKS_REFRESH_PATH,
	});

	assert.equal(response.status, 405);
	assert.equal(response.headers.get("allow"), "POST");
	assert.equal(await response.text(), "Method Not Allowed");
	assert.equal(refreshes, 0);
});
