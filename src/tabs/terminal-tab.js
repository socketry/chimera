import {FitAddon} from "../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import {Terminal} from "../../node_modules/@xterm/xterm/lib/xterm.mjs";

import {Tab} from "./tab.js";

function sessionLabel(session) {
	if (!session) {
		return "No session";
	}

	if (session.exitInfo) {
		return `${session.title} · exited`;
	}

	if (session.state?.phase) {
		return `${session.title} · ${session.state.status}:${session.state.phase}`;
	}

	return `${session.title} · ${session.state?.status ?? "idle"}`;
}

export class TerminalTab extends Tab {
	constructor(controller, session) {
		super(controller, {
			id: `terminal:${session.id}`,
			type: "terminal",
			title: session.title,
			sessionId: session.id,
			closable: true,
		});

		this.session = session;
		this.updateSession(session);
		this.terminal.onData((data) => {
			this.controller.sendTerminalInput(this.sessionId, data);
		});
	}

	createPanel() {
		const panel = document.createElement("section");
		panel.className = "view-panel terminal-panel";
		panel.innerHTML = '<div class="terminal-host"></div>';

		this.hostNode = panel.querySelector(".terminal-host");
		this.isOpen = false;
		this.terminal = new Terminal({
			allowTransparency: true,
			cursorBlink: true,
			fontFamily: '"IBM Plex Mono", "SFMono-Regular", monospace',
			fontSize: 15,
			lineHeight: 1.2,
			theme: {
				background: "#050914",
				foreground: "#ecf3ff",
				cursor: "#f6d365",
				selectionBackground: "rgba(246, 211, 101, 0.25)",
			},
		});

		this.terminal.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") {
				return true;
			}

			const isPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!isPrimaryModifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") {
				return true;
			}

			if (!this.terminal.hasSelection()) {
				return true;
			}

			this.controller.windowApi.writeClipboardText(this.terminal.getSelection());
			return false;
		});

		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);

		return panel;
	}

	ensureOpen() {
		if (this.isOpen || !this.hostNode?.isConnected) {
			return;
		}

		this.terminal.open(this.hostNode);
		this.isOpen = true;
	}

	getTooltip() {
		return this.session?.commandLine ?? this.title;
	}

	getAddressState() {
		return {
			kind: "Command",
			value: this.session?.commandLine ?? "",
			detail: `${sessionLabel(this.session)}${this.session?.cwd ? ` · ${this.session.cwd}` : ""}`,
			submitLabel: "Open",
		};
	}

	prepareForActivation() {
		requestAnimationFrame(() => {
			this.ensureOpen();
			this.fit();
		});
	}

	focusPrimaryControl({immediate = false} = {}) {
		const applyFocus = () => {
			this.ensureOpen();
			this.fit();
			this.focus();
		};

		if (immediate) {
			applyFocus();
		} else {
			requestAnimationFrame(() => {
				applyFocus();
			});
		}
	}

	updateSession(session) {
		this.session = session;
		this.title = session.title;
		this.button.classList.toggle("tab-button-has-surface", Boolean(session.hasDocument));
		this.button.classList.toggle("tab-button-exited", Boolean(session.exitInfo));
		this.button.classList.add("tab-button-terminal");
		this.refreshButton();
	}

	writeData(data) {
		this.terminal.write(data);
	}

	writeExit(exitCode, signal) {
		this.terminal.writeln(`\r\n[process exited: ${exitCode ?? signal ?? "unknown"}]`);
	}

	fit() {
		if (!this.isOpen) {
			return;
		}

		this.fitAddon.fit();
		this.controller.resizeTerminal(this.sessionId, this.terminal.cols, this.terminal.rows);
	}

	focus() {
		if (!this.isOpen) {
			return;
		}

		this.terminal.focus();
	}

	dispose() {
		try {
			this.terminal.dispose();
		} catch {
			// Ignore xterm teardown errors during tab disposal.
		}

		super.dispose();
	}
}