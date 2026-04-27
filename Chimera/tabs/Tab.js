export class Tab {
	constructor(controller, {id, type, title, sessionId = null, closable = true}) {
		this.controller = controller;
		this.id = id;
		this.type = type;
		this.title = title;
		this.sessionId = sessionId;
		this.closable = closable;
		this.panes = [];
		this.button = this.createButton();
		this.panel = this.createPanel();
		this.panel.hidden = true;
		this.activationTicket = 0;
		this.installPanelInteractionHandlers();
	}

	createButton() {
		const button = document.createElement("div");
		button.className = "tab-button";
		button.role = "tab";
		button.tabIndex = 0;
		button.draggable = true;

		this.labelNode = document.createElement("span");
		this.labelNode.className = "tab-label";
		button.appendChild(this.labelNode);

		if (this.closable) {
			const closeButton = document.createElement("button");
			closeButton.className = "tab-close";
			closeButton.type = "button";
			closeButton.setAttribute("aria-label", `Close ${this.title}`);
			closeButton.textContent = "×";
			closeButton.addEventListener("click", (event) => {
				event.stopPropagation();
				this.controller.closeTab(this.id);
			});
			button.appendChild(closeButton);
		}

		button.addEventListener("click", () => {
			this.controller.activateTab(this.id, {focusPrimary: true});
		});

		button.addEventListener("keydown", (event) => {
			this.controller.handleTabButtonKeyDown(this.id, event);
		});

		button.addEventListener("dragstart", (event) => {
			button.classList.add("tab-button-dragging");
			event.dataTransfer.effectAllowed = "move";
			event.dataTransfer.setData("text/plain", this.id);
			this.controller.beginTabDrag(this.id);
		});

		button.addEventListener("dragend", (event) => {
			button.classList.remove("tab-button-dragging");
			this.controller.endTabDrag(event);
		});

		button.addEventListener("dragover", (event) => {
			event.preventDefault();
			event.dataTransfer.dropEffect = "move";
			this.controller.previewTabDrop(this.id, event.clientX);
		});

		button.addEventListener("drop", (event) => {
			event.preventDefault();
			this.controller.commitTabDrop(this.id, event.clientX);
		});

		// The concrete tab instance may not have finished initializing yet,
		// so seed the button from the base title instead of calling refreshButton().
		this.labelNode.textContent = this.title;
		button.title = this.title;
		button.setAttribute("aria-label", this.title);

		return button;
	}

	createPanel() {
		const panel = document.createElement("section");
		panel.className = "view-panel tab-panel";
		this.stackNode = document.createElement("div");
		this.stackNode.className = "tab-pane-stack";
		panel.appendChild(this.stackNode);
		return panel;
	}

	installPanelInteractionHandlers() {
		this.panel.addEventListener("pointerdown", () => {
			if (this.controller.activeTabId !== this.id) {
				this.controller.activateTab(this.id, {focusPrimary: true});
				return;
			}

			this.activePane?.focusPrimary({immediate: true});
		});
	}

	get activePane() {
		return this.panes.at(-1) ?? null;
	}

	pushPane(pane, {activate = true} = {}) {
		this.panes.push(pane);
		this.stackNode.appendChild(pane.node);
		
		if (activate && !this.panel.hidden) {
			this.activatePane(pane, {focusPrimary: true});
		} else {
			pane.setActive(false);
		}
		
		this.refreshButton();
		return pane;
	}
	
	popPane() {
		if (this.panes.length <= 1) {
			return null;
		}
		
		const pane = this.panes.pop();
		pane.setActive(false);
		pane.dispose();
		
		if (!this.panel.hidden) {
			this.activatePane(this.activePane, {focusPrimary: true});
		}
		
		this.refreshButton();
		return pane;
	}
	
	removePane(pane) {
		const index = this.panes.indexOf(pane);
		if (index === -1) {
			return false;
		}
		
		const wasActive = pane === this.activePane;
		this.panes.splice(index, 1);
		pane.setActive(false);
		pane.dispose();
		
		if (wasActive && !this.panel.hidden && this.activePane) {
			this.activatePane(this.activePane, {focusPrimary: true});
		}
		
		this.refreshButton();
		return true;
	}
	
	activatePane(pane, options = {}) {
		for (const candidate of this.panes) {
			candidate.setActive(candidate === pane, candidate === pane ? options : undefined);
		}
	}
	
	refreshButton() {
		this.labelNode.textContent = this.getLabel();
		this.button.title = this.getTooltip();
		this.button.setAttribute("aria-label", this.getTooltip());
	}

	getLabel() {
		return this.activePane?.getLabel() ?? this.title;
	}

	getTooltip() {
		return this.activePane?.getTooltip() ?? this.title;
	}

	getAddressState() {
		return this.activePane?.getAddressState() ?? {
			kind: "Info",
			value: "",
			detail: this.title,
			submitLabel: "Open",
		};
	}

	// Tab lifecycle contract:
	// 1. Activation makes the panel visible and prepares its content for interaction.
	// 2. `focusPrimary: true` transfers keyboard ownership to the tab's primary control.
	// 3. Pointer interaction inside the active panel must restore that primary control.
	// Tabs that display deferred content should do visibility work in
	// `prepareForActivation`, while input-bearing tabs should implement
	// `focusPrimaryControl`.
	setActive(isActive, options = {}) {
		this.button.classList.toggle("tab-button-active", isActive);
		this.button.setAttribute("aria-selected", String(isActive));
		this.panel.hidden = !isActive;

		if (isActive) {
			const activationTicket = ++this.activationTicket;
			this.activatePane(this.activePane, options);

			requestAnimationFrame(() => {
				if (this.activationTicket !== activationTicket || this.panel.hidden || !this.panel.isConnected) {
					return;
				}

				this.activePane?.afterActivation(options);
			});
		} else {
			this.activationTicket += 1;
			this.activatePane(null, options);
		}
	}

	focusPrimary(options = {}) {
		this.activePane?.focusPrimary(options);
	}

	onHostVisibilityChanged() {
		this.activePane?.onHostVisibilityChanged();
	}

	onHostFocusChanged() {
		this.activePane?.onHostFocusChanged();
	}

	updateSession(_session) {
		for (const pane of this.panes) {
			pane.updateSession(_session);
		}
		this.refreshButton();
	}
	
	writeData(data) {
		this.activePane?.writeData(data);
	}
	
	writeExit(exitCode, signal) {
		this.activePane?.writeExit(exitCode, signal);
	}
	
	resizeToHost() {
		this.activePane?.resizeToHost();
	}
	
	shouldInterceptInterrupt(target) {
		return this.activePane?.shouldInterceptInterrupt(target) ?? false;
	}
	
	closeRequest() {
		return this.activePane?.closeRequest() ?? {kind: "session", sessionId: this.sessionId};
	}

	dispose() {
		for (const pane of this.panes.splice(0)) {
			pane.dispose();
		}
		this.button.remove();
		this.panel.remove();
	}
}