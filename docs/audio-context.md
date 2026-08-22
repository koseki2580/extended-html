# Declarative Audio graph API

The Audio custom elements expose a focused subset of the browser Web Audio and
HTML media APIs as a declarative graph. They are standard JavaScript ES modules
and require no framework or runtime build step.

## Import

Register every element exported by this package:

```js
import "extended-html";
```

Register only the Audio elements:

```js
import "extended-html/audio-context";
```

Both entry points are safe to import together. They register exactly these five
tags, and each definition is guarded against duplicate registration:

- `<audio-context>`
- `<audio-input-mic>`
- `<audio-input-file>`
- `<audio-biquad-filter>`
- `<audio-output>`

## Basic graph

Nesting defines the primary edge from each recognized audio element to each of
its direct audio children:

```html
<audio-context id="audio">
  <audio-input-file src="./music.mp3">
    <audio-biquad-filter type="lowpass" frequency="1200">
      <audio-output></audio-output>
    </audio-biquad-filter>
  </audio-input-file>
</audio-context>

<button id="start" type="button">Start audio</button>

<script type="module">
  import "extended-html/audio-context";

  const audio = document.querySelector("#audio");
  start.addEventListener("click", () => audio.resume());
</script>
```

Deeper nesting forms a serial chain. Direct processor or output siblings form
a fan-out and receive the same parent output concurrently:

```html
<audio-input-file src="./music.mp3">
  <audio-biquad-filter type="lowpass">
    <audio-output></audio-output>
  </audio-biquad-filter>
  <audio-biquad-filter type="highpass">
    <audio-output></audio-output>
  </audio-biquad-filter>
</audio-input-file>
```

## Graph structure and `to`

Each `<audio-context>` owns an isolated graph and ID scope. The following
structural rules are validated before the first native `AudioContext` or audio
node is created:

- A direct child of `<audio-context>` must be `<audio-input-file>` or
  `<audio-input-mic>`. These elements are the graph's root sources.
- A processor or output must be a direct child of another recognized audio
  node. Ordinary HTML wrappers cannot appear inside an audio path.
- `<audio-output>` is a sink: it cannot contain audio graph elements or declare
  a non-empty `to` attribute.
- Unknown `audio-*` elements are invalid.
- Every non-empty `id` in the context scope must be unique, including IDs on
  ordinary elements. Nested `<audio-context>` trees have separate scopes.
- The resulting graph must be acyclic.

The optional `to` attribute adds edges to an existing nested structure. It is
intended for merging two root source trees without flattening the markup:

```html
<audio-context id="audio">
  <audio-input-mic to="mix"></audio-input-mic>
  <audio-input-file src="./bed.mp3">
    <audio-biquad-filter id="mix">
      <audio-output></audio-output>
    </audio-biquad-filter>
  </audio-input-file>
</audio-context>
```

`to` accepts one or more whitespace-separated IDs. A target must exist in the
same nearest `<audio-context>`, must be a processor or output, and must belong
to a different root source tree. A source, a same-tree node, a node in another
context, or an ID that exists only outside the context is not a valid target.
Duplicate logical edges are applied only once.

Invalid structure, IDs, configuration, and targets reject the triggering
`resume()` call with a `DOMException` named `SyntaxError`. A cycle rejects with
`InvalidStateError`. No native resources are created when the initial graph is
invalid.

## Context lifecycle

Audio has no `auto` attribute and file inputs do not expose `autoplay`.
Playback therefore begins only after application code calls `resume()`, which
should normally happen from a user gesture required by browser autoplay rules.

### `resume()`

On the first call, `resume()` validates the complete graph and configuration,
creates the native graph, resumes its `AudioContext`, and activates every root
source sequentially in source DOM order. Once activated, the sources remain
running concurrently. This means microphone permission and file playback for
an earlier source complete before the next source is started.

After `suspend()`, another `resume()` reactivates every source in DOM order. If
the native context was interrupted while the graph remained active, `resume()`
resumes the native context without replaying the sources. Concurrent calls for
the same pending lifecycle operation share one promise, and alternating
lifecycle calls run in call order.

### `suspend()`

`suspend()` pauses file inputs, disables every microphone track, and suspends
the native context. Sources are suspended in reverse DOM order. The graph and
its resources remain resumable.

### `close()` and removal

`close()` is terminal. It pauses file inputs, stops microphone tracks,
disconnects the graph, releases owned nodes, and closes the native context.
Sources are closed in reverse DOM order. Repeated calls share the same promise;
subsequent `resume()` and `suspend()` calls reject with `InvalidStateError`.

Removing `<audio-context>` from the document performs the same terminal cleanup.
Removing it while `resume()` is in flight prevents later sources from starting
and releases resources acquired by that operation.

### Context state

Before native creation, `state` is `"suspended"`, `currentTime` is `0`, and
`sampleRate` is `null`. Afterwards these properties proxy the native
`AudioContext`. Native state changes dispatch `statechange`; lifecycle and
reconciliation failures dispatch `error`. The component does not synthesize a
successful state change when the native API did not emit one.

## Sources

### `<audio-input-file>`

Each file input owns one internal `HTMLAudioElement` and creates at most one
`MediaElementAudioSourceNode` for its native context. It cannot be reused with a
different native context.

The following HTML media attributes are reflected to the internal element:

- `src`
- `loop`
- `muted`
- `preload`
- `crossorigin` through the `crossOrigin` property

