import {
  listGraphFunctions,
  registerGraphFunction,
  resolveRegisteredGraphFunction,
} from "../../src/graph/graph-functions.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

describe("graph function registry", () => {
  it("scopes reviewed functions and metadata to one editor", () => {
    const first = document.createElement("graph-editor");
    const second = document.createElement("graph-editor");
    const measure = () => "measured";

    registerGraphFunction(first, "Recording.Measure", measure, {
      label: "Measure recording",
      description: "Reports the recorded Blob size",
    });

    const [descriptor] = listGraphFunctions(first);
    assertEqual(descriptor.name, "Recording.Measure", "name stays serializable");
    assertEqual(descriptor.handler, "Recording.Measure(event)", "handler is portable");
    assertEqual(descriptor.label, "Measure recording", "label is retained");
    assertEqual(
      descriptor.description,
      "Reports the recorded Blob size",
      "description is retained",
    );
    assertEqual(
      resolveRegisteredGraphFunction(first, ["Recording", "Measure"]),
      measure,
      "the owning editor resolves the function",
    );
    assertEqual(
      resolveRegisteredGraphFunction(second, ["Recording", "Measure"]),
      null,
      "another editor cannot resolve it",
    );
  });

  it("replaces registrations without letting stale cleanup remove the replacement", () => {
    const editor = document.createElement("graph-editor");
    const first = () => "first";
    const second = () => "second";
    const unregisterFirst = registerGraphFunction(editor, "Process", first);
    const unregisterSecond = registerGraphFunction(editor, "Process", second);

    unregisterFirst();
    assertEqual(
      resolveRegisteredGraphFunction(editor, ["Process"]),
      second,
      "stale cleanup preserves the replacement",
    );
    unregisterSecond();
    unregisterSecond();
    assertEqual(
      resolveRegisteredGraphFunction(editor, ["Process"]),
      null,
      "current cleanup is idempotent",
    );
  });

  it("validates function names and implementations", () => {
    const editor = document.createElement("graph-editor");
    let nameError;
    let functionError;

    try {
      registerGraphFunction(editor, "alert('unsafe')", () => {});
    } catch (error) {
      nameError = error;
    }
    try {
      registerGraphFunction(editor, "Measure", "not a function");
    } catch (error) {
      functionError = error;
    }

    assert(nameError instanceof SyntaxError, "invalid names throw SyntaxError");
    assert(functionError instanceof TypeError, "non-functions throw TypeError");
    assertEqual(listGraphFunctions(editor).length, 0, "invalid values are not registered");
  });
});
