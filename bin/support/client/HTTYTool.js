export function initialData() {
	const node = document.getElementById("initial-data");
	return JSON.parse(node?.textContent || "{}");
}

export async function postJson(path, body) {
	const response = await fetch(path, {
		method: "POST",
		headers: {"content-type": "application/json"},
		body: JSON.stringify(body),
	});
	const payload = await response.json();
	if (!response.ok) {
		throw new Error(payload.error || "Request failed.");
	}
	return payload;
}

export async function refreshChimeraBookmarks() {
	const response = await fetch("/.well-known/chimera/bookmarks/refresh", {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error("Could not refresh Chimera bookmarks.");
	}
}

export async function refreshChimeraConfiguration() {
	const response = await fetch("/.well-known/chimera/configuration/refresh", {
		method: "POST",
	});
	if (!response.ok) {
		throw new Error("Could not refresh Chimera configuration.");
	}
}
