import {WorkspaceController} from "./WorkspaceController.js";

const controller = new WorkspaceController(window.chimera, {
	tabStrip: document.getElementById("tab-strip"),
	viewStack: document.getElementById("view-stack"),
	emptyState: document.getElementById("empty-state"),
});

try {
	await controller.initialize();
} catch (error) {
	console.error("Failed to initialize Chimera renderer:", error);

	document.body.dataset.bootstrapError = "true";
}