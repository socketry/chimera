import {WorkspaceController} from "./workspace-controller.js";

const controller = new WorkspaceController(window.chimera, {
	tabStrip: document.getElementById("tab-strip"),
	viewStack: document.getElementById("view-stack"),
	emptyState: document.getElementById("empty-state"),
	addressForm: document.getElementById("address-form"),
	addressInput: document.getElementById("address-input"),
	addressSubmitButton: document.getElementById("address-submit"),
});

try {
	await controller.initialize();
} catch (error) {
	console.error("Failed to initialize Chimera renderer:", error);

	const input = document.getElementById("address-input");
	if (input) {
		input.value = error?.message || String(error);
	}

	document.body.dataset.bootstrapError = "true";
}