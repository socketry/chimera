import {Tab} from "./Tab.js";
import {TerminalPane} from "./TerminalPane.js";

export class TerminalTab extends Tab {
	constructor(controller, session) {
		super(controller, {
			id: `terminal:${session.id}`,
			type: "terminal",
			title: session.title,
			sessionId: session.id,
			closable: true,
		});
		
		this.terminalPane = this.pushPane(new TerminalPane(this, session), {activate: false});
	}
	
	writeData(data) {
		this.terminalPane?.writeData(data);
	}

	applyTerminalOptions(options) {
		this.terminalPane?.applyTerminalOptions(options);
	}
	
	writeExit(exitCode, signal) {
		this.terminalPane?.writeExit(exitCode, signal);
	}
	
	fit() {
		this.resizeToHost();
	}
	
	isHttyAttached() {
		return this.terminalPane?.isHttyAttached() ?? false;
	}
}
