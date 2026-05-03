# Releases

## v0.4.2

  - Add native Linux window controls and default new windows to non-fullscreen mode.
  - Make `Configuration` loading more robust and log errors to `console`.
  - Stream HTTY document responses directly through `WebContentsView` and extract stream adapter helpers.

## v0.4.1

  - Update released file names.

## v0.4.0

  - Upgrade to `@socketry/htty` v0.4.0 and stream forwarded session requests without buffering subresources.
  - Show updates in a dedicated window with download progress and a restart button, with configurable automatic update checks.
  - Add an interactive configuration editor with live reload after saving.
  - Improve editor save buttons and feedback for bookmarks and configuration.
  - Keep tab focus near the closed tab by selecting the next tab to the right, then the previous tab.
  - Add trailing ellipses to menu commands that open another flow.
  - Publish release artifacts with stable, version-independent names for latest-download links.

## v0.3.0

  - Add WebGL-accelerated terminal rendering with fallback to the default renderer.
  - Add a Bookmarks menu populated from `bookmarks.json` next to the Chimera configuration file.
  - Add an interactive Edit Bookmarks command for editing `bookmarks.json`.
  - Move the default application state into `~/.local/state/chimera/`, with configuration in `configuration.json` and bookmarks in `bookmarks.json`.
  - Standardize built-in interactive HTTY tools on Lit with shared support helpers.
  - Refresh the Bookmarks menu from the bookmarks editor using `POST /.well-known/chimera/bookmarks/refresh`.
  - Add bundled help for creating bookmarks.
  - Keep HTTY bootstrap handling inside the terminal pane.
  - Mirror test file paths after their source modules.
  - Prepare releases automatically when running `npm version`.

## v0.2.2

  - Add releases.
  - Make auto-update check and install explicit.

## v0.2.1

  - Default to user home directory for new shells.
  - Add bundled releases viewer.
  - Generate releases HTML from markdown during packaging.
