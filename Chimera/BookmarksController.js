import fs from "node:fs";
import path from "node:path";

export class BookmarksController {
	constructor({configuration, trace = () => {}} = {}) {
		this.configuration = configuration;
		this.trace = trace;
	}

	bookmarksPath() {
		return this.configuration.bookmarksPath();
	}

	configurationDirectory() {
		return this.configuration.configurationDirectory();
	}

	bookmarks() {
		const bookmarksPath = this.bookmarksPath();
		if (!fs.existsSync(bookmarksPath)) {
			return [];
		}

		try {
			const bookmarks = JSON.parse(fs.readFileSync(bookmarksPath, "utf8"));
			return this.normalizeItems(bookmarks);
		} catch (error) {
			this.trace("bookmarks:load-failed", {path: bookmarksPath, message: error.message});
			return [];
		}
	}

	normalizeItems(items) {
		if (!Array.isArray(items)) {
			throw new TypeError("bookmarks.json must contain an array.");
		}

		return items.map((item, index) => this.normalizeItem(item, index)).filter(Boolean);
	}

	normalizeItem(item, index) {
		if (!item || typeof item !== "object" || Array.isArray(item)) {
			throw new TypeError(`Bookmark at index ${index} must be an object.`);
		}

		if (item.type === "separator") {
			return {type: "separator"};
		}

		if (Array.isArray(item.items)) {
			return {
				type: "group",
				title: this.requireTitle(item, index),
				items: this.normalizeItems(item.items),
			};
		}

		return {
			type: "command",
			title: this.requireTitle(item, index),
			command: this.requireCommand(item, index),
			args: this.normalizeArgs(item.args, index),
			cwd: this.normalizeCwd(item.cwd),
		};
	}

	requireTitle(item, index) {
		const title = String(item.title ?? "").trim();
		if (!title) {
			throw new TypeError(`Bookmark at index ${index} requires a title.`);
		}

		return title;
	}

	requireCommand(item, index) {
		const command = String(item.command ?? "").trim();
		if (!command) {
			throw new TypeError(`Bookmark at index ${index} requires a command.`);
		}

		return command;
	}

	normalizeArgs(args, index) {
		if (args === undefined) {
			return [];
		}

		if (!Array.isArray(args)) {
			throw new TypeError(`Bookmark at index ${index} args must be an array.`);
		}

		return args.map((argument) => String(argument));
	}

	normalizeCwd(cwd) {
		if (!cwd) {
			return undefined;
		}

		const value = String(cwd);
		return path.isAbsolute(value) ? value : path.resolve(this.configurationDirectory(), value);
	}
}
