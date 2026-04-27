# Chimera

Chimera is an Electron terminal emulator that can attach browser surfaces to a normal terminal session over HTTY.

## Current Default Demo Path

Chimera now launches the JavaScript HTTY demos from `../htty-js/examples` by default:

- `examples/hello-world.mjs`
- `examples/browser-demo.mjs`

Those demos are provided by the local `@socketry/htty` package dependency declared in `package.json`.

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

Run the HTTY-focused unit tests:

```bash
node --test test/htty-protocol.test.mjs
```

Run the Electron end-to-end tests:

```bash
npm run test:e2e
```

## Architecture

- `@socketry/htty` provides HTTY packet framing plus the JavaScript client and server primitives.
- Chimera uses `HTTYClientSession` and `HTTYDecoder` from `@socketry/htty` directly in the Electron main process.
- Browser tabs are created from HTTP responses returned by the attached HTTY application.
- One command process maps to one HTTY session, and multiple surface tabs can be opened against that session.