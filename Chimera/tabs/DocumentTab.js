import {Pane} from "./Pane.js";
import {Tab} from "./Tab.js";

export class DocumentPane extends Pane {
	constructor(tab, {src}) {
		super(tab, {
			id: `${tab.id}:document`,
			type: "document",
		});
		this.src = src;
		this.frame.src = src;
	}

	createNode() {
		const panel = document.createElement("section");
		panel.className = "document-panel";
		
		this.frame = document.createElement("iframe");
		this.frame.className = "document-frame";
		this.frame.title = this.tab.title;
		this.frame.sandbox = "";
		panel.appendChild(this.frame);
		
		return panel;
	}

	getAddressState() {
		return {
			kind: "Info",
			value: "",
			detail: this.getLabel(),
			submitLabel: "Open",
		};
	}

	focusPrimaryControl() {
		this.frame.focus();
	}
}

export class DocumentTab extends Tab {
	constructor(controller, {id, title, src}) {
		super(controller, {
			id,
			type: "document",
			title,
			closable: true,
		});
		
		this.documentPane = this.pushPane(new DocumentPane(this, {src}), {activate: false});
	}

	closeRequest() {
		return {kind: "tab", tabId: this.id};
	}
}
