import {WindowController} from "./WindowController.js";

export class LinuxWindowController extends WindowController {
	windowOptions(overrides = {}) {
		return {
			...super.windowOptions(overrides),
			titleBarStyle: "default",
			titleBarOverlay: false,
		};
	}
}
