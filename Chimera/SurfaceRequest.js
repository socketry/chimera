export async function handleRequest(client, {path, request}) {
	const method = (request.method || "GET").toUpperCase();
	const headers = Object.fromEntries(request.headers.entries());
	const body = method === "GET" || method === "HEAD" ? undefined : await request.text();
	return client.request({
		path,
		method,
		headers,
		body,
	});
}
