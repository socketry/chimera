import {FitAddon} from "../../node_modules/@xterm/addon-fit/lib/addon-fit.mjs";
import {WebglAddon} from "../../node_modules/@xterm/addon-webgl/lib/addon-webgl.mjs";
import {Terminal} from "../../node_modules/@xterm/xterm/lib/xterm.mjs";

import {Pane} from "./Pane.js";

const HTTY_BOOTSTRAP_IDENTIFIER = Object.freeze({
	intermediates: "+",
	final: "H",
});

class TerminalSessionMode {
	constructor() {
		this.transportMode = "terminal";
		this.pendingTransportMode = null;
	}
	
	update(session) {
		this.transportMode = session?.transportMode === "htty" ? "htty" : "terminal";
		this.pendingTransportMode = null;
	}
	
	beginHttyTakeover() {
		this.pendingTransportMode = "htty";
	}
	
	isHttyAttached() {
		return this.pendingTransportMode === "htty" || this.transportMode === "htty";
	}
	
	allowsTerminalInput() {
		return !this.isHttyAttached();
	}
	
	getLabel() {
		return "HTTY attached - terminal input paused";
	}
	
	getMode() {
		return this.isHttyAttached() ? "htty" : "terminal";
	}
}

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

function cssVariable(name) {
	return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

function terminalTheme() {
	return {
		background: cssVariable("--xterm-bg") || "#050914",
		foreground: cssVariable("--xterm-fg") || "#ecf3ff",
		cursor: cssVariable("--xterm-cursor") || "#f6d365",
		selectionBackground: cssVariable("--xterm-selection-bg") || "rgba(246, 211, 101, 0.25)",
	};
}

export function decodeHttyBootstrap(data) {
	const normalizedMode = String(data ?? "").trim().toLowerCase();
	return normalizedMode === "raw" ? {mode: "raw"} : null;
}

export function installHttyBootstrapHandler(terminal, onBootstrap) {
	return terminal.parser.registerDcsHandler(HTTY_BOOTSTRAP_IDENTIFIER, (data) => {
		const bootstrap = decodeHttyBootstrap(data);
		if (!bootstrap) {
			return false;
		}

		onBootstrap?.(bootstrap);
		return true;
	});
}

export class TerminalPane extends Pane {
	constructor(tab, session) {
		super(tab, {
			id: `terminal:${session.id}`,
			type: "terminal",
		});
		
		this.sessionMode = new TerminalSessionMode();
		this.session = session;
		this.updateSession(session);
		this.terminal.onData((data) => {
			if (!this.sessionMode.allowsTerminalInput()) {
				return;
			}
			
			this.controller.sendTerminalInput(this.sessionId, data);
		});
	}
	
	createNode() {
		const panel = document.createElement("section");
		panel.className = "terminal-panel";
		panel.innerHTML = `
			<div class="terminal-host">
				<div class="terminal-content"></div>
			</div>
			<div class="terminal-session-mode" hidden>
				<strong>HTTY Session Active</strong>
				<span class="terminal-session-mode-detail"></span>
			</div>
		`;
		
		this.hostNode = panel.querySelector(".terminal-host");
		this.contentNode = panel.querySelector(".terminal-content");
		this.sessionModeNode = panel.querySelector(".terminal-session-mode");
		this.sessionModeDetailNode = panel.querySelector(".terminal-session-mode-detail");
		this.isOpen = false;
		this.webglRendererAttempted = false;
		this.webglAddon = null;
		this.webglContextLossDisposable = null;
		this.terminal = new Terminal({
			allowTransparency: true,
			cursorBlink: true,
			...this.controller.terminalOptions,
			theme: terminalTheme(),
		});
		this.themeMediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
		this.themeChangeHandler = () => {
			this.terminal.options.theme = terminalTheme();
		};
		this.themeMediaQuery.addEventListener?.("change", this.themeChangeHandler);
		
		this.terminal.attachCustomKeyEventHandler((event) => {
			if (event.type !== "keydown") {
				return true;
			}
			
			const isPrimaryModifier = event.metaKey || event.ctrlKey;
			if (!isPrimaryModifier || event.altKey || event.shiftKey || event.key.toLowerCase() !== "c") {
				return true;
			}
			
			if (!this.terminal.hasSelection()) {
				if (this.sessionMode?.isHttyAttached()) {
					this.controller.sendInterruptToActiveSession();
					return false;
				}
				
				return true;
			}
			
			this.controller.windowApi.writeClipboardText(this.terminal.getSelection());
			return false;
		});
		
		this.fitAddon = new FitAddon();
		this.terminal.loadAddon(this.fitAddon);
		this.terminal.onTitleChange((title) => {
			void this.controller.windowApi.setSessionTitle(this.sessionId, title);
		});
		this.bootstrapDisposable = installHttyBootstrapHandler(this.terminal, (bootstrap) => {
			this.handleHttyBootstrap(bootstrap);
		});
		
		return panel;
	}
	
	handleHttyBootstrap(bootstrap) {
		if (bootstrap?.mode !== "raw") {
			return;
		}
		
		this.sessionMode.beginHttyTakeover();
		this.updateSessionModePresentation();
		this.controller.setSessionTransportMode(this.sessionId, "htty");
	}
	
	ensureOpen() {
		if (this.isOpen || !this.contentNode?.isConnected) {
			return;
		}
		
		this.terminal.open(this.contentNode);
		this.isOpen = true;
		this.installWebglRenderer();
	}

	installWebglRenderer() {
		if (this.webglRendererAttempted || this.webglAddon) {
			return;
		}

		this.webglRendererAttempted = true;

		try {
			const webglAddon = new WebglAddon();
			this.webglContextLossDisposable = webglAddon.onContextLoss?.(() => {
				this.webglContextLossDisposable?.dispose?.();
				this.webglContextLossDisposable = null;
				this.webglAddon = null;
				webglAddon.dispose();
			}) ?? null;

			this.terminal.loadAddon(webglAddon);
			this.webglAddon = webglAddon;
		} catch (error) {
			console.warn("Unable to enable xterm WebGL renderer:", error);
			this.webglContextLossDisposable?.dispose?.();
			this.webglContextLossDisposable = null;
			this.webglAddon?.dispose?.();
			this.webglAddon = null;
		}
	}
	
	getLabel() {
		return this.session?.title ?? this.tab.title;
	}
	
	getTooltip() {
		if (this.session?.commandLine && this.session.commandLine !== this.session.title) {
			return `${this.session.title} · ${this.session.commandLine}`;
		}
		
		return this.session?.title ?? this.tab.title;
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
		this.controller.setSessionTransportMode(this.sessionId, "terminal");
		requestAnimationFrame(() => {
			this.ensureOpen();
			this.fit();
		});
	}
	
	afterActivation() {
		this.focusPrimaryControl({immediate: true});
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
		this.sessionMode.update(session);
		this.tab.title = session.title;
		this.tab.button.classList.toggle("tab-button-has-surface", Boolean(session.hasDocument));
		this.tab.button.classList.toggle("tab-button-exited", Boolean(session.exitInfo));
		this.tab.button.classList.add("tab-button-terminal");
		this.updateSessionModePresentation();
	}
	
	writeData(data) {
		this.terminal.write(data);
	}
	
	writeExit(exitCode, signal) {
		this.terminal.writeln(`\r\n[process exited: ${exitCode ?? signal ?? "unknown"}]`);
	}
	
	resizeToHost() {
		if (!this.isOpen) {
			return;
		}
		
		this.fitAddon.fit();
		this.controller.resizeTerminal(this.sessionId, this.terminal.cols, this.terminal.rows);
	}
	
	fit() {
		this.resizeToHost();
	}
	
	focus() {
		if (!this.isOpen) {
			return;
		}
		
		this.terminal.focus();
	}
	
	isHttyAttached() {
		return this.sessionMode.isHttyAttached();
	}
	
	shouldInterceptInterrupt(target) {
		if (this.isHttyAttached()) {
			return true;
		}
		
		return !target || !target.closest(".xterm");
	}
	
	updateSessionModePresentation() {
		const isHttyAttached = this.sessionMode.isHttyAttached();
		this.node.dataset.transportMode = this.sessionMode.getMode();
		this.tab.button.dataset.transportMode = this.sessionMode.getMode();
		
		if (this.terminal?.options) {
			this.terminal.options.disableStdin = !this.sessionMode.allowsTerminalInput();
		}
		
		if (!this.sessionModeNode || !this.sessionModeDetailNode) {
			return;
		}
		
		this.sessionModeNode.hidden = !isHttyAttached;
		this.sessionModeDetailNode.textContent = this.sessionMode.getLabel();
	}
	
	dispose() {
		this.themeMediaQuery?.removeEventListener?.("change", this.themeChangeHandler);
		this.bootstrapDisposable?.dispose?.();
		this.bootstrapDisposable = null;
		this.webglContextLossDisposable?.dispose?.();
		this.webglContextLossDisposable = null;
		this.webglAddon?.dispose?.();
		this.webglAddon = null;
		
		try {
			this.terminal.dispose();
		} catch {
			// Ignore xterm teardown errors during tab disposal.
		}
		
		super.dispose();
	}
}
