const fs = require("node:fs");
const path = require("node:path");

if (process.platform === "win32") {
	process.exit(0);
}

const root = path.resolve(__dirname, "..");
const prebuildsRoot = path.join(root, "node_modules", "node-pty", "prebuilds");

if (!fs.existsSync(prebuildsRoot)) {
	process.exit(0);
}

for (const entry of fs.readdirSync(prebuildsRoot, {withFileTypes: true})) {
	if (!entry.isDirectory()) {
		continue;
	}

	const helperPath = path.join(prebuildsRoot, entry.name, "spawn-helper");

	if (!fs.existsSync(helperPath)) {
		continue;
	}

	const stats = fs.statSync(helperPath);
	const mode = stats.mode & 0o777;
	const desiredMode = mode | 0o755;

	if (mode !== desiredMode) {
		fs.chmodSync(helperPath, desiredMode);
		console.log(`Made node-pty helper executable: ${helperPath}`);
	}
}