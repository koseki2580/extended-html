# Development and examples

This repository uses browser-native ES modules without a runtime build step.
Development dependencies are limited to test tooling and the local WebSocket
and server-sent-event server used by end-to-end tests.

## Test commands

Install the pinned dependencies and run every suite:

```sh
npm ci
npm test
```

The aggregate command runs three layers in order:

- `npm run test:unit` runs browser component tests one file at a time so
  short-lived media and Worker timing checks remain stable under CI load.
- `npm run test:pages` checks the GitHub Pages artifact and workflow contract.
- `npm run test:e2e` starts a real Node WebSocket server and controls Chrome
  with Playwright.

The E2E suite verifies text and binary traffic in both directions for main and
Worker transports. It also verifies explicit close, DOM-removal cleanup,
reconnect behavior, example navigation, and the narrow-screen layout.
EventSource coverage verifies main and Worker delivery metadata, native
Last-Event-ID reconnection, and DOM-removal cleanup against a local SSE endpoint.
Audio coverage uses fake browser media devices to exercise graph lifecycle,
recording, native MediaStream handoff, and two real local RTCPeerConnection
instances. Graph editor coverage verifies light-DOM synchronization, pointer
and keyboard connections, attribute editing, recorder event/action flow, and
application handler references added through the editor UI.

## Examples

Serve the repository root with any static HTTP server, then open `/examples/`.
The WebSocket pages default to the public `wss://echo.websocket.org` endpoint,
and the endpoint field remains editable for local or application-specific
servers.
EventSource pages default to `https://sse.dev/test` and expose the same editable
endpoint workflow for any CORS-compatible SSE server.

The Pages site imports modules directly from `src/`, so the examples exercise
the same source files that package consumers import.

## GitHub Pages

`npm run pages:stage` recreates `_site/` from an explicit allowlist:

- `index.html`
- `examples/`
- `guide/`
- `src/`

Tests, dependencies, and agent files are intentionally excluded. The Pages
workflow runs all tests before uploading this directory as the deployment
artifact.

Pushes to `main` redeploy when `src/**`, `examples/**`, the root landing page,
package metadata, or the workflow itself changes. The workflow can also be run
manually through `workflow_dispatch`.
