import fs from "node:fs/promises";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, "..");
const releaseNotesPath = path.join(projectRoot, "releases.md");
const packagePath = path.join(projectRoot, "package.json");

export function releaseHeading(version) {
	const normalizedVersion = String(version ?? "").trim().replace(/^v/, "");

	if (!normalizedVersion) {
		throw new Error("A release version is required.");
	}

	return `## v${normalizedVersion}`;
}

export function prepareReleaseNotes(markdown, version) {
	const heading = releaseHeading(version);

	if (/^##[ \t]+Unreleased[ \t]*$/m.test(markdown)) {
		return markdown.replace(/^##[ \t]+Unreleased[ \t]*$/m, heading);
	}

	if (markdown.includes(heading)) {
		return markdown;
	}

	throw new Error(`Could not find "## Unreleased" in releases.md.`);
}

async function packageVersion() {
	if (process.env.npm_package_version) {
		return process.env.npm_package_version;
	}

	const packageJson = JSON.parse(await fs.readFile(packagePath, "utf8"));
	return packageJson.version;
}

if (process.argv[1] === __filename) {
	const version = await packageVersion();
	const markdown = await fs.readFile(releaseNotesPath, "utf8");
	await fs.writeFile(releaseNotesPath, prepareReleaseNotes(markdown, version));
}
