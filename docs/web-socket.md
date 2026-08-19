# `<web-socket>` API

`<web-socket>` wraps the browser WebSocket API as a custom element. The source
is a standard JavaScript ES module and does not require a build step.

## Import

Register every element exported by this repository:

```js
import "./src/index.js";
```

Register only `<web-socket>`:

```js
import "./src/web-socket/web-socket.js";
```

Both modules are safe to import together. The element is registered only once.

## Basic usage

```html
<web-socket
  url="wss://example.com/socket"
  auto
  background
  reconnect
  onopen="OnOpen(event)"
  onmessage="OnMessage(event)"
  onerror="OnError(event)"
  onclose="OnClose(event)"
></web-socket>

<script type="module">
  import "./src/index.js";
</script>

<script>
  function OnOpen(event) {
    console.log("connected", event.detail.data.url);
    console.log("transport", event.detail.metadata.transport);
  }

  function OnMessage(event) {
    console.log("received", event.detail.data);
  }

  function OnError(event) {
    console.error("socket error", event.detail.data);
  }

  function OnClose(event) {
    console.log("closed", event.detail.data);
  }
</script>
```

The `onopen` and `onmessage` attributes accept a globally accessible handler in
the form `Handler(event)` or `Namespace.Handler(event)`. Defining handlers with
a classic `function` declaration, as shown above, makes them globally
accessible. For module scripts, assign the handler to `globalThis` or use
`addEventListener()` instead.

## Attributes

### `url`

The WebSocket endpoint passed to the native `WebSocket` constructor. Calling
`open()` without a non-empty `url` throws `TypeError`.

Changing `url` does not interrupt an existing connection. The next explicit
connection or retry reads the current attribute value.

### `auto`

A boolean attribute. When present, the element calls `open()` when connected to
the document. A synchronous connection error is dispatched as the element's
`error` event because lifecycle callbacks have no direct caller to receive it.

### `reconnect`

A boolean attribute. When present, the element reconnects after the internal
WebSocket emits `close`. It does not reconnect after an explicit `close()` or
after removal from the document.

### `reconnect-delay`

An optional non-negative number of milliseconds used as a fixed retry delay:

```html
<web-socket reconnect reconnect-delay="2500"></web-socket>
```

Without this attribute, retries use exponential backoff:

```text
1s → 2s → 4s → 8s → 16s → 30s → 30s ...
```

A successful `open` event resets the next delay to one second. An invalid value
throws `RangeError` from an explicit `open()` call, or produces an `error` event
when connection is started by `auto`.

### `background`

A boolean attribute. When present, the element runs its WebSocket connection,
send, close, and reconnect work in a dedicated module Worker. The public methods
and events remain the same. Worker initialization failure produces an `error`
event and does not silently connect on the main thread.

The transport is fixed after the Worker reports that it is ready. A later Worker
failure produces an `error` event followed by an abnormal `close` event and does
not switch to the main thread.

### `fallback`

A boolean attribute that is valid only together with `background`. It opts into
main-thread fallback when Worker creation or module initialization fails:

```html
<web-socket background fallback url="wss://example.com/socket"></web-socket>
```

The Worker initialization error is dispatched before the main-thread connection
starts. Fallback is limited to failures before the Worker reports that it is
ready; WebSocket connection errors and later Worker failures do not change the
selected transport.

Using `fallback` without `background` throws `TypeError` from an explicit
`open()` call. With `auto`, the same configuration problem is reported through
the element's `error` event.

## Methods

### `open()`

Creates the internal WebSocket. Calling it while the socket is connecting or
open has no effect. Missing URLs, invalid retry configuration, and native
constructor errors in main-thread mode are thrown synchronously. Worker mode
starts asynchronously after its ready handshake, so errors created inside the
Worker are reported through `error` events.

The element emits `open` only when the native connection actually opens.

### `send(data)`

Passes `data` unchanged to the native WebSocket. It supports the same data types
as `WebSocket.send()` and performs no JSON serialization. Worker mode uses the
structured clone algorithm without a transfer list, so a caller-owned
`ArrayBuffer` is not detached.

Calling `send()` without an open connection throws a `DOMException` named
`InvalidStateError`.

### `close()`

Cancels a pending retry, prevents the current connection cycle from reconnecting,
and closes the internal WebSocket. Calling it while idle is safe. If the native
socket later emits `close`, that event is still wrapped and dispatched.

Removing the element from the document also cancels retries and closes the
internal socket. Later events from that removed or replaced socket are ignored.

## Events

Native WebSocket events are wrapped as non-bubbling, non-composed `CustomEvent`
instances with the same names.

| Event | `event.detail.data` |
| --- | --- |
| `open` | `{ url }` |
| `message` | The native `MessageEvent.data` value; structured-cloned in Worker mode |
| `error` | The native/caught error in main mode, or a clone-safe error description from Worker mode |
| `close` | `{ code, reason, wasClean }` |

Every event also identifies where its operation ran:

```js
socket.addEventListener("message", (event) => {
  console.log(event.detail.data);
  console.log(event.detail.metadata.transport); // "main" or "worker"
});
```

Fallback initialization errors have Worker transport metadata because the
failure happened while starting the Worker. Events from the connection created
after fallback have main transport metadata.

Besides inline attributes, normal event-handler properties and DOM listeners
are supported:

```js
const socket = document.querySelector("web-socket");

socket.onmessage = (event) => {
  console.log(event.detail.data);
};

socket.addEventListener("close", (event) => {
  console.log(event.detail.data.code);
});
```

When markup may contain untrusted input, do not expose sensitive global handler
functions through inline attributes. Prefer `addEventListener()` in applications
with a strict Content Security Policy.
