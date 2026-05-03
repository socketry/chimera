import fs from "node:fs";
import path from "node:path";

export class BookmarksController {
	constructor({configuration, logLifecycle = () => {}} = {}) {
		this.configuration = configuration;
		this.logLifecycle = logLifecycle;
	}

	bookmarksDirectory() {
		return this.configuration.bookmarksDirectory();
	}

	titleForFileName(fileName) {
		return path.basename(fileName, path.extname(fileName));
	}

	bookmarks() {
		const directory = this.bookmarksDirectory();
		if (!fs.existsSync(directory)) {
			return [];
		}

		try {
			return fs.readdirSync(directory, {withFileTypes: true})
				.filter((entry) => entry.isFile() && !entry.name.startsWith("."))
				.sort((left, right) => left.name.localeCompare(right.name))
				.map((entry) => {
					return {
						title: this.titleForFileName(entry.name),
						path: path.join(directory, entry.name),
						cwd: directory,
					};
				});
		} catch (error) {
			this.logLifecycle("bookmarks:load-failed", {directory, message: error.message});
			return [];
		}
	}
}