The element proxies writable `src`, `loop`, `muted`, `preload`, `crossOrigin`,
`volume`, `currentTime`, and `playbackRate` properties. It exposes read-only
`duration`, `paused`, `ended`, and `readyState`, and delegates `play()`,
`pause()`, and `load()` to the internal media element. Neither `controls` nor
`autoplay` is exposed. Context `resume()` calls `play()`; `suspend()` and
`close()` call `pause()`.

Standard media event names are redispatched through the event envelope below:
`abort`, `canplay`, `canplaythrough`, `durationchange`, `emptied`, `ended`,
`error`, `loadeddata`, `loadedmetadata`, `loadstart`, `pause`, `play`, `playing`,
`progress`, `ratechange`, `seeked`, `seeking`, `stalled`, `suspend`,
`timeupdate`, `volumechange`, and `waiting`. Their `event.detail.data` is the
native media event.

### `<audio-input-mic>`

Context `resume()` requests `navigator.mediaDevices.getUserMedia({ audio: true })`
and connects the resulting `MediaStreamAudioSourceNode` before dispatching
`open`. Suspending disables all owned tracks; resuming re-enables live tracks.
If every previous track has ended, the next resume acquires a new stream.
Terminal close stops all tracks, disconnects the source, and dispatches `close`.

The mic element deliberately has no public `open()` or `close()` methods;
`<audio-context>` owns source lifecycle. Acquisition and native-node creation
failures dispatch `error` and reject `resume()`. A stream acquired during a
failing or cancelled activation is released.

## Processing and output

### `<audio-biquad-filter>`

The filter maps to one `BiquadFilterNode`. It accepts the native filter types
`lowpass`, `highpass`, `bandpass`, `lowshelf`, `highshelf`, `peaking`, `notch`,
and `allpass`.

| Attribute | Default | JavaScript property |
| --- | ---: | --- |
| `type` | `lowpass` | `type` |
| `frequency` | `350` | `frequency` (`AudioParam`) |
| `detune` | `0` | `detune` (`AudioParam`) |
| `q` | `1` | `Q` (`AudioParam`) |
| `gain` | `0` | `gain` (`AudioParam`) |

Numeric attributes must contain finite numbers. After native creation,
`frequency`, `detune`, `Q`, and `gain` return the native `AudioParam` objects,
so imperative parameter automation remains available. Reading one before the
node exists throws `InvalidStateError`. A filter cannot be reused with a
different native context.

Observed attribute changes are validated and applied transactionally by the
owning context. Removing an attribute restores its documented default.

### `<audio-output>`

The output resolves to the owning native context's `destination`. It has no
independent start, suspend, or close behavior and is valid only as a sink.

## Events and handlers

Audio events are non-bubbling, non-composed `CustomEvent` instances. They use a
consistent envelope:

```js
element.addEventListener("error", (event) => {
  console.error(event.detail.data);
  console.log(event.detail.metadata.contextId);
  console.log(event.detail.metadata.nodeId);
  console.log(event.detail.metadata.nodeName);
});
```

`metadata` contains `contextId`, `nodeId`, and `nodeName`; missing IDs are
represented by `null`. Context `statechange` carries the native event as data,
context `error` carries the caught error, mic `open` and `close` carry the
stream, mic `error` carries the caught error, and file events carry their native
media event.

Normal listener properties and `addEventListener()` are supported. Declarative
attributes accept only `Handler(event)` or one-segment `Namespace.Handler(event)`:

```html
<audio-input-mic
  onopen="AudioHandlers.OnOpen(event)"
  onerror="AudioHandlers.OnError(event)"
></audio-input-mic>
```

The named value must resolve to a global function when the event runs. Arbitrary
inline JavaScript and deeper property paths are rejected. Module code can
publish the namespace through `globalThis`, or use `addEventListener()` instead.
Do not expose sensitive globals to untrusted markup; listener registration is
preferable under a strict Content Security Policy.

## Live graph reconciliation

After initial activation, the context observes graph child changes and changes
to `id`, `to`, and Biquad configuration attributes. Same-turn mutations are
batched. A valid candidate graph is applied transactionally: replacement edges
are added before obsolete edges are removed, newly added sources start in the
candidate DOM order when the context is running, unchanged sources keep
running, and removed sources are terminally closed.

An invalid or stale candidate is not committed. Candidate-only resources and
configuration changes are rolled back and the last valid graph keeps running.
Invalid candidates dispatch `error`; stale candidates superseded by a newer DOM
state are discarded without reporting a transient failure. Later valid
mutations can recover without recreating the existing graph. Imperative
`AudioParam` values are preserved by unrelated DOM reconciliation.

## Errors and security boundaries

- Web Audio unavailability rejects initial `resume()` with `NotSupportedError`.
- Calls after terminal close reject with `InvalidStateError`.
- Native media playback, permission, context, node creation, connection, and
  cleanup errors reject the responsible lifecycle call where applicable and
  are also reported through the relevant `error` event.
- The implementation requests only `{ audio: true }`; markup cannot provide
  device constraints or select a microphone.
- Audio starts only through explicit JavaScript, so markup alone cannot bypass
  browser user-activation, permission, autoplay, or media-origin policies.

## Deferred Audio APIs

The current contract intentionally does not include gain, analyser, oscillator,
delay or feedback helpers, channel splitter/merger or indexed ports, compressor,
convolver, panner, buffer source, media-stream destination, declarative
`AudioParam` automation markup, `AudioWorklet`, `OfflineAudioContext`, or
microphone device constraints. Unknown `audio-*` tags remain invalid until an
explicit contract is added.
