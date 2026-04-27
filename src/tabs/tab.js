export class Tab {
	constructor(controller, {id, type, title, sessionId = null, closable = true}) {
		if (new.target === Tab) {
			throw new TypeError("Tab is abstract and must be subclassed.");
		}

		this.controller = controller;
		this.id = id;
		this.type = type;
		this.title = title;
		this.sessionId = sessionId;
		this.closable = closable;
		this.button = this.createButton();
		this.panel = this.createPanel();
		this.panel.hidden = true;
		this.activationTicket = 0;
		this.isVisible = false;
		this.isPrimaryFocused = false;
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

		button.addEventListener("dragend", () => {
			button.classList.remove("tab-button-dragging");
			this.controller.endTabDrag();
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
		throw new TypeError("Subclasses must implement createPanel().");
	}

	installPanelInteractionHandlers() {
		this.panel.addEventListener("pointerdown", () => {
			if (this.controller.activeTabId !== this.id) {
				this.controller.activateTab(this.id, {focusPrimary: true});
				return;
			}

			this.focusPrimary({immediate: true});
		});
	}

	refreshButton() {
		this.labelNode.textContent = this.getLabel();
		this.button.title = this.getTooltip();
		this.button.setAttribute("aria-label", this.getTooltip());
	}

	getLabel() {
		return this.title;
	}

	getTooltip() {
		return this.title;
	}

	getAddressState() {
		return {
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
			if (!this.isVisible) {
				this.isVisible = true;
				this.onShown(options);
			}

			this.prepareForActivation(options);
			if (options.focusPrimary) {
				this.focusPrimary(options);
			}

			requestAnimationFrame(() => {
				if (this.activationTicket !== activationTicket || this.panel.hidden || !this.panel.isConnected) {
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
		// Subclasses can override.
	}

	afterActivation() {
		// Subclasses can override.
	}

	onShown() {
		// Subclasses can override.
	}

	onHidden() {
		// Subclasses can override.
	}

	focusPrimaryControl() {
		// Subclasses can override.
	}

	onFocused() {
		// Subclasses can override.
	}

	onBlurred() {
		// Subclasses can override.
	}

	onHostVisibilityChanged() {
		// Subclasses can override.
	}

	onHostFocusChanged() {
		// Subclasses can override.
	}

	onDeactivated() {
		// Subclasses can override.
	}

	updateSession(_session) {
		this.refreshButton();
	}

	dispose() {
		this.button.remove();
		this.panel.remove();
	}
}