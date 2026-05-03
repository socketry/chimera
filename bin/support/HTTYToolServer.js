import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const CONTENT_TYPES = new Map([
	[".css", "text/css; charset=utf-8"],
	[".html", "text/html; charset=utf-8"],
	[".js", "text/javascript; charset=utf-8"],
	[".json", "application/json; charset=utf-8"],
	[".mjs", "text/javascript; charset=utf-8"],
]);

export function dirnameFromMeta(metaUrl) {
	return path.dirname(fileURLToPath(metaUrl));
}

export function htmlResponse(body, status = 200) {
	return response(body, "text/html; charset=utf-8", status);
}

export function jsonResponse(body, status = 200) {
	return response(JSON.stringify(body), "application/json; charset=utf-8", status);
}

export function notFoundResponse() {
	return response("Not found", "text/plain; charset=utf-8", 404);
}

export function response(body, contentType, status = 200) {
	return {
		status,
		headers: {"content-type": contentType},
		body,
	};
}

export function renderTemplateFile(templatePath, values) {
	return renderTemplate(fs.readFileSync(templatePath, "utf8"), values);
}

export function renderTemplate(template, values) {
	return template
		.replaceAll(/{{{\s*([\w.-]+)\s*}}}/g, (_, key) => String(values[key] ?? ""))
		.replaceAll(/{{\s*([\w.-]+)\s*}}/g, (_, key) => htmlEscape(values[key]));
}

export function htmlEscape(value) {
	return String(value ?? "")
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function scriptJson(value) {
	return JSON.stringify(value).replaceAll("</", "<\\/");
}

export function staticFileResponse(requestPath, mount, directory) {
	if (!requestPath.startsWith(mount)) {
		return null;
	}

	const relativePath = requestPath.slice(mount.length);
	const filePath = safeJoin(directory, relativePath);
	if (!filePath || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
		return notFoundResponse();
	}

	return response(fs.readFileSync(filePath), contentTypeForPath(filePath));
}

export function nodeModulesResponse(requestPath, projectRoot) {
	return staticFileResponse(requestPath, "/node_modules/", path.join(projectRoot, "node_modules"));
}

export function litImportMap() {
	return {
		imports: {
			"@lit/reactive-element": "/node_modules/@lit/reactive-element/reactive-element.js",
			"@lit/reactive-element/": "/node_modules/@lit/reactive-element/",
			lit: "/node_modules/lit/index.js",
			"lit/": "/node_modules/lit/",
			"lit-element": "/node_modules/lit-element/index.js",
			"lit-element/": "/node_modules/lit-element/",
			"lit-html": "/node_modules/lit-html/lit-html.js",
			"lit-html/": "/node_modules/lit-html/",
		},
	};
}

function safeJoin(root, relativePath) {
	const decodedPath = decodeURIComponent(relativePath);
	const filePath = path.resolve(root, decodedPath);
	const rootPath = path.resolve(root);
	return filePath === rootPath || filePath.startsWith(`${rootPath}${path.sep}`) ? filePath : null;
}

function contentTypeForPath(filePath) {
	return CONTENT_TYPES.get(path.extname(filePath)) ?? "application/octet-stream";
}
