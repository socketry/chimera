export async function handleRequest(client, {path, request}) {
	const method = (request.method || "GET").toUpperCase();
	const headers = Object.fromEntries(request.headers.entries());
	const hasRequestBody = method !== "GET" && method !== "HEAD";
	const requestOptions = {
		path,
		method,
		headers,
	};

	return client.request({
		...requestOptions,
		body: hasRequestBody ? request.body : undefined,
	});
}
