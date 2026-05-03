import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";
import MarkdownIt from "markdown-it";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const sourcePath = path.join(projectRoot, "releases.md");
const outputPath = path.join(projectRoot, "help", "releases.html");

const markdownRenderer = new MarkdownIt({
	html: false,
	linkify: true,
	typographer: false,
});

export function renderReleasesHtml(markdown) {
	const body = markdownRenderer.render(String(markdown ?? "")).trim();
	return `<!DOCTYPE html>
<html lang="en">
	<head>
		<meta charset="utf-8">
		<meta name="viewport" content="width=device-width, initial-scale=1.0">
		<title>Releases</title>
		<style>
			:root {
				color-scheme: light dark;
				--bg: #050914;
				--text: #ecf3ff;
				--muted: #9fb0c8;
				--accent: #f6d365;
				--control-bg: rgba(8, 14, 24, 0.9);
				--control-border: rgba(148, 163, 184, 0.16);
				font-family: "SF Pro Text", "Helvetica Neue", sans-serif;
			}

			@media (prefers-color-scheme: light) {
				:root {
					--bg: #f8fafc;
					--text: #0f172a;
					--muted: #64748b;
					--accent: #0369a1;
					--control-bg: rgba(255, 255, 255, 0.92);
					--control-border: rgba(15, 23, 42, 0.12);
				}
			}

			* {
				box-sizing: border-box;
			}

			html,
			body {
				margin: 0;
				min-height: 100%;
				background: var(--bg);
				color: var(--text);
			}

			main {
				width: min(760px, calc(100% - 48px));
				margin: 0 auto;
				padding: 40px 0 56px;
				font-size: 15px;
				line-height: 1.65;
			}

			h1,
			h2,
			h3 {
				margin: 0;
				line-height: 1.2;
				font-weight: 680;
			}

			h1 {
				font-size: 28px;
				margin-bottom: 28px;
			}

			h2 {
				font-size: 20px;
				margin-top: 28px;
				margin-bottom: 10px;
				color: var(--accent);
			}

			h3 {
				font-size: 16px;
				margin-top: 22px;
				margin-bottom: 8px;
			}

			p,
			ul,
			pre {
				margin: 0 0 16px;
			}

			ul {
				padding-left: 22px;
			}

			li {
				margin: 4px 0;
			}

			a {
				color: var(--accent);
			}

			pre {
				overflow: auto;
				padding: 12px;
				border-radius: 6px;
				background: var(--control-bg);
				border: 1px solid var(--control-border);
			}

			code {
				font-family: "SFMono-Regular", Consolas, monospace;
				font-size: 13px;
			}

			@media (max-width: 760px) {
				main {
					width: calc(100% - 32px);
					padding: 28px 0 40px;
				}
			}
		</style>
	</head>
	<body>
		<main>
${indentHtml(body, 3)}
		</main>
	</body>
</html>
`;
}

function indentHtml(html, tabCount) {
	const prefix = "\t".repeat(tabCount);
	return html.split("\n").map((line) => `${prefix}${line}`).join("\n");
}

if (process.argv[1] === __filename) {
	const markdown = await fs.readFile(sourcePath, "utf8");
	await fs.writeFile(outputPath, renderReleasesHtml(markdown));
}
