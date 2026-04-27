import {Tab} from "./tab.js";

function surfaceLabelFromDebugState(debugState) {
	if (!debugState) {
		return "Detached";
	}

	if (debugState.state.status === "attached") {
		return debugState.document?.document?.mode === "html" ? "Attached" : "Preview";
	}

	if (debugState.state.status === "negotiating") {
		return "Negotiating";
	}

	if (debugState.state.status === "closing") {
		return "Closing";
	}

	if (debugState.state.status === "error") {
		return "Error";
	}

	return debugState.document ? "Preview" : "Detached";
}

export class DebugTab extends Tab {
	constructor(controller) {
		super(controller, {
			id: "debug-tab",
			type: "debug",
			title: "Debug",
			closable: true,
		});

		this.debugState = null;
		this.sessionOptions = [];
		this.selectedSessionId = null;

		this.sessionSelect.addEventListener("change", async () => {
			this.selectedSessionId = this.sessionSelect.value || null;
			this.controller.setDebugSession(this.selectedSessionId);
			await this.controller.refreshDebugSnapshot();
		});
	}

	createPanel() {
		const panel = document.createElement("section");
		panel.className = "view-panel debug-panel";
		panel.innerHTML = `
			<div class="debug-layout">
				<div class="debug-column">
					<div class="panel-card status-grid-card">
						<div class="panel-header compact-header">
							<div>
								<h2>Debug Context</h2>
								<p>Inspect one session while keeping its terminal or surface in adjacent tabs.</p>
							</div>
						</div>
						<label class="field-label">
							<span>Session</span>
							<select></select>
						</label>
						<div class="status-grid">
							<div class="status-card">
								<span>Packet Count</span>
								<strong data-role="packet-count">0</strong>
							</div>
							<div class="status-card">
								<span>Session</span>
								<strong data-role="session-status">Idle</strong>
							</div>
							<div class="status-card">
								<span>Surface</span>
								<strong data-role="surface-status">Detached</strong>
							</div>
						</div>
					</div>

					<div class="panel-card">
						<div class="panel-header compact-header">
							<div>
								<h2>Response</h2>
								<p>The address bar above the tabs issues requests for the selected session.</p>
							</div>
						</div>
						<pre class="response-view" data-role="response-view">No response yet.</pre>
					</div>
				</div>

				<div class="debug-column">
					<div class="panel-card packet-card">
						<div class="panel-header compact-header">
							<div>
								<h2>HTTY Inspector</h2>
								<p>Recent control packets for the selected session.</p>
							</div>
						</div>
						<ol class="packet-log" data-role="packet-log"></ol>
					</div>
				</div>
			</div>
		`;

		this.sessionSelect = panel.querySelector("select");
		this.packetCountNode = panel.querySelector('[data-role="packet-count"]');
		this.sessionStatusNode = panel.querySelector('[data-role="session-status"]');
		this.surfaceStatusNode = panel.querySelector('[data-role="surface-status"]');
		this.responseView = panel.querySelector('[data-role="response-view"]');
		this.packetLog = panel.querySelector('[data-role="packet-log"]');

		return panel;
	}

	getAddressState() {
		const selectedSession = this.controller.getSession(this.selectedSessionId);
		return {
			kind: "Session",
			value: selectedSession?.lastSurfacePath ?? selectedSession?.commandLine ?? "",
			detail: selectedSession ? `${selectedSession.title} · ${selectedSession.state.status}` : "No session selected",
			submitLabel: "Open",
		};
	}

	setSessions(sessionOptions, selectedSessionId) {
		this.sessionOptions = sessionOptions;
		this.selectedSessionId = selectedSessionId;
		this.sessionSelect.replaceChildren();

		if (sessionOptions.length === 0) {
			const option = document.createElement("option");
			option.value = "";
			option.textContent = "No sessions";
			this.sessionSelect.appendChild(option);
			this.sessionSelect.disabled = true;
			return;
		}

		this.sessionSelect.disabled = false;

		for (const session of sessionOptions) {
			const option = document.createElement("option");
			option.value = session.id;
			option.textContent = session.commandLine;
			this.sessionSelect.appendChild(option);
		}

		this.sessionSelect.value = selectedSessionId;
	}

	renderDebugState(debugState) {
		this.debugState = debugState;

		if (!debugState) {
			this.packetCountNode.textContent = "0";
			this.sessionStatusNode.textContent = "Idle";
			this.surfaceStatusNode.textContent = "Detached";
			this.responseView.textContent = "No response yet.";
			this.packetLog.replaceChildren();
			return;
		}

		this.packetCountNode.textContent = String(debugState.packetCount);
		this.sessionStatusNode.textContent = debugState.state.phase ? `${debugState.state.status} · ${debugState.state.phase}` : debugState.state.status;
		this.surfaceStatusNode.textContent = surfaceLabelFromDebugState(debugState);
		this.responseView.textContent = debugState.responseText;
		this.packetLog.replaceChildren();

		for (const packet of debugState.packets) {
			const item = document.createElement("li");
			item.className = "packet-item";
			item.innerHTML = `
				<div>
					<strong>${packet.type}</strong>
					<span>${packet.payloadLength} bytes</span>
				</div>
				<code>${packet.preview || "empty"}</code>
			`;
			this.packetLog.appendChild(item);
		}
	}
}