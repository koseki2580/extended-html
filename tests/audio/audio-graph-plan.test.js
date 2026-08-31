import { buildAudioGraphPlan } from "../../src/audio/audio-graph-plan.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertThrows = (
  callback,
  message,
  ErrorType,
  expectedName,
  expectedMessage,
) => {
  try {
    callback();
  } catch (error) {
    assert(error instanceof ErrorType, `${message}: expected ${ErrorType.name}`);
    assertEqual(error.name, expectedName, `${message}: error name`);
    assertEqual(error.message, expectedMessage, `${message}: error message`);
    return;
  }
  throw new Error(`${message}: expected an error`);
};

const contextFrom = (markup) => {
  const host = document.createElement("div");
  host.innerHTML = markup;
  return host.firstElementChild;
};

const labels = (records) => records.map((record) => record.element.id || record.element.localName);

const edgeLabels = (edges) =>
  edges.map(({ from, to }) => `${from.id || from.localName}->${to.id || to.localName}`);

describe("buildAudioGraphPlan", () => {
  it("requires an audio context root element", () => {
    assertThrows(
      () => buildAudioGraphPlan(document.createElement("div")),
      "invalid planner root",
      TypeError,
      "TypeError",
      "buildAudioGraphPlan requires an <audio-context> element",
    );
  });

  it("plans a serial nested chain", () => {
    const context = contextFrom(`
      <audio-context>
        <audio-input-mic id="mic"><audio-biquad-filter id="filter"><audio-output id="out"></audio-output></audio-biquad-filter></audio-input-mic>
      </audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(plan.nodes.length, 3, "all graph nodes are included");
    assertEqual(plan.nodes[0].role, "source", "mic role");
    assertEqual(plan.nodes[1].role, "processor", "filter role");
    assertEqual(plan.nodes[2].role, "output", "output role");
    assertEqual(plan.nodes[2].rootSource, plan.nodes[0].element, "root source is retained");
    assertEqual(edgeLabels(plan.edges).join(","), "mic->filter,filter->out", "nested nodes connect serially");
    assertEqual(plan.consumers.length, 0, "graph has no stream consumers");
  });

  it("plans a stream output and its recorder without making the recorder an audio node", () => {
    const context = contextFrom(`
      <audio-context>
        <audio-input-mic id="mic">
          <audio-biquad-filter id="filter">
            <audio-stream-output id="recording">
              <media-recorder id="recorder"></media-recorder>
            </audio-stream-output>
          </audio-biquad-filter>
        </audio-input-mic>
      </audio-context>
    `);

    const plan = buildAudioGraphPlan(context);
    const recorder = context.querySelector("media-recorder");
    const streamOutput = context.querySelector("audio-stream-output");

    assertEqual(labels(plan.nodes).join(","), "mic,filter,recording", "recorder is not an audio node");
    assertEqual(plan.nodes[2].role, "output", "stream output is a graph sink");
    assertEqual(edgeLabels(plan.edges).join(","), "mic->filter,filter->recording", "stream output receives its parent signal");
    assertEqual(plan.consumers.length, 1, "one recorder consumer");
    assertEqual(plan.consumers[0].element, recorder, "consumer element");
    assertEqual(plan.consumers[0].output, streamOutput, "owning stream output");
  });

  it("accepts a stream output as a cross-tree to target", () => {
    const context = contextFrom(`
      <audio-context>
        <audio-input-file id="file" to="recording"></audio-input-file>
        <audio-input-mic id="mic">
          <audio-stream-output id="recording"><media-recorder></media-recorder></audio-stream-output>
        </audio-input-mic>
      </audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(edgeLabels(plan.edges).join(","), "mic->recording,file->recording", "sources merge at the stream output");
  });

  it("fans a processor out to its direct processor siblings", () => {
    const context = contextFrom(`
      <audio-context><audio-input-mic id="mic"><audio-biquad-filter id="left"></audio-biquad-filter><audio-biquad-filter id="right"></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(edgeLabels(plan.edges).join(","), "mic->left,mic->right", "siblings share their parent input");
  });

  it("preserves direct source sibling DOM order", () => {
    const context = contextFrom(`
      <audio-context><audio-input-file id="file"></audio-input-file><audio-input-mic id="mic"></audio-input-mic></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(labels(plan.sources).join(","), "file,mic", "sources follow DOM order");
    assertEqual(labels(plan.nodes).join(","), "file,mic", "nodes have stable DOM order");
  });

  it("adds a file source edge into a processor in another source tree", () => {
    const context = contextFrom(`
      <audio-context><audio-input-file id="file" to="mix"></audio-input-file><audio-input-mic id="mic"><audio-biquad-filter id="mix"></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(edgeLabels(plan.edges).join(","), "mic->mix,file->mix", "cross-tree to supplements nesting");
  });

  it("adds every whitespace-separated target once", () => {
    const context = contextFrom(`
      <audio-context><audio-input-file id="file" to="mix-a  mix-b mix-a"></audio-input-file><audio-input-mic id="mic"><audio-biquad-filter id="mix-a"></audio-biquad-filter><audio-biquad-filter id="mix-b"></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(edgeLabels(plan.edges).join(","), "mic->mix-a,mic->mix-b,file->mix-a,file->mix-b", "targets are additive and deduplicated");
  });

  it("accepts an empty graph and an empty to attribute", () => {
    const empty = buildAudioGraphPlan(contextFrom("<audio-context></audio-context>"));
    const context = contextFrom(`
      <audio-context><audio-input-file id="file" to="   "></audio-input-file></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(empty.nodes.length, 0, "empty graph has no nodes");
    assertEqual(empty.edges.length, 0, "empty graph has no edges");
    assertEqual(plan.edges.length, 0, "empty to adds no edge");
  });

  it("accepts an empty to attribute on an audio output", () => {
    const context = contextFrom(`
      <audio-context><audio-input-mic id="mic"><audio-output id="out" to="  "></audio-output></audio-input-mic></audio-context>
    `);

    const plan = buildAudioGraphPlan(context);

    assertEqual(edgeLabels(plan.edges).join(","), "mic->out", "empty output to adds no edge");
  });

  it("rejects a processor at the context root", () => {
    const context = contextFrom("<audio-context><audio-biquad-filter></audio-biquad-filter></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "root processor",
      DOMException,
      "SyntaxError",
      "<audio-biquad-filter> must be nested directly under a recognized audio node",
    );
  });

  it("rejects audio nodes hidden by ordinary HTML wrappers", () => {
    const context = contextFrom("<audio-context><div><audio-input-mic></audio-input-mic></div></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "wrapped source",
      DOMException,
      "SyntaxError",
      "<audio-input-mic> must be a direct child of <audio-context>",
    );
  });

  it("rejects audio graph children under an audio output", () => {
    const context = contextFrom(`
      <audio-context><audio-input-mic><audio-output><audio-biquad-filter></audio-biquad-filter></audio-output></audio-input-mic></audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(context),
      "output child",
      DOMException,
      "SyntaxError",
      "<audio-output> cannot contain audio graph elements",
    );
  });

  it("rejects a non-empty to attribute on an audio output", () => {
    const context = contextFrom(`
      <audio-context><audio-input-file><audio-output to="target"></audio-output></audio-input-file><audio-input-mic><audio-biquad-filter id="target"></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(context),
      "output to",
      DOMException,
      "SyntaxError",
      "<audio-output> cannot declare a non-empty to attribute",
    );
  });

  it("requires exactly one direct recorder under every stream output", () => {
    const missing = contextFrom(`
      <audio-context><audio-input-mic><audio-stream-output></audio-stream-output></audio-input-mic></audio-context>
    `);
    const duplicate = contextFrom(`
      <audio-context><audio-input-mic><audio-stream-output><media-recorder></media-recorder><media-recorder></media-recorder></audio-stream-output></audio-input-mic></audio-context>
    `);

    for (const [label, context] of [["missing recorder", missing], ["duplicate recorder", duplicate]]) {
      assertThrows(
        () => buildAudioGraphPlan(context),
        label,
        DOMException,
        "SyntaxError",
        "<audio-stream-output> must contain exactly one direct <media-recorder> child",
      );
    }
  });

  it("rejects a recorder outside a stream output", () => {
    const context = contextFrom(`
      <audio-context><audio-input-mic><audio-biquad-filter><media-recorder></media-recorder></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(context),
      "wrong recorder parent",
      DOMException,
      "SyntaxError",
      "<media-recorder> must be a direct child of <audio-stream-output>",
    );
  });

  it("rejects audio graph children and non-empty to on a stream output", () => {
    const child = contextFrom(`
      <audio-context><audio-input-mic><audio-stream-output><media-recorder></media-recorder><audio-output></audio-output></audio-stream-output></audio-input-mic></audio-context>
    `);
    const target = contextFrom(`
      <audio-context><audio-input-file><audio-stream-output to="filter"><media-recorder></media-recorder></audio-stream-output></audio-input-file><audio-input-mic><audio-biquad-filter id="filter"></audio-biquad-filter></audio-input-mic></audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(child),
      "stream output child",
      DOMException,
      "SyntaxError",
      "<audio-stream-output> cannot contain audio graph elements",
    );
    assertThrows(
      () => buildAudioGraphPlan(target),
      "stream output to",
      DOMException,
      "SyntaxError",
      "<audio-stream-output> cannot declare a non-empty to attribute",
    );
  });

  it("rejects a missing to target", () => {
    const context = contextFrom("<audio-context><audio-input-file to=\"missing\"></audio-input-file></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "missing target",
      DOMException,
      "SyntaxError",
      'Audio graph target "missing" was not found in this <audio-context>',
    );
  });

  it("rejects duplicate IDs in one context", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"same\"></audio-input-file><audio-input-mic id=\"same\"></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "duplicate id",
      DOMException,
      "SyntaxError",
      'Duplicate audio graph id "same" in this <audio-context>',
    );
  });

  it("rejects a non-audio to target", () => {
    const context = contextFrom(`
      <audio-context><audio-input-file to="panel"></audio-input-file><div id="panel"></div></audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(context),
      "non-audio target",
      DOMException,
      "SyntaxError",
      'Audio graph target "panel" must be an audio processor or output',
    );
  });

  it("rejects a source as a to target", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"file\" to=\"mic\"></audio-input-file><audio-input-mic id=\"mic\"></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "source target",
      DOMException,
      "SyntaxError",
      'Audio graph target "mic" must be an audio processor or output',
    );
  });

  it("rejects a to target from the same source tree", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"file\" to=\"filter\"><audio-biquad-filter id=\"filter\"></audio-biquad-filter></audio-input-file></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "same tree target",
      DOMException,
      "SyntaxError",
      'Audio graph target "filter" must be in a different source tree',
    );
  });

  it("does not resolve to targets in another audio context", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <audio-context id="first"><audio-input-file to="foreign"></audio-input-file></audio-context>
      <audio-context id="second"><audio-input-mic><audio-biquad-filter id="foreign"></audio-biquad-filter></audio-input-mic></audio-context>
    `;

    assertThrows(
      () => buildAudioGraphPlan(host.firstElementChild),
      "cross-context target",
      DOMException,
      "SyntaxError",
      'Audio graph target "foreign" was not found in this <audio-context>',
    );
  });

  it("rejects unknown audio custom tags", () => {
    const context = contextFrom("<audio-context><audio-input-mic><audio-filter-typo></audio-filter-typo></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "unknown audio tag",
      DOMException,
      "SyntaxError",
      "Unknown audio graph element <audio-filter-typo>",
    );
  });

  it("rejects a cross-tree cycle", () => {
    const context = contextFrom(`
      <audio-context>
        <audio-input-file><audio-biquad-filter id="file-filter" to="mic-filter"></audio-biquad-filter></audio-input-file>
        <audio-input-mic><audio-biquad-filter id="mic-filter" to="file-filter"></audio-biquad-filter></audio-input-mic>
      </audio-context>
    `);

    assertThrows(
      () => buildAudioGraphPlan(context),
      "cycle",
      DOMException,
      "InvalidStateError",
      "Audio graph contains a cycle",
    );
  });

  it("isolates nested audio contexts from each planner scope", () => {
    const host = document.createElement("div");
    host.innerHTML = `
      <audio-context>
        <audio-input-mic id="shared"></audio-input-mic>
        <audio-context>
          <audio-input-file id="shared"><audio-output id="inner-out"></audio-output></audio-input-file>
          <audio-context><audio-filter-typo id="shared"></audio-filter-typo></audio-context>
        </audio-context>
      </audio-context>
    `;
    const outer = host.firstElementChild;
    const inner = outer.querySelector(":scope > audio-context");

    const outerPlan = buildAudioGraphPlan(outer);
    const innerPlan = buildAudioGraphPlan(inner);

    assertEqual(labels(outerPlan.nodes).join(","), "shared", "outer ignores the nested context subtree");
    assertEqual(labels(innerPlan.nodes).join(","), "shared,inner-out", "inner owns its direct graph nodes");
    assertEqual(edgeLabels(innerPlan.edges).join(","), "shared->inner-out", "inner owns its graph edges");
  });
});
