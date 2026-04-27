import path from "node:path";
import {fileURLToPath} from "node:url";

import {sanitizeTitle, shellTitleForCommand} from "./TitleUtils.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");

export function logLifecycle(event, details = {}) {
	const timestamp = new Date().toISOString();
	console.error(`[chimera ${timestamp}] ${event}`, details);
}

export function normalizeRequestPath(value = "/") {
	const text = String(value ?? "").trim();

	if (!text) {
		return "/";
	}

	if (text.startsWith("http://") || text.startsWith("https://")) {
		try {
			const url = new URL(text);
			return `${url.pathname || "/"}${url.search}`;
		} catch {
			return "/";
		}
	}

	if (text.startsWith("/")) {
		return text;
	}

	return `/${text}`;
}

export function toSurfaceURL(sessionId, requestPath = "/") {
	return `htty://${sessionId}${normalizeRequestPath(requestPath)}`;
}

export function parseSurfaceURL(urlString) {
	const url = new URL(urlString);
	return {
		sessionId: url.host,
		requestPath: normalizeRequestPath(`${url.pathname || "/"}${url.search}`),
	};
}

export function describeCommand(command, args = []) {
	return [command, ...args].join(" ");
}

export function inferTitle(command, args = []) {
	const description = describeCommand(command, args);

	if (description === (process.env.SHELL || "/bin/zsh")) {
		return shellTitleForCommand(command, args);
	}

	return args.length > 0 ? shellTitleForCommand(command, args) : sanitizeTitle(path.basename(command), "Shell");
}

export function sanitizeWindowTitle(title, fallback) {
	return sanitizeTitle(title, fallback);
}

export function roundBounds(bounds) {
	return {
		x: Math.round(bounds.x),
		y: Math.round(bounds.y),
		width: Math.max(1, Math.round(bounds.width)),
		height: Math.max(1, Math.round(bounds.height)),
	};
}
