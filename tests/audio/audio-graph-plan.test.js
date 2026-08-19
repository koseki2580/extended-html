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

const assertThrows = (callback, message, expectedMessage) => {
  try {
    callback();
  } catch (error) {
    assert(error instanceof TypeError, `${message}: expected a TypeError`);
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

  it("rejects a processor at the context root", () => {
    const context = contextFrom("<audio-context><audio-biquad-filter></audio-biquad-filter></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "root processor",
      "<audio-biquad-filter> must be nested directly under a recognized audio node",
    );
  });

  it("rejects audio nodes hidden by ordinary HTML wrappers", () => {
    const context = contextFrom("<audio-context><div><audio-input-mic></audio-input-mic></div></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "wrapped source",
      "<audio-input-mic> must be a direct child of <audio-context>",
    );
  });

  it("rejects a missing to target", () => {
    const context = contextFrom("<audio-context><audio-input-file to=\"missing\"></audio-input-file></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "missing target",
      'Audio graph target "missing" was not found in this <audio-context>',
    );
  });

  it("rejects duplicate IDs in one context", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"same\"></audio-input-file><audio-input-mic id=\"same\"></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "duplicate id",
      'Duplicate audio graph id "same" in this <audio-context>',
    );
  });

  it("rejects a source as a to target", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"file\" to=\"mic\"></audio-input-file><audio-input-mic id=\"mic\"></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "source target",
      'Audio graph target "mic" must be an audio processor or output',
    );
  });

  it("rejects a to target from the same source tree", () => {
    const context = contextFrom("<audio-context><audio-input-file id=\"file\" to=\"filter\"><audio-biquad-filter id=\"filter\"></audio-biquad-filter></audio-input-file></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "same tree target",
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
      'Audio graph target "foreign" was not found in this <audio-context>',
    );
  });

  it("rejects unknown audio custom tags", () => {
    const context = contextFrom("<audio-context><audio-input-mic><audio-filter-typo></audio-filter-typo></audio-input-mic></audio-context>");

    assertThrows(
      () => buildAudioGraphPlan(context),
      "unknown audio tag",
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
      "Audio graph contains a cycle",
    );
  });
});
