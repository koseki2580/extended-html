# Generic graph editor API

`<graph-editor>` is a visual editor for declarative custom-element graphs. The
editor view lives in an open shadow root, while its light-DOM children remain
the only source of truth. Removing the editor UI never converts the graph to a
private JSON format.

The first adapter supports `<audio-context>`. Other API families can register
an adapter without changing the editor element.

## Import and structure

```html
<script type="module" src="https://koseki2580.github.io/extended-html/src/graph/index.js"></script>

<graph-editor id="editor">
  <audio-context id="audio">
    <audio-input-mic id="mic">
      <audio-biquad-filter id="filter" frequency="120">
        <audio-output id="speaker"></audio-output>
      </audio-biquad-filter>
    </audio-input-mic>
  </audio-context>
</graph-editor>
```

The editor requires exactly one direct child whose tag has a registered graph
adapter. The Audio adapter preserves the normal nesting and `to` validation
rules. Presentation coordinates are stored as `data-graph-x` and
`data-graph-y`; they do not change Audio graph semantics.

The package export is `custom-html/graph-editor`. The aggregate `custom-html`
entry point also registers the editor, its Audio adapter, `<graph-event>`, and
`<graph-action>`.

## Editing

The built-in view has three regions:

- The palette adds root sources or adds a processor/output below the currently
  selected valid parent.
- The canvas selects and moves nodes. Dragging an output port onto an input
  port creates a cross-tree Audio `to` edge.
- The inspector edits adapter-declared attributes and rolls back invalid
  values.

The From/To controls provide a keyboard-accessible equivalent to port dragging.
All graph changes update the original light DOM. `serialize()` returns that
current HTML.

Selecting a canvas node emphasizes that node, its direct incoming and outgoing
nodes, and the edges between them. Other nodes remain available but are shown
with lower visual priority. The Inspector lists the selection's Inputs and
Outputs as native buttons; choosing one selects that related node and reveals
it in the scrollable canvas. A polite status message announces the selection
and relationship counts. These states belong only to the editor view and are
never written to the declarative graph or returned by `serialize()`.

The editor owns a self-contained dark color scheme so its native controls stay
readable when it is embedded in either a light or dark document. Host pages may
customize its published `--graph-*` color properties, but should provide a
complete foreground/background pair when overriding them. Unpositioned nodes
are initially arranged from left to right by graph dependency; saved
`data-graph-x` and `data-graph-y` coordinates continue to take precedence.

At narrow container widths the palette and inspector move around the workspace
instead of shrinking the graph controls. The canvas itself remains scrollable,
all interactive controls provide at least a 44 by 44 CSS-pixel target, and the
same connect/disconnect operation remains available without dragging.

The public mutation methods are:

| Method | Result |
| --- | --- |
| `addNode(localName, { parent? })` | Adds a supported node and returns its element. |
| `removeNode(element)` | Removes a node and dangling `to` references. |
| `connect(from, to)` | Adds a validated cross-tree edge. |
| `disconnect(from, to)` | Removes a cross-tree edge. |
| `setProperty(element, name, value)` | Applies an adapter or orchestration attribute transactionally. |
| `addEvent(source, type)` | Adds a `<graph-event>` for a source event. |
| `addAction(event, handler?)` | Adds a `<graph-action>` for a graph event. |
| `serialize()` | Returns the editor's current light-DOM HTML. |

Failed operations dispatch `error`, throw the original error from the public
method, and preserve the previous valid DOM.

## Event and action nodes

`<graph-event>` turns an existing element event into a graph edge. Its `from`
attribute references a unique ID inside the editor and `type` names the source
event.

`<graph-action>` listens to one `<graph-event>` through `from`. `handler`
accepts only a global function call in the form `Handler(event)` or a dotted
path such as `Actions.Save(event)`. It never evaluates arbitrary JavaScript.

```html
<graph-editor>
  <audio-context>
    <audio-input-mic>
      <audio-stream-output>
        <media-recorder id="recorder"></media-recorder>
      </audio-stream-output>
    </audio-input-mic>
  </audio-context>

  <graph-event
    id="chunk-ready"
    from="recorder"
    type="dataavailable"
  ></graph-event>
  <graph-action
    from="chunk-ready"
    handler="SaveChunk(event)"
  ></graph-action>
</graph-editor>

<script>
  globalThis.SaveChunk = (event) => {
    console.log(event.detail.data);
    console.log(event.detail.metadata.sourceEvent);
  };
</script>
```

If the source event already uses `event.detail.data` and
`event.detail.metadata`, both are preserved. A native `MessageEvent` contributes
its `data`; another raw event is passed as data itself. The bridge adds
`sourceId`, `sourceEvent`, and `eventId` metadata. The action first dispatches a
`run` event with the same detail and then calls the configured handler.

Invalid attribute rewiring reports `error` and keeps the last working listener.
Removing either orchestration element detaches its listeners.

## Editor events

Every editor event uses the repository envelope:

```js
editor.addEventListener("nodeadd", (event) => {
  console.log(event.detail.data);
  console.log(event.detail.metadata.operation);
});
```

The editor dispatches `ready`, `change`, `nodeadd`, `noderemove`, `nodechange`,
`edgeconnect`, `edgedisconnect`, and `error`. Specific mutation events and the
generic `change` event share the same detail object. `error` places the Error or
DOMException in `event.detail.data`.

## Application handler workflow

Application-specific processing stays in normal JavaScript rather than inside
the graph markup. Expose a named function through `globalThis`, connect a
`<graph-action>` to a `<graph-event>`, and set the action's `handler` attribute
to that function call. The editor Inspector edits the same attribute.

```js
globalThis.CustomHandlers = {
  Measure(event) {
    const blob = event.detail.data;
    console.log(blob.size, event.detail.metadata.sourceEvent);
  },
};
```

```html
<graph-event id="chunk-ready" from="recorder" type="dataavailable"></graph-event>
<graph-action
  id="measure-chunk"
  from="chunk-ready"
  handler="CustomHandlers.Measure(event)"
></graph-action>
```

The handler value is a reference, not a JavaScript body. The editor never uses
`eval` or `new Function`; arbitrary implementation code remains reviewable in
the imported module. The runnable [custom handler example](https://koseki2580.github.io/extended-html/examples/graph-editor/custom-handler.html)
also demonstrates adding a second action through the visual editor.

## Adapter contract

`registerGraphAdapter(rootName, adapter)` registers a direct-root tag. An
adapter exposes `nodeTypes` plus `read`, `addNode`, `removeNode`, `connect`,
`disconnect`, `setProperty`, and `setPosition`. `read(root)` returns
`{ root, nodes, edges }`; descriptors contain their backing `element`, stable
`id`, `nodeName`, `kind`, `label`, editable `properties`, exposed `events`, and
presentation `position`.

Adapters own domain validation and transactional rollback. The editor owns
only the generic UI and mutation event envelope.

## Current boundaries

The shipped adapter edits Audio graphs only. It does not persist a second JSON
document, generate application code, or synchronize multiple editors.
Draw.io embedding is a possible future adapter/view, not a dependency or part
of this contract.
