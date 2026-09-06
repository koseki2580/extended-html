# `<event-source>` API

`<event-source>` wraps the browser EventSource API as a build-free custom
element for receiving Server-Sent Events over HTTP.

## Import

Register every element:

```js
import "./src/index.js";
```

Register only `<event-source>`:

```js
import "./src/event-source/event-source.js";
```

## Basic usage

```html
<event-source
  url="https://example.com/events"
  auto
  onopen="OnOpen(event)"
  onmessage="OnMessage(event)"
  onerror="OnError(event)"
></event-source>
```

Declarative handlers must call a global function with `event`. Event-handler
properties and `addEventListener()` are also supported.

## Attributes

### `url`

The endpoint passed to native `EventSource`. An explicit `open()` without a
non-empty URL throws `TypeError`. Changing it does not replace an active
connection; close and open the element to use the new value.

### `auto`

Calls `open()` when the element is connected to the document. Synchronous
startup failures are reported through `error` because a lifecycle callback has
no caller to receive them.

### `with-credentials`

Passes `{ withCredentials: true }` to native `EventSource`. It applies when a
new native source is created and is exposed through `withCredentials`.

### `background`

Runs native EventSource in a dedicated module Worker. The public events,
methods, and properties remain the same. Worker initialization failure emits
`error` with Worker transport metadata and does not silently change transport.

### `fallback`

Valid only with `background`. It explicitly permits main-thread fallback when
Worker creation or module initialization fails. Runtime Worker failures and
EventSource connection errors never switch transport automatically.

## Methods and properties

### `open()`

Creates a native EventSource unless one is already connecting or open. Native
EventSource begins connecting from its constructor. Calls made while active are
idempotent.

### `close()`

Calls native `close()`, stops browser-managed reconnection, and leaves the
wrapper in `CLOSED`. Calling it while idle is safe. Removing the element from
the document also closes and disposes it; late events are ignored.

### `readyState`, `url`, and `withCredentials`

`readyState` uses the native EventSource constants: `CONNECTING` (`0`), `OPEN`
(`1`), and `CLOSED` (`2`). `url` is the resolved native URL after startup and
otherwise reflects the configured attribute. `withCredentials` reflects the
boolean configuration used for the next connection.

## Events

Native events are wrapped as non-bubbling, non-composed `CustomEvent` objects.

| Event | `event.detail.data` | Additional metadata |
| --- | --- | --- |
| `open` | `{ url }` | `transport` |
| `message` | Native text data | `transport`, `origin`, `lastEventId` |
| `error` | `{ readyState }` | `transport` |

EventSource has no native `close` event, so the wrapper does not invent one.

## Native reconnection

The browser owns EventSource reconnection, including server `retry` fields and
the `Last-Event-ID` request header. `<event-source>` intentionally has no
`reconnect` or delay attribute. Explicit `close()` and DOM removal stop that
native reconnection cycle.

This version wraps the standard default `message` event. Server-defined named
events are reserved for a future API contract.
