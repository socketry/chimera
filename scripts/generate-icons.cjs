#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const {execFileSync} = require("node:child_process");
const {appBuilderPath} = require("app-builder-bin");
const {generateAssetCatalogForIcon} = require("app-builder-lib/out/util/macosIconComposer");

const root = path.resolve(__dirname, "..");
const buildDir = path.join(root, "build");
const applicationIcon = path.join(buildDir, "application.icon");
const applicationIconImage = path.join(applicationIcon, "Assets", "icon.png");
const linuxIconsDir = path.join(buildDir, "icons");

const sizes = [16, 32, 48, 128, 256, 512, 1024];

function run(command, args) {
	execFileSync(command, args, {
		cwd: root,
		stdio: "inherit"
	});
}

async function main() {
	if (!fs.existsSync(applicationIcon)) {
		throw new Error(`Missing ${path.relative(root, applicationIcon)}`);
	}

	if (!fs.existsSync(applicationIconImage)) {
		throw new Error(`Missing ${path.relative(root, applicationIconImage)}`);
	}

	fs.mkdirSync(buildDir, {recursive: true});
	fs.mkdirSync(linuxIconsDir, {recursive: true});

	for (const size of sizes) {
		run("sips", [
			"-z",
			String(size),
			String(size),
			applicationIconImage,
			"--out",
			path.join(linuxIconsDir, `${size}.png`)
		]);
	}

	const {icnsFile} = await generateAssetCatalogForIcon(applicationIcon);
	fs.writeFileSync(path.join(buildDir, "icon.icns"), icnsFile);

	const outDir = path.join(buildDir, ".icon-ico");
	fs.rmSync(outDir, {recursive: true, force: true});
	run(appBuilderPath, [
		"icon",
		"--format",
		"ico",
		"--root",
		root,
		"--out",
		outDir,
		"--input",
		"build/icons"
	]);

	fs.copyFileSync(path.join(outDir, "icon.ico"), path.join(buildDir, "icon.ico"));
	fs.rmSync(outDir, {recursive: true, force: true});
}

main().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
