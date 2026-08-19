# custom-html

Browser JavaScript APIs exposed as build-free HTML custom elements.

## WebSocket

Import the aggregate entry point and use `<web-socket>` directly in HTML:

```html
<script type="module">
  import "./src/index.js";
</script>

<web-socket
  url="wss://example.com/socket"
  auto
  onmessage="OnMessage(event)"
></web-socket>

<script>
  function OnMessage(event) {
    console.log(event.detail.data);
    console.log(event.detail.metadata.transport);
  }
</script>
```

To register only this element:

```js
import "./src/web-socket/web-socket.js";
```

The element supports manual connection, transparent sending, close handling,
and optional automatic reconnection:

```js
const socket = document.querySelector("web-socket");

socket.open();
socket.send("hello");
socket.close();
```

Run the same API in a dedicated module Worker by adding `background`:

```html
<web-socket
  url="wss://example.com/socket"
  auto
  background
></web-socket>
```

Worker startup failures are reported through `error` and do not silently change
transport. Add `fallback` only when an explicit main-thread fallback is wanted:

```html
<web-socket
  url="wss://example.com/socket"
  auto
  background
  fallback
></web-socket>
```

All wrapped events expose the selected transport as
`event.detail.metadata.transport`, while their original payload remains at
`event.detail.data`.

See the complete [`<web-socket>` API](docs/web-socket.md).

Interactive main-thread and Worker examples are available under
[`examples/`](examples/). The deployed site is
[`koseki2580.github.io/extended-html`](https://koseki2580.github.io/extended-html/).

## Development

Requirements:

- A supported Node.js release
- A local Google Chrome installation

Install the pinned development dependencies and run the unit, Pages-contract,
and real WebSocket Playwright suites:

```sh
npm install
npm test
```

Runtime source under `src/` has no third-party dependencies and requires no
compilation.

See [development and deployment](docs/development.md) for focused commands and
the GitHub Pages artifact contract.
