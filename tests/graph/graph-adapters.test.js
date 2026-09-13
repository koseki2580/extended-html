import { registerGraphAdapter } from "../../src/graph/index.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const nextTask = () => new Promise((resolve) => setTimeout(resolve));

afterEach(() => {
  document.querySelectorAll("graph-editor").forEach((element) => element.remove());
});

describe("graph adapter registry", () => {
  it("rejects an incomplete adapter at registration time", () => {
    let thrown;
    try {
      registerGraphAdapter("incomplete-graph", { read() {} });
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof TypeError, "missing editor operations are rejected early");
  });

  it("renders a non-Audio graph through the same editor contract", async () => {
    const node = document.createElement("div");
    node.id = "generic-node";
    const adapter = {
      nodeTypes: [],
      read: (root) => ({
        root,
        nodes: [{
          element: node,
          id: node.id,
          nodeName: "generic-node",
          kind: "source",
          label: "Generic node",
          properties: [],
          events: [],
          position: { x: null, y: null },
        }],
        edges: [],
      }),
      addNode() {},
      removeNode() {},
      connect() {},
      disconnect() {},
      setProperty() {},
      setPosition() {},
    };
    registerGraphAdapter("generic-root", adapter);
    const editor = document.createElement("graph-editor");
    editor.append(document.createElement("generic-root"));
    document.body.append(editor);
    await nextTask();

    assert(editor.shadowRoot.querySelector('[data-node-id="generic-node"]'), "generic node renders");
  });
});
