const FUNCTION_NAME_PATTERN = /^[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*$/;
const registries = new WeakMap();

const registryFor = (editor) => {
  let registry = registries.get(editor);
  if (!registry) {
    registry = new Map();
    registries.set(editor, registry);
  }
  return registry;
};

export const parseGraphFunctionName = (value) => {
  const name = String(value ?? "").trim();
  if (!FUNCTION_NAME_PATTERN.test(name)) {
    throw new SyntaxError(
      "function name must be an identifier or dotted path, for example Recording.Measure",
    );
  }
  return name;
};

export const registerGraphFunction = (editor, value, fn, metadata = {}) => {
  const name = parseGraphFunctionName(value);
  if (typeof fn !== "function") throw new TypeError("registered graph function must be a function");

  const descriptor = Object.freeze({
    name,
    handler: `${name}(event)`,
    label: String(metadata.label ?? "").trim() || name.split(".").at(-1),
    description: String(metadata.description ?? "").trim(),
    fn,
  });
  const registry = registryFor(editor);
  registry.set(name, descriptor);

  return () => {
    if (registry.get(name) === descriptor) registry.delete(name);
  };
};

export const listGraphFunctions = (editor) => [...(registries.get(editor)?.values() ?? [])];

export const resolveRegisteredGraphFunction = (editor, path) =>
  registries.get(editor)?.get(path.join("."))?.fn ?? null;
