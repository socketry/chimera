function escapeHtml(value) {
	return String(value)
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;");
}

export function browserDocumentForResponse(response) {
	const contentType = response.headers["content-type"] || "text/plain";
	const [mimeType] = contentType.split(";");

	if (mimeType.trim() === "text/html") {
		return {
			mode: "html",
			contentType,
			displayContentType: contentType,
			body: response.body,
		};
	}

	return {
		mode: "text",
		contentType: "text/html; charset=utf-8",
		displayContentType: contentType,
		body: `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>HTTY Response</title>
		<style>
			:root {
				color-scheme: dark;
				font-family: "Avenir Next", "Helvetica Neue", sans-serif;
			}

			body {
				margin: 0;
				padding: 24px;
				background: #0b1220;
				color: #ecf3ff;
			}

			header {
				margin-bottom: 16px;
				color: #9fb0c8;
				font-size: 14px;
			}

			pre {
				padding: 18px;
				border-radius: 16px;
				background: #09111f;
				border: 1px solid rgba(148, 163, 184, 0.16);
				font-family: "IBM Plex Mono", "SFMono-Regular", monospace;
				white-space: pre-wrap;
				word-break: break-word;
			}
		</style>
	</head>
	<body>
		<header>${escapeHtml(contentType)}</header>
		<pre>${escapeHtml(response.body)}</pre>
	</body>
</html>`,
	};
}