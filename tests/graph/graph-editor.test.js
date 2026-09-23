import "../../src/audio/index.js";
import "../../src/graph/index.js";
import { registerGraphAdapter } from "../../src/graph/graph-adapters.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const nextTask = () => new Promise((resolve) => setTimeout(resolve));
const waitForLayout = () => new Promise((resolve) => setTimeout(resolve, 50));

const createEditor = () => {
  const editor = document.createElement("graph-editor");
  editor.innerHTML = `
    <audio-context id="audio">
      <audio-input-mic id="mic">
        <audio-biquad-filter id="filter" frequency="440">
          <audio-output id="speaker"></audio-output>
          <audio-stream-output id="stream">
            <media-recorder id="recorder"></media-recorder>
          </audio-stream-output>
        </audio-biquad-filter>
      </audio-input-mic>
    </audio-context>
    <graph-event id="chunk" from="recorder" type="dataavailable"></graph-event>
    <graph-action id="save" from="chunk" handler="SaveChunk(event)"></graph-action>
  `;
  document.body.append(editor);
  return editor;
};

afterEach(() => {
  document.querySelectorAll("graph-editor").forEach((element) => element.remove());
});

describe("graph-editor", () => {
  it("leaves creation validation to adapters without a capability query", async () => {
    registerGraphAdapter("custom-test-graph", {
      nodeTypes: [{ localName: "custom-step", kind: "processor", label: "Custom step" }],
      read: (root) => ({ root, nodes: [...root.children].map((element) => ({
        element, id: element.id, nodeName: element.localName, kind: "processor",
        label: "Custom step", properties: [], events: [], position: {},
      })), edges: [] }),
      addNode(root, name) {
        const node = document.createElement(name);
        node.id = "custom-step-1";
        root.append(node);
        return node;
      },
      removeNode() {}, connect() {}, disconnect() {}, setProperty() {}, setPosition() {},
    });
    const editor = document.createElement("graph-editor");
    editor.innerHTML = "<custom-test-graph></custom-test-graph>";
    document.body.append(editor);
    await nextTask();
    const button = editor.shadowRoot.querySelector('[data-add-node="custom-step"]');
    button.click();
    await nextTask();
    assert(editor.querySelector("custom-test-graph > custom-step"), "a custom adapter can create a root processor");
  });
  it("renders an accessible palette, graph nodes, edges, and inspector", async () => {
    const editor = createEditor();
    await nextTask();

    const shadow = editor.shadowRoot;
    assert(shadow, "the editor uses an encapsulated view");
    assert(shadow.querySelector('[aria-label="Graph node palette"]'), "palette is labelled");
    assert(shadow.querySelector('[data-node-id="mic"]'), "audio node is rendered");
    assert(shadow.querySelector('[data-node-id="chunk"]'), "event node is rendered");
    assert(shadow.querySelector('[data-node-id="save"]'), "action node is rendered");
    assertEqual(
      shadow.querySelectorAll("path[data-edge-index]").length,
      6,
      "all edge types are drawn",
    );
    assert(shadow.querySelector('[aria-label="Graph node inspector"]'), "inspector is labelled");
    assert(
      shadow.querySelector('[data-palette-group="functions"] .palette-empty')?.textContent.includes("registerFunction"),
      "the empty Functions group explains how application functions become available",
    );
    const addToggle = shadow.querySelector('[data-toggle-panel="palette"]');
    const inspectorToggle = shadow.querySelector('[data-toggle-panel="inspector"]');
    assert(addToggle && inspectorToggle, "mobile users can collapse secondary panels");
    assertEqual(addToggle.getAttribute("aria-expanded"), "false", "the add tray starts compact");
    assertEqual(
      inspectorToggle.getAttribute("aria-expanded"),
      "false",
      "the selection drawer starts compact",
    );
    addToggle.click();
    assertEqual(addToggle.getAttribute("aria-expanded"), "true", "the add tray can expand");
    assert(addToggle.textContent.includes("ready"), "the collapsed palette distinguishes usable items from all shown items");
  });

  it("explains invalid initial markup inside the editor and recovers after a root is added", async () => {
    const editor = document.createElement("graph-editor");
    document.body.append(editor);
    await nextTask();
    const alert = editor.shadowRoot.querySelector('[role="alert"]');
    assert(alert?.textContent.includes("one direct"), "a missing root has a visible recovery instruction");
    editor.innerHTML = '<audio-context id="new-audio"><audio-input-file id="file"></audio-input-file></audio-context>';
    await nextTask();
    assert(editor.shadowRoot.querySelector('[data-node-id="file"]'), "adding the root recovers the editor");
  });

  it("assigns persistent ids when source markup omits graph node ids", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = `
      <audio-context>
        <audio-input-mic><audio-output></audio-output></audio-input-mic>
      </audio-context>
    `;
    document.body.append(editor);
    await nextTask();

    const ids = [...editor.querySelectorAll("audio-input-mic, audio-output")].map(
      (element) => element.id,
    );
    assert(ids.every(Boolean), "every visual node receives an id");
    assertEqual(new Set(ids).size, ids.length, "generated ids are unique");
    assert(editor.serialize().includes(`id="${ids[0]}"`), "ids persist in source HTML");
  });

  it("adds a source from the palette and publishes wrapped mutation data", async () => {
    const editor = createEditor();
    await nextTask();
    let mutation;
    editor.addEventListener("nodeadd", (event) => {
      mutation = event.detail;
    });

    editor.shadowRoot
      .querySelector('[data-add-node="audio-input-file"]')
      .click();
    await nextTask();

    const added = editor.querySelector("audio-context > audio-input-file");
    assert(added?.id, "a stable id is assigned");
    assertEqual(mutation.data, added, "mutation data exposes the added element");
    assertEqual(mutation.metadata.operation, "add", "operation metadata is included");
    assert(editor.serialize().includes("<audio-input-file"), "serialized HTML reflects DOM");
  });

  it("registers reviewed functions without serializing their implementation", async () => {
    const editor = createEditor();
    await nextTask();
    const calls = [];
    const errors = [];
    editor.addEventListener("error", (event) => errors.push(event.detail.data));

    const unregister = editor.registerFunction("SaveChunk", (event) => {
      calls.push(event.detail.data);
    }, { label: "Save recording" });
    editor.querySelector("#chunk").dispatchEvent(new CustomEvent("data", {
      detail: { data: "first", metadata: {} },
    }));

    assertEqual(calls.join(","), "first", "the action uses the editor registration");
    assert(!editor.serialize().includes("Save recording"), "runtime metadata is not serialized");
    assert(!editor.serialize().includes("calls.push"), "the function body is not serialized");

    unregister();
    unregister();
    editor.querySelector("#chunk").dispatchEvent(new CustomEvent("data", {
      detail: { data: "second", metadata: {} },
    }));
    assertEqual(calls.join(","), "first", "cleanup stops scoped execution");
    assert(errors.at(-1) instanceof ReferenceError, "missing cleanup target reports an error");
  });

  it("adds explicit events and registered functions from a searchable contextual palette", async () => {
    const editor = createEditor();
    editor.registerFunction("CustomHandlers.Audit", () => {}, {
      label: "Audit recording",
      description: "Records delivery metadata",
    });
    await nextTask();
    const shadow = editor.shadowRoot;
    const search = shadow.querySelector('[type="search"][data-palette-search]');
    assert(search, "the add panel has a native search field");

    const filterButton = shadow.querySelector('[data-add-node="audio-biquad-filter"]');
    assertEqual(filterButton.getAttribute("aria-disabled"), "true", "invalid children are disabled");
    filterButton.click();
    assert(
      shadow.querySelector("[data-palette-status]").textContent.includes("Select"),
      "an unavailable operation explains its prerequisite",
    );

    search.value = "audit";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));
    assertEqual(
      shadow.querySelector('[data-add-function="CustomHandlers.Audit"]').hidden,
      false,
      "function metadata participates in search",
    );
    assertEqual(
      shadow.querySelector('[data-add-node="audio-input-mic"]').hidden,
      true,
      "unmatched nodes are filtered",
    );
    search.value = "";
    search.dispatchEvent(new InputEvent("input", { bubbles: true }));

    shadow.querySelector('[data-node-id="recorder"] .node-select').click();
    await nextTask();
    const eventButton = shadow.querySelector('[data-add-event="dataavailable"]');
    assert(eventButton, "the selected node exposes each declared event explicitly");
    eventButton.click();
    await nextTask();
    await waitForLayout();
    const addedEvent = [...editor.querySelectorAll(":scope > graph-event")].at(-1);
    assertEqual(addedEvent.getAttribute("type"), "dataavailable", "the chosen event is retained");
    assertEqual(
      shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId,
      addedEvent.id,
      "focus follows the created event",
    );

    const functionButton = shadow.querySelector('[data-add-function="CustomHandlers.Audit"]');
    assertEqual(functionButton.getAttribute("aria-disabled"), "false", "functions accept events");
    functionButton.click();
    await nextTask();
    await waitForLayout();
    const addedAction = [...editor.querySelectorAll(":scope > graph-action")].at(-1);
    assertEqual(
      addedAction.getAttribute("handler"),
      "CustomHandlers.Audit(event)",
      "one activation stores the stable function reference",
    );
    assertEqual(
      addedAction.getAttribute("from"),
      addedEvent.id,
      "the action is connected to the selected event",
    );
    assertEqual(
      shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId,
      addedAction.id,
      "focus follows the created action",
    );
  });

  it("keeps an invalid advanced handler draft beside an actionable field error", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-node-id="save"] .node-select').click();
    await nextTask();
    const handler = shadow.querySelector('[data-property="handler"]');
    handler.focus();
    handler.value = "alert('unsafe')";
    handler.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTask();

    const invalid = shadow.querySelector('[data-property="handler"]');
    assertEqual(shadow.activeElement, invalid, "invalid editing retains focus after queued rendering");
    assertEqual(invalid.value, "alert('unsafe')", "the rejected draft remains editable");
    assertEqual(invalid.getAttribute("aria-invalid"), "true", "the field exposes invalid state");
    const message = shadow.getElementById(invalid.getAttribute("aria-errormessage"));
    assert(message?.textContent.includes("global function"), "the error gives a recovery hint");
    assertEqual(
      editor.querySelector("#save").getAttribute("handler"),
      "SaveChunk(event)",
      "the last valid graph value is preserved",
    );
    invalid.value = "Actions.Fixed(event)";
    invalid.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTask();
    const corrected = shadow.querySelector('[data-property="handler"]');
    assertEqual(corrected.getAttribute("aria-invalid"), "false", "correction clears the error");
    assertEqual(shadow.activeElement, corrected, "correction keeps keyboard focus in the Inspector");
  });

  it("explains runtime failures inside the editor even when the add tray is closed", async () => {
    const editor = createEditor();
    editor.registerFunction("SaveChunk", () => { throw new Error("Storage unavailable"); });
    await nextTask();
    editor.querySelector("#chunk").dispatchEvent(new CustomEvent("data", {
      detail: { data: "blob", metadata: {} },
    }));
    const status = editor.shadowRoot.querySelector("[data-editor-status]");
    assert(status?.textContent.includes("Storage unavailable"), "runtime errors are visible in the editor");
    assert(status.textContent.includes("save"), "the message identifies the failing node");
  });

  it("offers legacy actions and registered suggestions with a recoverable search empty state", async () => {
    const editor = createEditor();
    editor.registerFunction("Process", () => {}, { label: "Process data" });
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-node-id="chunk"] .node-select').click();
    shadow.querySelector('[data-action="add-action"]').click();
    await nextTask();
    const input = shadow.querySelector('[data-property="handler"]');
    assert(input.list?.querySelector('option[value="Process(event)"]'), "registered handlers are suggested");
    const search = shadow.querySelector("[data-palette-search]");
    search.value = "no-such-node";
    search.dispatchEvent(new Event("input", { bubbles: true }));
    assert(!shadow.querySelector("[data-search-empty]").hidden, "no results offers a recovery path");
    shadow.querySelector('[data-action="clear-search"]').click();
    assertEqual(search.value, "", "clear search restores choices");
  });

  it("edits selected node properties through the inspector", async () => {
    const editor = createEditor();
    await nextTask();
    editor.shadowRoot.querySelector('[data-node-id="filter"]').click();
    const input = editor.shadowRoot.querySelector('[data-property="frequency"]');
    assert(input, "selected filter exposes its frequency");
    input.value = "880";
    input.dispatchEvent(new Event("change", { bubbles: true }));
    await nextTask();

    assertEqual(editor.querySelector("#filter").getAttribute("frequency"), "880", "DOM is updated");
  });

  it("shows the selected node, its direct relationships, and active edges", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    const sourceBeforeSelection = editor.serialize();

    shadow.querySelector('[data-node-id="filter"] .node-select').click();
    await nextTask();

    assertEqual(
      shadow.querySelector('[data-node-id="filter"]').dataset.relation,
      "selected",
      "the clicked node is identified as selected",
    );
    for (const id of ["mic", "speaker", "stream"]) {
      assertEqual(
        shadow.querySelector(`[data-node-id="${id}"]`).dataset.relation,
        "connected",
        `${id} is identified as directly connected`,
      );
    }
    assertEqual(
      shadow.querySelector('[data-node-id="recorder"]').dataset.relation,
      "unrelated",
      "a node beyond the direct relationship is de-emphasized",
    );
    assertEqual(
      shadow.querySelectorAll('path[data-relation="connected"]').length,
      3,
      "only edges touching the selection are emphasized",
    );
    assertEqual(
      shadow.querySelector('[data-selection-status]').textContent.trim(),
      "Biquad filter selected. 1 input, 2 outputs.",
      "the selection summary is available to assistive technology",
    );
    assertEqual(
      editor.serialize(),
      sourceBeforeSelection,
      "selection context stays out of the portable graph",
    );
  });

  it("navigates between connected nodes from the Inspector", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;

    shadow.querySelector('[data-node-id="filter"] .node-select').click();
    await nextTask();
    assert(shadow.querySelector('[data-related-id="mic"]'), "the input relationship is listed");
    const output = shadow.querySelector('[data-related-id="stream"]');
    assert(output, "the output relationship is listed");
    output.click();
    await nextTask();
    await waitForLayout();

    assertEqual(
      shadow.querySelector('[data-node-id="stream"]').dataset.relation,
      "selected",
      "the related node becomes selected",
    );
    assertEqual(
      shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId,
      "stream",
      "keyboard focus follows Inspector navigation",
    );
  });

  it("keeps every graph node discoverable and reachable from the workspace navigator", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    const sourceBeforeNavigation = editor.serialize();

    const navigator = shadow.querySelector('[aria-label="Graph node navigator"]');
    assert(navigator, "the workspace exposes a labelled node navigator");
    assertEqual(
      navigator.querySelector('[data-graph-stats]').textContent.trim(),
      "7 nodes · 6 edges",
      "the navigator summarizes graph size",
    );
    assertEqual(
      navigator.querySelectorAll('[data-navigate-node]').length,
      7,
      "every model node has one navigation button",
    );

    navigator.querySelector('[data-navigate-node="filter"]').click();
    await nextTask();
    assertEqual(
      shadow.querySelector('[data-navigate-node="filter"]').getAttribute("aria-pressed"),
      "true",
      "the selected node is reflected in the navigator",
    );
    assertEqual(
      shadow.querySelector('[data-navigate-node="mic"]').dataset.relation,
      "connected",
      "direct relationships are reflected in the navigator",
    );
    assert(
      shadow.querySelector('[data-navigate-node="mic"]').textContent.includes("Connected"),
      "relationship meaning is visible without relying on color",
    );
    assert(
      shadow.querySelector('[data-navigate-node="mic"]').getAttribute("aria-label")
        .includes("Connected to selected node"),
      "relationship meaning is included in the accessible name",
    );

    shadow.querySelector('[data-navigate-node="save"]').click();
    await nextTask();
    await waitForLayout();
    assertEqual(
      shadow.querySelector('[data-node-id="save"]').dataset.relation,
      "selected",
      "an off-screen node becomes the canvas selection",
    );
    assertEqual(
      shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId,
      "save",
      "focus follows navigator activation to the canvas node",
    );
    assertEqual(editor.serialize(), sourceBeforeNavigation, "navigation is view-only");
  });

  it("keeps the drawing area usable and navigation position stable in a large graph", async () => {
    const editor = createEditor();
    let source = "save";
    for (let index = 0; index < 26; index += 1) {
      const action = document.createElement("graph-action");
      action.id = `step-${index}`;
      action.setAttribute("from", source);
      action.setAttribute("handler", "Step(event)");
      editor.append(action);
      source = action.id;
    }
    await nextTask();
    await waitForLayout();
    const shadow = editor.shadowRoot;
    const canvas = shadow.querySelector(".canvas");
    let navigator = shadow.querySelector(".navigator-list");
    assert(canvas.clientHeight >= 240, "large navigation does not collapse the canvas");
    assert(navigator.scrollHeight > navigator.clientHeight, "the navigator scrolls within a bounded region");
    const overviewButton = shadow.querySelector('[data-navigator-view="overview"]');
    assert(overviewButton, "large graphs expose a whole-graph overview");
    overviewButton.click();
    assertEqual(overviewButton.getAttribute("aria-pressed"), "true", "the overview is selected");
    assertEqual(shadow.querySelector(".overview-map").hasAttribute("hidden"), false, "the SVG overview actually becomes visible");
    overviewButton.focus();
    editor.registerFunction("Workspace.OverviewFocus", () => {});
    await nextTask();
    await waitForLayout();
    assertEqual(shadow.activeElement?.dataset.navigatorView, "overview", "overview toggle retains focus after redraw");
    assertEqual(shadow.querySelectorAll(".overview-map [data-overview-edge]").length, 32, "the overview shows all connections");
    assert(shadow.querySelector(".canvas").clientHeight >= 240, "opening the overview keeps the canvas usable");
    shadow.querySelector('[data-navigator-view="nodes"]').click();
    navigator = shadow.querySelector(".navigator-list");
    navigator.scrollTop = navigator.scrollHeight;
    const navBefore = navigator.scrollTop;
    shadow.querySelector(".canvas").scrollLeft = 250;
    editor.registerFunction("Workspace.Review", () => {});
    await nextTask();
    assert(shadow.querySelector(".navigator-list").scrollTop >= navBefore - 2, "navigation scroll survives redraw");
    assertEqual(shadow.querySelector(".canvas").scrollLeft, 250, "canvas viewport survives unrelated redraw");
  });

  it("returns keyboard focus from a distant canvas node to its navigator entry", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-navigate-node="save"]').click();
    await nextTask();
    const selected = shadow.querySelector('[data-node-id="save"] .node-select');
    assertEqual(shadow.activeElement, selected, "navigator activation focuses the canvas node");
    selected.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assertEqual(shadow.activeElement?.dataset.navigateNode, "save", "Escape returns directly to navigator");
    shadow.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    assertEqual(shadow.activeElement?.dataset.navigateNode, "mic", "Home reaches the first node without repeated Tab presses");
    const columns = getComputedStyle(shadow.querySelector(".navigator-list")).gridTemplateColumns.split(" ").length;
    shadow.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
    assertEqual(
      shadow.activeElement?.dataset.navigateNode,
      shadow.querySelectorAll("[data-navigate-node]")[columns]?.dataset.navigateNode,
      "ArrowDown follows the visual grid column",
    );
  });

  it("returns from the canvas even when the large-graph overview is visible", async () => {
    const editor = createEditor();
    for (let index = 0; index < 7; index += 1) {
      const file = document.createElement("audio-input-file");
      file.id = `extra-${index}`;
      editor.querySelector("audio-context").append(file);
    }
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-navigator-view="overview"]').click();
    const mic = shadow.querySelector('[data-node-id="mic"] .node-select');
    mic.focus();
    mic.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assertEqual(shadow.activeElement?.dataset.navigateNode, "mic", "Escape makes the node list visible and focuses the matching entry");
    assertEqual(shadow.querySelector('[data-navigator-view="nodes"]').getAttribute("aria-pressed"), "true", "the node list is the active view");
  });

  it("keeps focus visible when a node is removed with the overview open", async () => {
    const editor = createEditor();
    for (let index = 0; index < 7; index += 1) {
      const file = document.createElement("audio-input-file");
      file.id = `extra-${index}`;
      editor.querySelector("audio-context").append(file);
    }
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-node-id="extra-6"] .node-select').click();
    await nextTask();
    shadow.querySelector('[data-navigator-view="overview"]').click();
    const remove = shadow.querySelector('[data-action="remove"]');
    remove.focus();
    remove.click();
    await nextTask();
    assertEqual(shadow.activeElement?.dataset.navigatorView, "overview", "focus falls back to the visible overview control");
  });

  it("edits event and action configuration without routing it through the Audio adapter", async () => {
    const editor = createEditor();
    await nextTask();

    editor.setProperty(editor.querySelector("#chunk"), "type", "stop");
    editor.setProperty(editor.querySelector("#save"), "handler", "Actions.Store(event)");

    assertEqual(editor.querySelector("#chunk").getAttribute("type"), "stop", "event type changes");
    assertEqual(
      editor.querySelector("#save").getAttribute("handler"),
      "Actions.Store(event)",
      "action handler changes",
    );
  });

  it("selects an event and action immediately after adding them from the palette", async () => {
    const editor = createEditor();
    editor.registerFunction("HandleGraphEvent", () => {});
    await nextTask();
    const shadow = editor.shadowRoot;

    shadow.querySelector('[data-node-id="recorder"] .node-select').click();
    shadow.querySelector('[data-add-event="start"]').click();
    await nextTask();
    assert(
      shadow.querySelector('[data-node-id="graph-event-1"] .node-select[aria-pressed="true"]'),
      "the new event is selected",
    );
    assert(shadow.querySelector('[data-property="type"]'), "event fields are ready to edit");

    shadow.querySelector('[data-add-function="HandleGraphEvent"]').click();
    await nextTask();
    assert(
      shadow.querySelector('[data-node-id="graph-action-1"] .node-select[aria-pressed="true"]'),
      "the new action is selected",
    );
    assert(shadow.querySelector('[data-property="handler"]'), "action fields are ready to edit");
  });

  it("supports keyboard edge connection and disconnection", async () => {
    const editor = createEditor();
    const music = document.createElement("audio-input-file");
    music.id = "music";
    editor.querySelector("audio-context").append(music);
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-connect-from]').value = "music";
    shadow.querySelector('[data-connect-to]').value = "filter";
    shadow.querySelector('[data-action="connect"]').focus();
    shadow.querySelector('[data-action="connect"]').click();
    await nextTask();
    assertEqual(music.getAttribute("to"), "filter", "keyboard form connects nodes");
    assertEqual(shadow.activeElement?.dataset.action, "connect", "connect retains keyboard focus");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("connected"), "connection is announced");

    shadow.querySelector('[data-action="disconnect"]').focus();
    shadow.querySelector('[data-action="disconnect"]').click();
    await nextTask();
    assertEqual(music.hasAttribute("to"), false, "keyboard form disconnects nodes");
    assertEqual(shadow.activeElement?.dataset.action, "disconnect", "disconnect retains keyboard focus");
  });

  it("keeps pending toolbar endpoint choices while the user inspects another node", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    const from = shadow.querySelector("[data-connect-from]");
    const to = shadow.querySelector("[data-connect-to]");
    from.value = "mic";
    to.value = "filter";
    from.dispatchEvent(new Event("change", { bubbles: true }));
    to.dispatchEvent(new Event("change", { bubbles: true }));
    shadow.querySelector('[data-navigate-node="filter"]').click();
    await nextTask();
    assertEqual(shadow.querySelector("[data-connect-from]").value, "mic", "source survives redraw");
    assertEqual(shadow.querySelector("[data-connect-to]").value, "filter", "target survives redraw");
  });

  it("removes only leaf event and action nodes without orphaning dependents", async () => {
    const editor = createEditor();
    await nextTask();
    const event = editor.querySelector("#chunk");
    const action = editor.querySelector("#save");
    let failure;
    try {
      editor.removeNode(event);
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof DOMException, "a depended-on event cannot be removed");
    assertEqual(event.parentElement, editor, "rejected removal preserves the event");
    const changes = [];
    editor.addEventListener("noderemove", (change) => changes.push(change.detail.data));
    editor.shadowRoot.querySelector('[data-node-id="save"] .node-select').click();
    await nextTask();
    const remove = editor.shadowRoot.querySelector('[data-action="remove"]');
    assert(remove, "a leaf action exposes Remove in the Inspector");
    remove.focus();
    remove.click();
    await nextTask();
    assertEqual(action.parentElement, null, "the leaf action is removed");
    assertEqual(changes[0], action, "the removal event exposes the removed element");
    assert(editor.shadowRoot.activeElement?.matches('[data-navigate-node]'), "focus moves to an existing navigation control");
    assert(editor.shadowRoot.querySelector('[data-editor-status]').textContent.includes("removed"), "removal is announced");
    editor.removeNode(event);
    await nextTask();
    assertEqual(event.parentElement, null, "the former event becomes removable after its dependent is removed");
  });

  it("does not silently delete an Audio subtree that a graph event depends on", async () => {
    const editor = createEditor();
    await nextTask();
    const filter = editor.querySelector("#filter");
    let failure;
    try {
      editor.removeNode(filter);
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof DOMException, "branch removal requires removing descendants first");
    assertEqual(editor.querySelector("#recorder")?.id, "recorder", "the recorder and its event source survive");
    editor.shadowRoot.querySelector('[data-node-id="filter"] .node-select').click();
    await nextTask();
    assert(editor.shadowRoot.querySelector('[data-action="remove"]').disabled, "the unsafe Inspector action is disabled");
    assert(editor.shadowRoot.querySelector(".inspector").textContent.includes("child"), "the Inspector explains why");
  });

  it("rejects disconnecting a nesting edge that has no explicit to reference", async () => {
    const editor = createEditor();
    await nextTask();
    let failure;
    try {
      editor.disconnect(editor.querySelector("#mic"), editor.querySelector("#filter"));
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof DOMException, "a nesting edge cannot falsely report disconnection");
    assertEqual(editor.querySelector("#mic > #filter")?.id, "filter", "nested connection remains intact");
  });

  it("moves focused node handles with arrow keys and preserves focus", async () => {
    const editor = createEditor();
    await nextTask();
    await waitForLayout();
    const shadow = editor.shadowRoot;
    const handle = shadow.querySelector('[data-node-id="mic"] [data-drag-handle]');
    const x = handle.closest("[data-node-id]").offsetLeft;
    handle.focus();
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true, cancelable: true }));
    await nextTask();
    assertEqual(editor.querySelector("#mic").dataset.graphX, String(x + 16), "arrow movement persists in HTML");
    assertEqual(shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId, "mic", "focus stays with moved node");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("moved"), "movement is announced");
  });

  it("connects ports by activating output and then input without dragging", async () => {
    const editor = createEditor();
    const music = document.createElement("audio-input-file");
    music.id = "music";
    editor.querySelector("audio-context").append(music);
    await nextTask();
    const shadow = editor.shadowRoot;
    const output = shadow.querySelector('[data-node-id="music"] [data-port="output"]');
    output.click();
    assertEqual(output.getAttribute("aria-pressed"), "true", "the pending output is exposed to assistive technology");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("filter" ) === false, "pending state does not imply completion");
    shadow.querySelector('[data-node-id="filter"] [data-port="input"]').click();
    await nextTask();
    assertEqual(music.getAttribute("to"), "filter", "a second activation connects the source");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("connected"), "completion is announced");
  });

  it("clears an armed output after an invalid port connection", async () => {
    const editor = createEditor();
    await nextTask();
    const shadow = editor.shadowRoot;
    const output = shadow.querySelector('[data-node-id="mic"] [data-port="output"]');
    output.click();
    shadow.querySelector('[data-node-id="save"] [data-port="input"]').click();
    assertEqual(output.getAttribute("aria-pressed"), "false", "rejected connection does not leave a pressed port");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("must be"), "the rejection explains the incompatible edge");
    shadow.querySelector('[data-node-id="chunk"] [data-port="output"]').click();
    shadow.querySelector('[data-node-id="save"] [data-port="input"]').click();
    await nextTask();
    assertEqual(editor.querySelector("#save").getAttribute("from"), "chunk", "the next valid connection works");
  });

  it("connects action outputs to action inputs through the public API and keyboard controls", async () => {
    const editor = createEditor();
    const next = document.createElement("graph-action");
    next.id = "next";
    next.setAttribute("handler", "Next(event)");
    editor.append(next);
    await nextTask();
    const shadow = editor.shadowRoot;
    assert(shadow.querySelector('[data-node-id="save"] [data-port="output"]'), "actions expose an output port");
    editor.connect(editor.querySelector("#save"), next);
    await nextTask();
    assertEqual(next.getAttribute("from"), "save", "API stores the action reference in HTML");
    assert(shadow.querySelector('[data-edge-from="save"][data-edge-to="next"]'), "the chain edge is visible");

    shadow.querySelector('[data-connect-from]').value = "chunk";
    shadow.querySelector('[data-connect-to]').value = "next";
    shadow.querySelector('[data-action="connect"]').click();
    await nextTask();
    assertEqual(next.getAttribute("from"), "chunk", "keyboard controls can rewire an action from an event");
    const beforeDisconnect = shadow.querySelector('[data-node-id="next"]');
    const previousPosition = { x: beforeDisconnect.offsetLeft, y: beforeDisconnect.offsetTop };
    shadow.querySelector('[data-action="disconnect"]').click();
    await nextTask();
    assertEqual(next.getAttribute("from"), "", "keyboard controls can disconnect an action");
    assertEqual(next.dataset.graphX, String(previousPosition.x), "disconnect retains the node's horizontal position");
    assertEqual(next.dataset.graphY, String(previousPosition.y), "disconnect retains the node's vertical position");
  });

  it("adds a registered function after a selected action and rejects cyclic connections", async () => {
    const editor = createEditor();
    editor.registerFunction("Double", (event) => event.detail.data * 2);
    await nextTask();
    editor.shadowRoot.querySelector('[data-node-id="save"] .node-select').click();
    const add = editor.shadowRoot.querySelector('[data-add-function="Double"]');
    assertEqual(add.getAttribute("aria-disabled"), "false", "selected actions enable the function palette");
    add.click();
    await nextTask();
    const added = editor.querySelector("#graph-action-1");
    assertEqual(added.getAttribute("from"), "save", "the new action follows the selected action");
    let failure;
    try {
      editor.connect(added, editor.querySelector("#save"));
    } catch (error) {
      failure = error;
    }
    assert(failure instanceof DOMException, "cycles are rejected by the public editor API");
    assertEqual(editor.querySelector("#save").getAttribute("from"), "chunk", "invalid connection does not mutate HTML");
  });

  it("selects an existing palette function branch instead of creating an accidental duplicate", async () => {
    const editor = createEditor();
    editor.registerFunction("Review", () => {}, { label: "Review result" });
    await nextTask();
    const shadow = editor.shadowRoot;
    shadow.querySelector('[data-node-id="save"] .node-select').click();
    shadow.querySelector('[data-add-function="Review"]').click();
    await nextTask();
    const first = editor.querySelector('graph-action[from="save"][handler="Review(event)"]');
    assert(first, "the first selection creates a branch");
    shadow.querySelector('[data-node-id="save"] .node-select').click();
    shadow.querySelector('[data-add-function="Review"]').click();
    await nextTask();
    assertEqual(editor.querySelectorAll('graph-action[from="save"][handler="Review(event)"]').length, 1, "a second palette activation does not duplicate it");
    assertEqual(shadow.activeElement?.closest("[data-node-id]")?.dataset.nodeId, first.id, "the existing branch is revealed");
    assert(shadow.querySelector("[data-editor-status]").textContent.includes("already connected"), "the reason is announced");
  });

  it("connects output and input ports with a pointer gesture", async () => {
    const editor = createEditor();
    const music = document.createElement("audio-input-file");
    music.id = "music";
    editor.querySelector("audio-context").append(music);
    await nextTask();
    const shadow = editor.shadowRoot;

    shadow
      .querySelector('[data-node-id="music"] [data-port="output"]')
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    shadow
      .querySelector('[data-node-id="filter"] [data-port="input"]')
      .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    await nextTask();

    assertEqual(music.getAttribute("to"), "filter", "pointer connection updates the source DOM");
  });

  it("cancels a pending port connection when the pointer is released outside the editor", async () => {
    const editor = createEditor();
    const music = document.createElement("audio-input-file");
    music.id = "music";
    editor.querySelector("audio-context").append(music);
    await nextTask();
    const shadow = editor.shadowRoot;

    shadow
      .querySelector('[data-node-id="music"] [data-port="output"]')
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    window.dispatchEvent(new PointerEvent("pointerup"));
    shadow
      .querySelector('[data-node-id="filter"] [data-port="input"]')
      .dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));

    assertEqual(music.hasAttribute("to"), false, "a later pointerup cannot use a stale source");
  });

  it("persists pointer-drag positions and emits nodechange", async () => {
    const editor = createEditor();
    await nextTask();
    await waitForLayout();
    let detail;
    editor.addEventListener("nodechange", (event) => {
      detail = event.detail;
    });
    const card = editor.shadowRoot.querySelector('[data-node-id="mic"]');
    const origin = { x: card.offsetLeft, y: card.offsetTop };
    const path = editor.shadowRoot.querySelector('[data-edge-from="mic"]');
    const previousPath = path.getAttribute("d");
    card
      .querySelector("[data-drag-handle]")
      .dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 10, clientY: 20 }));
    window.dispatchEvent(new PointerEvent("pointermove", { clientX: 34, clientY: 68 }));
    window.dispatchEvent(new PointerEvent("pointerup", { clientX: 34, clientY: 68 }));
    await nextTask();
    await waitForLayout();

    const mic = editor.querySelector("#mic");
    assertEqual(
      mic.dataset.graphX,
      String(origin.x + 24),
      "horizontal delta is persisted from its visible position",
    );
    assertEqual(
      mic.dataset.graphY,
      String(origin.y + 48),
      "vertical delta is persisted from its visible position",
    );
    assertEqual(detail.metadata.operation, "move", "movement metadata is included");
    assert(
      editor.shadowRoot.querySelector('[data-edge-from="mic"]').getAttribute("d") !== previousPath,
      "connected edge follows the moved node",
    );
  });

  it("reports invalid edits without committing them", async () => {
    const editor = createEditor();
    await nextTask();
    const errors = [];
    editor.addEventListener("error", (event) => errors.push(event.detail.data));

    let thrown;
    try {
      editor.setProperty(editor.querySelector("#filter"), "frequency", "later");
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof DOMException, "public method preserves the validation error");
    assertEqual(errors[0], thrown, "the same error is published");
    assertEqual(editor.querySelector("#filter").getAttribute("frequency"), "440", "DOM rolls back");
  });
});
