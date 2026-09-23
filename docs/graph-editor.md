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

The workspace Node navigator reports the total node and edge counts and keeps
every node available as a labelled button, including nodes currently outside
the canvas viewport. Activating a navigator button selects and reveals that
node. Its selected and directly connected states mirror the canvas, while the
navigator itself wraps to the available width rather than adding another
horizontal scrolling region.

The editor owns a self-contained dark color scheme so its native controls stay
readable when it is embedded in either a light or dark document. Host pages may
customize its published `--graph-*` color properties, but should provide a
complete foreground/background pair when overriding them. Unpositioned nodes
are initially arranged from left to right by graph dependency; saved
`data-graph-x` and `data-graph-y` coordinates continue to take precedence.

At narrow container widths the palette and inspector move around the workspace
as expandable trays instead of shrinking the graph controls. On desktop, long
palettes and inspectors scroll independently. The canvas itself remains scrollable,
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
| `registerFunction(name, fn, metadata?)` | Registers reviewed JavaScript for the Functions palette and returns an unregister callback. |
| `serialize()` | Returns the editor's current light-DOM HTML. |

Failed operations dispatch `error`, throw the original error from the public
method, and preserve the previous valid DOM.

## Function registry

`registerFunction(name, fn, { label?, description? })` makes an application
function available to one editor without requiring a `globalThis` assignment.
`name` uses the same identifier or dotted-path syntax as a handler reference,
and `fn` must be a function. Invalid names throw `SyntaxError`; non-functions
throw `TypeError`.

```js
const editor = document.querySelector("graph-editor");

const unregister = editor.registerFunction(
  "Recording.Measure",
  (event) => {
    console.log(event.detail.data);
    console.log(event.detail.metadata.sourceEvent);
  },
  {
    label: "Measure recording",
    description: "Reports the recorded Blob size",
  },
);
```

Registration is scoped to the receiving editor. Registering the same name
again replaces that editor's previous runtime function, which supports module
reload and application reconfiguration. The returned callback unregisters
only the registration it created, so calling an older callback cannot remove a
newer replacement. Calling the callback repeatedly is a no-op.

The function body and metadata are runtime state and are never serialized.
An action created from the example above stores only
`handler="Recording.Measure(event)"`. At execution time an editor-scoped
registration wins over a function with the same path on `globalThis`; the
existing global lookup remains as a backwards-compatible fallback. Missing
functions report a structured `ReferenceError` through the editor's `error`
event.

### Contextual creation workflow

The Add nodes panel groups adapter nodes, events exposed by the selected node,
and registered functions. Its search field filters every group by label, tag,
event name, function name, and description.

1. Select a source or processor. The panel enables only child node types that
   the active adapter accepts at that location.
2. Select a node that exposes events, then activate the required event button.
   The editor creates and selects the corresponding `<graph-event>`.
3. Select that event and activate a registered function. The editor creates a
   connected `<graph-action>` using the stable handler reference.

Unavailable operations remain keyboard-focusable with `aria-disabled` and a
visible reason. Activating one announces that reason near the panel instead of
attempting an invalid mutation. Mutation errors appear in the same polite
status region. Registered functions are also offered as native suggestions in
the selected action's handler field, while the text field continues to accept
legacy global references.

Searches with no matches offer a Clear search button. The advanced Action card
allows creating an action before entering a registered or legacy handler reference
in the Inspector. Invalid edits preserve the draft and show a field-specific error
while the graph retains its last valid value. Correcting the field clears the error.
Runtime and editing errors also appear below the editor, even when the trays are closed.

## Event and action nodes

`<graph-event>` turns an existing element event into a graph edge. Its `from`
attribute references a unique ID inside the editor and `type` names the source
event.

`<graph-action>` listens to one `<graph-event>` through `from`. `handler`
accepts only a function reference in the form `Handler(event)` or a dotted
path such as `Actions.Save(event)`. Resolution checks the containing editor's
registry before the legacy global scope. It never evaluates arbitrary
JavaScript.

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
Synchronous throws and rejected promises report the original error through the
editor. Rejections from actions that were removed or rewired are ignored; return
values are not routed to another node.

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
the graph markup. Prefer `editor.registerFunction()` so the function is scoped
to one editor and appears in its Functions palette. Existing applications may
continue exposing a named function through `globalThis`, connecting a
`<graph-action>` to a `<graph-event>`, and setting the action's `handler`
attribute to that function call. The editor Inspector edits the same attribute.

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
`disconnect`, `setProperty`, and `setPosition`. It may expose
`canAdd(root, localName, { parent })`, a side-effect-free capability query that
returns `{ allowed, reason }`; the editor uses it to explain contextual node
availability before mutation. Adapters without `canAdd` retain the existing
mutation-time validation. `read(root)` returns
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
