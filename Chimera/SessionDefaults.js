import os from "node:os";

export function resolveSessionCwd(cwd) {
	return cwd || os.homedir() || process.cwd();
}
