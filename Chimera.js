import {ChimeraApplication} from "./Chimera/Application.js";
import {Configuration} from "./Chimera/Configuration.js";
import {DarwinWindowController} from "./Chimera/DarwinWindowController.js";
import {SessionController} from "./Chimera/SessionController.js";
import {SurfaceController} from "./Chimera/SurfaceController.js";
import {WindowController} from "./Chimera/WindowController.js";

export {ChimeraApplication} from "./Chimera/Application.js";
export {Configuration} from "./Chimera/Configuration.js";
export {DarwinWindowController} from "./Chimera/DarwinWindowController.js";
export {SessionController} from "./Chimera/SessionController.js";
export {SurfaceController} from "./Chimera/SurfaceController.js";
export {WindowController} from "./Chimera/WindowController.js";

export const Chimera = {
	start(options = {}) {
		return new ChimeraApplication(options);
	},
	ChimeraApplication,
	Configuration,
	DarwinWindowController,
	WindowController,
	SessionController,
	SurfaceController,
};
