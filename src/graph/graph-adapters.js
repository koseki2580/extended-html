const adapters = new Map();
const REQUIRED_METHODS = [
  "read",
  "addNode",
  "removeNode",
  "connect",
  "disconnect",
  "setProperty",
  "setPosition",
];

export const registerGraphAdapter = (rootName, adapter) => {
  if (!rootName?.includes("-")) {
    throw new TypeError("A graph adapter root must be a custom-element name");
  }
  if (!adapter || !Array.isArray(adapter.nodeTypes)) {
    throw new TypeError("A graph adapter must provide a nodeTypes array");
  }
  const missing = REQUIRED_METHODS.filter((name) => typeof adapter[name] !== "function");
  if (missing.length > 0) {
    throw new TypeError(`A graph adapter must provide ${missing.join(", ")}`);
  }
  adapters.set(rootName, adapter);
};

export const findGraphAdapter = (editor) => {
  const roots = [...editor.children].filter((child) => adapters.has(child.localName));
  if (roots.length !== 1) {
    throw new DOMException(
      `<graph-editor> requires exactly one direct registered graph root; found ${roots.length}`,
      "SyntaxError",
    );
  }
  const root = roots[0];
  return { root, adapter: adapters.get(root.localName) };
};
