export class Pane {
	constructor(tab, {id, type}) {
		if (new.target === Pane) {
			throw new TypeError("Pane is abstract and must be subclassed.");
		}
		
		this.tab = tab;
		this.controller = tab.controller;
		this.id = id;
		this.type = type;
		this.node = this.createNode();
		this.node.classList.add("tab-pane");
		this.node.dataset.paneId = id;
		this.node.dataset.paneType = type;
		this.node.hidden = true;
		this.activationTicket = 0;
		this.isVisible = false;
		this.isPrimaryFocused = false;
	}
	
	get sessionId() {
		return this.tab.sessionId;
	}
	
	createNode() {
		throw new TypeError("Subclasses must implement createNode().");
	}
	
	getLabel() {
		return this.tab.title;
	}
	
	getTooltip() {
		return this.getLabel();
	}
	
	getAddressState() {
		return {
			kind: "Info",
			value: "",
			detail: this.getLabel(),
			submitLabel: "Open",
		};
	}
	
	setActive(isActive, options = {}) {
		this.node.hidden = !isActive;
		
		if (isActive) {
			const activationTicket = ++this.activationTicket;
			if (!this.isVisible) {
				this.isVisible = true;
				this.onShown(options);
			}
			
			this.prepareForActivation(options);
			if (options.focusPrimary) {
				this.focusPrimary(options);
			}
			
			requestAnimationFrame(() => {
				if (this.activationTicket !== activationTicket || this.node.hidden || !this.node.isConnected) {
					return;
				}
				
				this.afterActivation(options);
			});
		} else {
			this.activationTicket += 1;
			if (this.isPrimaryFocused) {
				this.isPrimaryFocused = false;
				this.onBlurred();
			}
			
			if (this.isVisible) {
				this.isVisible = false;
				this.onHidden();
			}
			
			this.onDeactivated();
		}
	}
	
	focusPrimary(options = {}) {
		this.focusPrimaryControl(options);
		
		if (!this.isPrimaryFocused) {
			this.isPrimaryFocused = true;
			this.onFocused(options);
		}
	}
	
	prepareForActivation() {
	}
	
	afterActivation() {
	}
	
	onShown() {
	}
	
	onHidden() {
	}
	
	focusPrimaryControl() {
	}
	
	onFocused() {
	}
	
	onBlurred() {
	}
	
	onHostVisibilityChanged() {
	}
	
	onHostFocusChanged() {
	}
	
	onDeactivated() {
	}
	
	updateSession() {
	}
	
	writeData() {
	}
	
	writeExit() {
	}
	
	resizeToHost() {
	}
	
	shouldInterceptInterrupt() {
		return false;
	}
	
	closeRequest() {
		return null;
	}
	
	dispose() {
		this.node.remove();
	}
}
