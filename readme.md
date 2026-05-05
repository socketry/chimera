# Chimera

Traditional terminals are excellent command environments, but they are a poor substitute for rich application UI. Text flow, highlighting, animation, media, layout, and direct manipulation all become awkward when everything must be squeezed through terminal cells.

Chimera keeps the power of the TTY and pairs it with the modern web stack. A command can run like any other terminal process, then use HTTY to attach local browser surfaces for richer interaction when terminal rendering is no longer enough.

> [!WARNING]
> Chimera and the surrounding HTTY stack are experimental. Expect protocol, configuration, and application behavior to evolve. In addition, feel free to contribute feedback, bug reports, and code to help shape the future of this project.

## Download

Install the latest packaged build from GitHub Releases:

- [Download macOS](https://github.com/socketry/chimera/releases/latest/download/Chimera-macOS-arm64.dmg)
- [Download Linux](https://github.com/socketry/chimera/releases/latest/download/Chimera-Linux-x86_64.AppImage)
- [Download Windows](https://github.com/socketry/chimera/releases/latest/download/Chimera-Windows-x64.exe)
- [All releases](https://github.com/socketry/chimera/releases/latest)

Packaged builds can check for updates from the Chimera application menu.

## First Run

Open Chimera and start a shell with `File > New Tab` or `Cmd/Ctrl+T`. You can use it like a regular terminal.

To see an HTTY surface, run one of the included examples from a development checkout:

```bash
node examples/browser-demo.mjs
```

Chimera will keep the terminal session open and create a browser tab for the attached HTTY application.

## Bookmarks

Bookmarks are command shortcuts shown in the `Bookmarks` menu. They are useful for SSH sessions, project shells, and small HTTY tools.

Use `Bookmarks > Edit Bookmarks...` to edit them interactively. The default file is:

```text
~/.local/state/chimera/bookmarks.json
```

A minimal bookmark looks like this:

```json
[
	{
		"title": "My Server",
		"command": "ssh",
		"args": ["my-server"]
	}
]
```

Bookmarks can also contain separators and nested groups. See `Help > Bookmarks` inside Chimera for the full format.

## Configuration

Use `Chimera > Edit Configuration...` to edit settings interactively. The default configuration file is:

```text
~/.local/state/chimera/configuration.json
```

You can override the path with `CHIMERA_CONFIG_PATH` and select a profile with `CHIMERA_CONFIG_PROFILE`.

Common options include terminal font settings, theme stylesheet, and update checks:

```json
{
	"terminal": {
		"fontFamily": "\"JetBrains Mono\", \"SFMono-Regular\", monospace",
		"fontSize": 14,
		"lineHeight": 1.0,
		"scrollback": 1000
	},
	"theme": {
		"stylesheet": "theme.css"
	},
	"updates": {
		"enabled": true,
		"autoCheck": true,
		"recheckIntervalHours": 24
	}
}
```

Relative stylesheet paths are resolved from the directory containing the configuration file. Terminal and theme changes are applied to existing windows when the configuration editor saves.

## HTTY Stack

Chimera is the desktop client in the HTTY ecosystem:

- [`protocol-htty`](https://github.com/socketry/protocol-htty) defines the DCS bootstrap used to negotiate an attached session.
- [`protocol-http2`](https://github.com/socketry/protocol-http2) provides the HTTP/2 wire semantics carried as plaintext `h2c` after bootstrap.
- [`async-htty`](https://github.com/socketry/async-htty) integrates HTTY with Ruby Async applications.
- [`htty-js`](https://github.com/socketry/htty-js) provides the JavaScript `@socketry/htty` package used by Chimera and the examples.

## Architecture

- Chimera runs command processes in the Electron main process using a PTY by default.
- `@socketry/htty` detects the HTTY bootstrap and provides client/session primitives.
- After bootstrap, Chimera forwards requests and responses between the attached HTTP/2 session and Electron browser surfaces.
- One command process maps to one Chimera session, and a session can expose multiple browser surface tabs.

## Contributing

We welcome contributions to this project.

1.  Fork it.
2.  Create your feature branch (`git checkout -b my-new-feature`).
3.  Commit your changes (`git commit -am 'Add some feature'`).
4.  Push to the branch (`git push origin my-new-feature`).
5.  Create new Pull Request.

### Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

Run the unit tests:

```bash
npm test
```

Run the Electron end-to-end tests:

```bash
npm run test:e2e
```

Build release artifacts locally:

```bash
npm run dist
```

### Developer Certificate of Origin

In order to protect users of this project, we require all contributors to comply with the [Developer Certificate of Origin](https://developercertificate.org/). This ensures that all contributions are properly licensed and attributed.

### Community Guidelines

This project is best served by a collaborative and respectful environment. Treat each other professionally, respect differing viewpoints, and engage constructively. Harassment, discrimination, or harmful behavior is not tolerated. Communicate clearly, listen actively, and support one another. If any issues arise, please inform the project maintainers.
