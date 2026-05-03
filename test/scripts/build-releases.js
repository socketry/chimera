import assert from "node:assert/strict";
import test from "node:test";

import {renderReleasesHtml} from "../../scripts/build-releases.mjs";

test("renders releases as a complete html document", () => {
	const html = renderReleasesHtml("# Releases\n\n- <safe>\n");
	
	assert.match(html, /<!DOCTYPE html>/);
	assert.match(html, /<h1>Releases<\/h1>/);
	assert.match(html, /&lt;safe&gt;/);
});

test("renders common markdown features in releases", () => {
	const html = renderReleasesHtml("## v0.2.1\n\n- Use `HOME` for shells.\n- https://example.com\n");
	
	assert.match(html, /<h2>v0\.2\.1<\/h2>/);
	assert.match(html, /<code>HOME<\/code>/);
	assert.match(html, /<a href="https:\/\/example\.com">https:\/\/example\.com<\/a>/);
});

test("does not render raw html from releases", () => {
	const html = renderReleasesHtml("<script>alert('nope')</script>");
	
	assert.match(html, /&lt;script&gt;alert/);
	assert.doesNotMatch(html, /<script>/);
});
