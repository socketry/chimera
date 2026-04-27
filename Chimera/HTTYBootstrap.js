const HTTY_BOOTSTRAP_IDENTIFIER = Object.freeze({
	intermediates: "+",
	final: "H",
});

function decodeBootstrap(data) {
	const normalizedMode = String(data ?? "").trim().toLowerCase();
	return normalizedMode === "raw" ? {mode: "raw"} : null;
}

export function installHttyBootstrapHandler(terminal, onBootstrap) {
	return terminal.parser.registerDcsHandler(HTTY_BOOTSTRAP_IDENTIFIER, (data) => {
		const bootstrap = decodeBootstrap(data);
		if (!bootstrap) {
			return false;
		}

		onBootstrap?.(bootstrap);
		return true;
	});
}