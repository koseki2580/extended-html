import { resolveRegisteredGraphFunction } from "./graph-functions.js";

const HANDLER_PATTERN =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(\s*event\s*\)\s*;?\s*$/;

export const parseGraphHandler = (source) => {
  const match = String(source ?? "").match(HANDLER_PATTERN);
  if (!match) {
    throw new SyntaxError(
      "handler must call a registered or global function with event, for example Handler(event)",
    );
  }
  return match[1].split(".");
};

export const resolveGraphHandler = (path, editor = null) => {
  const registered = editor && resolveRegisteredGraphFunction(editor, path);
  if (registered) return registered;
  let handler = globalThis;
  for (const part of path) handler = handler?.[part];
  if (typeof handler !== "function") {
    throw new ReferenceError(`${path.join(".")} is unavailable. Register it with editor.registerFunction() or provide a global function.`);
  }
  return handler;
};

export const reportGraphError = (element, error) => {
  const target = element.closest("graph-editor") ?? element;
  target.dispatchEvent(
    new CustomEvent("error", {
      detail: { data: error, metadata: { nodeId: element.id || null } },
    }),
  );
};

export const findUniqueGraphElement = (editor, id, expectedName = null) => {
  if (!id?.trim()) throw new DOMException("Graph reference requires an id", "SyntaxError");
  const matches = [...editor.querySelectorAll("[id]")].filter(
    (element) => element.id === id,
  );
  if (matches.length !== 1) {
    throw new DOMException(
      matches.length === 0
        ? `Graph element "${id}" was not found`
        : `Graph element id "${id}" is duplicated`,
      "SyntaxError",
    );
  }
  if (expectedName !== null && matches[0].localName !== expectedName) {
    throw new DOMException(
      `Graph element "${id}" must be <${expectedName}>`,
      "SyntaxError",
    );
  }
  return matches[0];
};
