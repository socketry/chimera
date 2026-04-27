import {WindowController} from "./WindowController.js";

export class DarwinWindowController extends WindowController {
	windowOptions(overrides = {}) {
		return {
			...super.windowOptions(overrides),
			titleBarOverlay: {height: 30},
			trafficLightPosition: {x: 12, y: 8},
			autoHideMenuBar: false,
		};
	}
}