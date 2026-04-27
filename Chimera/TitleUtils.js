const MAX_TITLE_LENGTH = 80;

export function sanitizeTitle(value, fallback = "Untitled") {
	const text = String(value ?? "")
		.replace(/[\u0000-\u001f\u007f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

	if (!text) {
		return fallback;
	}

	if (text.length <= MAX_TITLE_LENGTH) {
		return text;
	}

	return `${text.slice(0, MAX_TITLE_LENGTH - 3).trimEnd()}...`;
}

export function shellTitleForCommand(command, args = []) {
	if (args.length > 0) {
		return sanitizeTitle([command, ...args].join(" "), sanitizeTitle(command, "Shell"));
	}

	const basename = String(command ?? "")
		.split(/[\\/]/)
		.pop();

	return sanitizeTitle(basename || command, "Shell");
}