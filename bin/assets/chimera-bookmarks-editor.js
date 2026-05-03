import {html, render} from "lit";

import {initialData, postJson, refreshChimeraBookmarks} from "/support/client/HTTYTool.js";

const data = initialData();
const app = document.getElementById("app");
const example = data.exampleBookmarks;

let rawJson = data.bookmarksText || "[]\n";
let bookmarks = parseBookmarks(rawJson) ?? [];
let notice = null;

function parseBookmarks(text) {
	try {
		const parsed = JSON.parse(text || "[]");
		return Array.isArray(parsed) ? parsed : null;
	} catch {
		return null;
	}
}

function commandBookmark(title = "New Bookmark") {
	return {title, command: defaultShell(), args: []};
}

function defaultShell() {
	return "/bin/zsh";
}

function groupBookmark(title = "New Group") {
	return {title, items: []};
}

function separatorBookmark() {
	return {type: "separator"};
}

function bookmarkType(bookmark) {
	if (bookmark.type === "separator") return "separator";
	if (Array.isArray(bookmark.items)) return "group";
	return "command";
}

function cleanBookmark(bookmark) {
	const type = bookmarkType(bookmark);
	if (type === "separator") return {type: "separator"};
	if (type === "group") {
		return {
			title: String(bookmark.title || ""),
			items: (bookmark.items || []).map(cleanBookmark),
		};
	}

	const result = {
		title: String(bookmark.title || ""),
		command: String(bookmark.command || ""),
		args: Array.isArray(bookmark.args) ? bookmark.args.map(String) : [],
	};

	if (bookmark.cwd) {
		result.cwd = String(bookmark.cwd);
	}

	return result;
}

function syncJson() {
	rawJson = `${JSON.stringify(bookmarks.map(cleanBookmark), null, "\t")}\n`;
}

function setNotice(kind, text) {
	notice = {kind, text};
	renderApp();
}

function setRawJson(value) {
	rawJson = value;
	const parsed = parseBookmarks(value);
	if (parsed) {
		bookmarks = parsed;
		renderApp();
	}
}

function addBookmark(type, items = bookmarks) {
	items.push(type === "separator" ? separatorBookmark() : type === "group" ? groupBookmark() : commandBookmark());
	syncJson();
	renderApp();
}

function updateBookmark(bookmark, patch) {
	Object.assign(bookmark, patch);
	syncJson();
	renderApp();
}

function changeBookmarkType(items, index, type) {
	const title = items[index].title || "";
	items[index] = type === "separator" ? separatorBookmark() : type === "group" ? groupBookmark(title || "New Group") : commandBookmark(title || "New Bookmark");
	syncJson();
	renderApp();
}

function moveBookmark(items, index, offset) {
	const target = index + offset;
	if (target < 0 || target >= items.length) return;
	items.splice(target, 0, items.splice(index, 1)[0]);
	syncJson();
	renderApp();
}

function deleteBookmark(items, index) {
	items.splice(index, 1);
	syncJson();
	renderApp();
}

async function saveBookmarks(event) {
	event.preventDefault();
	if (!event.currentTarget.reportValidity()) return;

	syncJson();
	try {
		await postJson("/save", {bookmarks: rawJson});
		await refreshChimeraBookmarks();
		setNotice("success", "Bookmarks saved.");
	} catch (error) {
		setNotice("error", error.message || "Could not save bookmarks.");
	}
}

function argsInput(bookmark) {
	return html`
		<label>
			Args JSON
			<input
				.value=${JSON.stringify(bookmark.args || [])}
				@input=${(event) => updateArgs(bookmark, event.currentTarget)}
			>
		</label>
	`;
}

function updateArgs(bookmark, input) {
	try {
		const parsed = JSON.parse(input.value || "[]");
		if (!Array.isArray(parsed)) throw new TypeError();
		bookmark.args = parsed.map(String);
		input.setCustomValidity("");
		syncJson();
	} catch {
		input.setCustomValidity("Args must be a JSON array.");
	}
}

