import "../../src/audio/index.js";
import "../../src/graph/index.js";

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
    await nextTask();
    const shadow = editor.shadowRoot;

    shadow.querySelector('[data-node-id="recorder"] .node-select').click();
    shadow.querySelector('[data-action="add-event"]').click();
    await nextTask();
    assert(
      shadow.querySelector('[data-node-id="graph-event-1"] .node-select[aria-pressed="true"]'),
      "the new event is selected",
    );
    assert(shadow.querySelector('[data-property="type"]'), "event fields are ready to edit");

    shadow.querySelector('[data-action="add-action"]').click();
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
    shadow.querySelector('[data-action="connect"]').click();
    await nextTask();
    assertEqual(music.getAttribute("to"), "filter", "keyboard form connects nodes");

    shadow.querySelector('[data-action="disconnect"]').click();
    await nextTask();
    assertEqual(music.hasAttribute("to"), false, "keyboard form disconnects nodes");
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
