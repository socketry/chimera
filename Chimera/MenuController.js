import {app, Menu} from "electron";

export class MenuController {
	constructor(application) {
		this.application = application;
	}
	
	buildApplicationMenu() {
		const bookmarks = this.application.bookmarksController.bookmarks();
		const bookmarkMenuItems = this.bookmarkMenuItems(bookmarks);
		const template = [
			this.applicationMenu(),
			{
				label: "Session",
				submenu: [
					{
						label: "New Window",
						accelerator: "CmdOrCtrl+N",
						click: () => {
							void this.application.createWindow();
						},
					},
					{
						label: "New Tab",
						accelerator: "CmdOrCtrl+T",
						click: () => {
							this.application.focusedWindowController()?.createSession();
						},
					},
					{
						label: "Close Tab",
						accelerator: "CmdOrCtrl+W",
						click: () => {
							this.application.focusedWindowController()?.closeActiveTab();
						},
					},
					{
						label: "Previous Tab",
						accelerator: "CmdOrCtrl+Shift+Left",
						click: () => {
							this.application.focusedWindowController()?.activateRelativeTab(-1);
						},
					},
					{
						label: "Next Tab",
						accelerator: "CmdOrCtrl+Shift+Right",
						click: () => {
							this.application.focusedWindowController()?.activateRelativeTab(1);
						},
					},
				],
			},
			{
				label: "Bookmarks",
				submenu: [
					...(bookmarkMenuItems.length > 0 ? bookmarkMenuItems : [
						{
							label: "No Bookmarks",
							enabled: false,
						},
					]),
					{type: "separator"},
					{
						label: "Edit Bookmarks...",
						click: () => {
							void this.application.editBookmarks();
						},
					},
				],
			},
			{role: "editMenu"},
			{
				label: "View",
				submenu: [
					{
						label: "Toggle Tab Bar",
						accelerator: "CmdOrCtrl+Shift+F",
						click: () => {
							this.application.focusedWindowController()?.toggleTabBar();
						},
					},
					{type: "separator"},
					{role: "resetZoom"},
					{role: "zoomIn"},
					{role: "zoomOut"},
					{type: "separator"},
					{role: "reload"},
					{role: "forceReload"},
					{role: "toggleDevTools"},
					{
						label: "Inspect Active Web View",
						click: () => {
							this.application.focusedWindowController()?.showActiveSurfaceDeveloperTools();
						},
					},
					{
						label: "Auto-Inspect New Web Views",
						type: "checkbox",
						checked: Boolean(this.application.configuration.debugOptions().autoInspectSurfaces),
						click: (menuItem) => {
							this.application.setAutoInspectSurfaces(menuItem.checked);
						},
					},
				],
			},
			{role: "windowMenu"},
			{
				label: "Help",
				submenu: [
					{
						label: "Releases",
						click: () => {
							void this.application.showReleases();
						},
					},
					{
						label: "Bookmarks",
						click: () => {
							void this.application.showBookmarksHelp();
						},
					},
				],
			},
		];

		Menu.setApplicationMenu(Menu.buildFromTemplate(template));
	}

	applicationMenu() {
		const applicationItems = [
			{
				label: "Edit Configuration...",
				click: () => {
					void this.application.editConfiguration();
				},
			},
			{
				label: "Check for Updates...",
				click: () => {
					void this.application.updateController.checkForUpdates({userInitiated: true});
				},
			},
		];

		if (process.platform !== "darwin") {
			return {
				label: "Chimera",
				submenu: applicationItems,
			};
		}

		return {
			label: app.name,
			submenu: [
				{role: "about"},
				{type: "separator"},
				...applicationItems,
				{type: "separator"},
				{role: "services"},
				{type: "separator"},
				{role: "hide"},
				{role: "hideOthers"},
				{role: "unhide"},
				{type: "separator"},
				{role: "quit"},
			],
		};
	}

	bookmarkMenuItems(bookmarks) {
		return bookmarks.map((bookmark) => this.bookmarkMenuItem(bookmark)).filter(Boolean);
	}

	bookmarkMenuItem(bookmark) {
		if (bookmark.type === "separator") {
			return {type: "separator"};
		}

		if (bookmark.type === "group") {
			return {
				label: bookmark.title,
				submenu: this.bookmarkMenuItems(bookmark.items),
			};
		}

		if (bookmark.type === "command") {
			return {
				label: bookmark.title,
				click: () => {
					void this.application.openBookmark(bookmark);
				},
			};
		}

		return null;
	}
}