function bookmarkFields(bookmark) {
	const type = bookmarkType(bookmark);
	if (type === "command") {
		return html`
			<div class="field-grid">
				<label>
					Command
					<input .value=${bookmark.command || ""} @input=${(event) => updateBookmark(bookmark, {command: event.currentTarget.value})}>
				</label>
				${argsInput(bookmark)}
				<label>
					Working Directory
					<input .value=${bookmark.cwd || ""} @input=${(event) => updateCwd(bookmark, event.currentTarget.value)}>
				</label>
			</div>
		`;
	}

	if (type === "group") {
		bookmark.items ||= [];
		return html`
			<div class="bookmark-list">
				${bookmark.items.length === 0 ? emptyState() : bookmark.items.map((item, index) => bookmarkCard(bookmark.items, item, index, 1))}
			</div>
			<div class="item-actions">
				<button type="button" @click=${() => addBookmark("command", bookmark.items)}>Add Command</button>
				<button type="button" @click=${() => addBookmark("separator", bookmark.items)}>Add Separator</button>
				<button type="button" @click=${() => addBookmark("group", bookmark.items)}>Add Group</button>
			</div>
		`;
	}

	return html`<div class="separator-preview">Menu separator</div>`;
}

function updateCwd(bookmark, value) {
	if (value) {
		bookmark.cwd = value;
	} else {
		delete bookmark.cwd;
	}
	syncJson();
	renderApp();
}

function bookmarkCard(items, bookmark, index, depth) {
	const type = bookmarkType(bookmark);
	return html`
		<section class="bookmark-card" data-depth=${Math.min(depth, 1)}>
			<div class="bookmark-heading">
				<label>
					Title
					<input
						.value=${bookmark.title || ""}
						?disabled=${type === "separator"}
						@input=${(event) => updateBookmark(bookmark, {title: event.currentTarget.value})}
					>
				</label>
				<label>
					Type
					<select .value=${type} @change=${(event) => changeBookmarkType(items, index, event.currentTarget.value)}>
						<option value="command">command</option>
						<option value="group">group</option>
						<option value="separator">separator</option>
					</select>
				</label>
			</div>
			${bookmarkFields(bookmark)}
			<div class="item-actions">
				<button type="button" ?disabled=${index === 0} @click=${() => moveBookmark(items, index, -1)}>Up</button>
				<button type="button" ?disabled=${index === items.length - 1} @click=${() => moveBookmark(items, index, 1)}>Down</button>
				<button type="button" @click=${() => deleteBookmark(items, index)}>Delete</button>
			</div>
		</section>
	`;
}

function emptyState() {
	return html`<div class="empty">No bookmarks.</div>`;
}

function renderApp() {
	render(html`
		<header>
			<h1>Bookmarks</h1>
			<p>Edit <code>${data.bookmarksPath}</code>. Use Bookmarks &gt; Refresh after saving.</p>
		</header>
		${notice ? html`<section class="notice" data-kind=${notice.kind}>${notice.text}</section>` : ""}
		<form id="bookmarks-form" @submit=${saveBookmarks}>
			<div class="toolbar">
				<button type="button" @click=${() => addBookmark("command")}>Add Command</button>
				<button type="button" @click=${() => addBookmark("group")}>Add Group</button>
				<button type="button" @click=${() => addBookmark("separator")}>Add Separator</button>
				<button type="button" @click=${insertExample}>Insert Example</button>
			</div>
			<div class="bookmark-list">
				${bookmarks.length === 0 ? emptyState() : bookmarks.map((bookmark, index) => bookmarkCard(bookmarks, bookmark, index, 0))}
			</div>
			<details>
				<summary>JSON</summary>
				<textarea spellcheck="false" .value=${rawJson} @input=${(event) => setRawJson(event.currentTarget.value)}></textarea>
			</details>
			<div class="actions">
				<button type="submit">Save</button>
			</div>
		</form>
	`, app);
}

function insertExample() {
	bookmarks = structuredClone(example);
	syncJson();
	renderApp();
}

renderApp();
