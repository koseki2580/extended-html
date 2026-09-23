import "../../src/audio/index.js";
import { audioGraphAdapter } from "../../src/graph/audio-graph-adapter.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const createRoot = () => {
  const root = document.createElement("audio-context");
  root.innerHTML = `
    <audio-input-mic id="mic">
      <audio-biquad-filter id="filter" frequency="120">
        <audio-output id="speaker"></audio-output>
        <audio-stream-output id="stream">
          <media-recorder id="recorder"></media-recorder>
        </audio-stream-output>
      </audio-biquad-filter>
    </audio-input-mic>
    <audio-input-file id="music" src="tone.wav" to="filter"></audio-input-file>
  `;
  return root;
};

describe("audioGraphAdapter", () => {
  it("projects nested, reference, consumer, property, and event descriptors", () => {
    const root = createRoot();

    const model = audioGraphAdapter.read(root);

    assertEqual(model.nodes.length, 6, "recorder is projected with graph nodes");
    assert(
      model.edges.some(
        (edge) => edge.from.id === "mic" && edge.to.id === "filter" && edge.kind === "nested",
      ),
      "nested edge is projected",
    );
    assert(
      model.edges.some(
        (edge) => edge.from.id === "music" && edge.to.id === "filter" && edge.kind === "reference",
      ),
      "to edge is projected",
    );
    assert(
      model.edges.some(
        (edge) => edge.from.id === "stream" && edge.to.id === "recorder" && edge.kind === "consumer",
      ),
      "recorder edge is projected",
    );
    const filter = model.nodes.find((node) => node.id === "filter");
    assert(filter.properties.some((property) => property.name === "frequency"), "frequency property");
    const recorder = model.nodes.find((node) => node.id === "recorder");
    assert(recorder.events.includes("dataavailable"), "recorder event port is projected");
  });

  it("adds sources and connected processors without leaving invalid orphans", () => {
    const root = createRoot();

    const source = audioGraphAdapter.addNode(root, "audio-input-file");
    const filter = audioGraphAdapter.addNode(root, "audio-biquad-filter", {
      parent: source,
    });
    const stream = audioGraphAdapter.addNode(root, "audio-stream-output", {
      parent: filter,
    });

    assertEqual(source.parentElement, root, "source is inserted at graph root");
    assertEqual(filter.parentElement, source, "processor is connected by nesting");
    assertEqual(stream.parentElement, filter, "sink is connected by nesting");
    assertEqual(
      stream.querySelectorAll(":scope > media-recorder").length,
      1,
      "stream sink receives its required recorder",
    );
    assert(source.id && filter.id && stream.id, "generated nodes receive stable ids");
    audioGraphAdapter.read(root);
  });

  it("explains which node types can be added at the current selection", () => {
    const root = createRoot();
    const mic = root.querySelector("#mic");
    const filter = root.querySelector("#filter");
    const speaker = root.querySelector("#speaker");

    assertEqual(
      audioGraphAdapter.canAdd(root, "audio-input-file").allowed,
      true,
      "a source can be added at the root",
    );
    const missingParent = audioGraphAdapter.canAdd(root, "audio-biquad-filter");
    assertEqual(missingParent.allowed, false, "a child requires a selection");
    assert(missingParent.reason.includes("Select"), "the missing selection is actionable");
    assertEqual(
      audioGraphAdapter.canAdd(root, "audio-biquad-filter", { parent: mic }).allowed,
      true,
      "a source accepts a processor",
    );
    assertEqual(
      audioGraphAdapter.canAdd(root, "audio-output", { parent: filter }).allowed,
      true,
      "a processor accepts an output",
    );
    const terminalParent = audioGraphAdapter.canAdd(root, "audio-biquad-filter", {
      parent: speaker,
    });
    assertEqual(terminalParent.allowed, false, "a terminal output rejects children");
    assert(
      terminalParent.reason.includes("cannot contain"),
      "the terminal reason explains the constraint",
    );
  });

  it("adds and removes cross-tree edges through the to attribute", () => {
    const root = createRoot();
    const music = root.querySelector("#music");
    const stream = root.querySelector("#stream");

    audioGraphAdapter.connect(root, music, stream);
    assertEqual(music.getAttribute("to"), "filter stream", "reference edge is added");
    audioGraphAdapter.disconnect(root, music, stream);
    assertEqual(music.getAttribute("to"), "filter", "reference edge is removed");
  });

  it("rolls back a generated target id when a connection is invalid", () => {
    const root = createRoot();
    const mic = root.querySelector("#mic");
    const speaker = root.querySelector("#speaker");
    speaker.removeAttribute("id");

    let thrown;
    try {
      audioGraphAdapter.connect(root, mic, speaker);
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof DOMException, "same-tree connection is rejected");
    assertEqual(speaker.hasAttribute("id"), false, "generated id is rolled back");
    assertEqual(mic.hasAttribute("to"), false, "source reference is rolled back");
  });

  it("updates configuration transactionally and removes dangling references", () => {
    const root = createRoot();
    const filter = root.querySelector("#filter");
    const music = root.querySelector("#music");

    audioGraphAdapter.setProperty(root, filter, "frequency", "880");
    assertEqual(filter.getAttribute("frequency"), "880", "valid property commits");
    let thrown;
    try {
      audioGraphAdapter.setProperty(root, filter, "frequency", "later");
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof DOMException, "invalid property throws");
    assertEqual(filter.getAttribute("frequency"), "880", "invalid property rolls back");

    audioGraphAdapter.removeNode(root, filter);
    assertEqual(music.hasAttribute("to"), false, "dangling to reference is removed");
    audioGraphAdapter.read(root);
  });

  it("persists presentation position without changing graph semantics", () => {
    const root = createRoot();
    const mic = root.querySelector("#mic");

    audioGraphAdapter.setPosition(mic, { x: 24, y: 48 });

    assertEqual(mic.dataset.graphX, "24", "x is persisted");
    assertEqual(mic.dataset.graphY, "48", "y is persisted");
    assertEqual(audioGraphAdapter.read(root).edges.length, 5, "edges are unchanged");
  });
});
