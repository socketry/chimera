import {Chimera} from "../Chimera.js";

const application = Chimera.start();

application.start().catch((error) => {
	console.error("Failed to start Chimera:", error);
	process.exitCode = 1;
});
