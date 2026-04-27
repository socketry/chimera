# Chimera

Chimera is an Electron terminal emulator that can attach browser surfaces to a normal terminal session over HTTY.

## Current Default Demo Path

Chimera includes JavaScript HTTY demos under `examples/`:

- `examples/hello-world.mjs`
- `examples/browser-demo.mjs`
- `examples/chimera-configuration.mjs`
- `examples/platformer-demo.mjs`
- `examples/styled-browser-demo.mjs`

Those demos use the published `@socketry/htty` package dependency declared in `package.json`.

The older Ruby demos in `../async-htty/examples` are still useful as a reference implementation, but they are no longer the primary launch path used by Chimera.

## Development

Install dependencies:

```bash
npm install
```

Start the app:

```bash
npm start
```

## Configuration

Chimera reads JSON configuration from `~/.local/state/chimera.json` by default. You can override the path with `CHIMERA_CONFIG_PATH` and select a profile with `CHIMERA_CONFIG_PROFILE`.

The built-in UI follows the operating system light/dark preference automatically. To override the theme, provide a stylesheet path:

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
	}
}
```

Relative stylesheet paths are resolved from the directory containing the configuration file. The custom stylesheet is loaded after Chimera's default stylesheet, so it can override the default CSS variables such as `--terminal-bg`, `--text`, `--muted`, `--accent`, and `--xterm-bg`. Terminal options are passed to xterm.js when each terminal is created.

Run the HTTY-focused unit tests:

```bash
node --test test/BrowserSurface.js
```

Run the Electron end-to-end tests:

```bash
npm run test:e2e
```

## Architecture

- `@socketry/htty` provides HTTY bootstrap detection plus the JavaScript client and server primitives.
- Chimera uses `Client`, `BootstrapDecoder`, and the terminal `Session` wrapper from `@socketry/htty` directly in the Electron main process.
- Browser tabs are created from HTTP responses returned by the attached HTTY application.
- One command process maps to one HTTY session, and multiple surface tabs can be opened against that session.