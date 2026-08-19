# Development and examples

This repository uses browser-native ES modules without a runtime build step.
Development dependencies are limited to test tooling and the local WebSocket
server used by end-to-end tests.

## Test commands

Install the pinned dependencies and run every suite:

```sh
npm ci
npm test
```

The aggregate command runs three layers in order:

- `npm run test:unit` runs fast browser component tests.
- `npm run test:pages` checks the GitHub Pages artifact and workflow contract.
- `npm run test:e2e` starts a real Node WebSocket server and controls Chrome
  with Playwright.

The E2E suite verifies text and binary traffic in both directions for main and
Worker transports. It also verifies explicit close, DOM-removal cleanup,
reconnect behavior, example navigation, and the narrow-screen layout.

## Examples

Serve the repository root with any static HTTP server, then open `/examples/`.
The WebSocket pages default to the public `wss://echo.websocket.org` endpoint,
and the endpoint field remains editable for local or application-specific
servers.

The Pages site imports modules directly from `src/`, so the examples exercise
the same source files that package consumers import.

## GitHub Pages

`npm run pages:stage` recreates `_site/` from an explicit allowlist:

- `index.html`
- `examples/`
- `src/`

Tests, dependencies, and agent files are intentionally excluded. The Pages
workflow runs all tests before uploading this directory as the deployment
artifact.

Pushes to `main` redeploy when `src/**`, `examples/**`, the root landing page,
package metadata, or the workflow itself changes. The workflow can also be run
manually through `workflow_dispatch`.
