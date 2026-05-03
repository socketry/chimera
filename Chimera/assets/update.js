const elements = {
	title: document.querySelector("h1"),
	description: document.getElementById("description"),
	progress: document.getElementById("progress"),
	status: document.getElementById("status"),
	later: document.getElementById("later"),
	download: document.getElementById("download"),
	restart: document.getElementById("restart"),
};

const params = new URLSearchParams(location.search);
const version = params.get("version");

if (version) {
	elements.description.textContent = `Version ${version} is available.`;
}

window.chimeraUpdate = {
	showDownloadProgress() {
		elements.title.textContent = "Downloading Update";
		elements.description.textContent = "Chimera is downloading the update.";
		elements.progress.hidden = false;
		elements.status.textContent = "Preparing download...";
		elements.later.hidden = true;
		elements.download.hidden = true;
	},
	
	updateDownloadProgress(percent, status) {
		elements.progress.value = percent;
		elements.status.textContent = status;
	},
	
	showUpdateReady() {
		elements.title.textContent = "Update Ready";
		elements.status.textContent = "Restart Chimera to finish installing the update.";
		elements.restart.href = "chimera-update://restart";
		elements.restart.hidden = false;
		elements.restart.setAttribute("aria-disabled", "false");
	},
	
	showUpdateError(message) {
		elements.title.textContent = "Update Failed";
		elements.description.textContent = "Chimera could not download the update.";
		elements.progress.hidden = true;
		elements.status.textContent = message;
		elements.later.hidden = false;
		elements.download.hidden = false;
	},
};
