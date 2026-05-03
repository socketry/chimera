import assert from "node:assert/strict";
import test from "node:test";

import {prepareReleases, releaseHeading} from "../../scripts/prepare-version-releases.mjs";

test("formats release headings with a v prefix", () => {
	assert.equal(releaseHeading("0.2.2"), "## v0.2.2");
	assert.equal(releaseHeading("v0.2.2"), "## v0.2.2");
});

test("rewrites the unreleased heading to the release version", () => {
	const markdown = [
		"# Releases",
		"",
		"## Unreleased",
		"",
		"  - Fix updates.",
	].join("\n");

	assert.equal(prepareReleases(markdown, "0.2.2"), [
		"# Releases",
		"",
		"## v0.2.2",
		"",
		"  - Fix updates.",
	].join("\n"));
});

test("accepts releases that were already prepared for the same version", () => {
	const markdown = [
		"# Releases",
		"",
		"## v0.2.2",
		"",
		"  - Fix updates.",
	].join("\n");

	assert.equal(prepareReleases(markdown, "0.2.2"), markdown);
});

test("rejects releases without an unreleased or matching version heading", () => {
	assert.throws(() => prepareReleases("# Releases\n\n## v0.2.1\n", "0.2.2"), /Could not find/);
});
