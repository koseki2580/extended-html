import "../../src/graph/graph-event.js";
import "../../src/graph/graph-action.js";
import { registerGraphFunction } from "../../src/graph/graph-functions.js";

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

afterEach(() => {
  document.querySelectorAll("graph-editor").forEach((element) => element.remove());
  delete globalThis.SaveChunk;
});

describe("graph-action", () => {
  it("routes a synchronous result through an action chain and fans out with metadata", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="ready" from="source" type="change"></graph-event><graph-action id="double" from="ready" handler="Double(event)"></graph-action><graph-action id="save" from="double" handler="Save(event)"></graph-action><graph-action id="audit" from="double" handler="Audit(event)"></graph-action>';
    const received = [];
    registerGraphFunction(editor, "Double", (event) => event.detail.data * 2);
    registerGraphFunction(editor, "Save", (event) => received.push(["save", event.detail]));
    registerGraphFunction(editor, "Audit", (event) => received.push(["audit", event.detail]));
    document.body.append(editor);
    await nextTask();

    editor.querySelector("#source").dispatchEvent(new CustomEvent("change", {
      detail: { data: 3, metadata: { requestId: "one" } },
    }));

    assertEqual(received.length, 2, "both downstream actions run");
    assertEqual(received[0][1].data, 6, "the return value reaches the next input");
    assertEqual(received[1][1].data, 6, "one output can fan out");
    assertEqual(received[0][1].metadata.requestId, "one", "incoming metadata survives");
    assertEqual(received[0][1].metadata.producerId, "double", "producer metadata identifies the action");
  });

  it("awaits promises, suppresses undefined, and forwards null", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="ready" from="source" type="change"></graph-event><graph-action id="transform" from="ready" handler="Transform(event)"></graph-action><graph-action id="sink" from="transform" handler="Sink(event)"></graph-action>';
    const received = [];
    registerGraphFunction(editor, "Transform", async (event) => event.detail.data);
    registerGraphFunction(editor, "Sink", (event) => received.push(event.detail.data));
    document.body.append(editor);
    await nextTask();
    const source = editor.querySelector("#source");
    source.dispatchEvent(new CustomEvent("change", { detail: { data: undefined } }));
    source.dispatchEvent(new CustomEvent("change", { detail: { data: null } }));
    await nextTask();
    assertEqual(received.length, 1, "undefined does not produce output");
    assertEqual(received[0], null, "null remains a valid output");
  });

  it("does not publish a pending result after its source is rewired", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="one" from="source" type="change"></graph-event><graph-event id="two" from="source" type="update"></graph-event><graph-action id="transform" from="one" handler="Transform(event)"></graph-action><graph-action id="sink" from="transform" handler="Sink(event)"></graph-action>';
    let resolve;
    const received = [];
    registerGraphFunction(editor, "Transform", () => new Promise((done) => { resolve = done; }));
    registerGraphFunction(editor, "Sink", (event) => received.push(event.detail.data));
    document.body.append(editor);
    await nextTask();
    editor.querySelector("#source").dispatchEvent(new Event("change"));
    editor.querySelector("#transform").setAttribute("from", "two");
    await nextTask();
    resolve("old result");
    await nextTask();
    assertEqual(received.length, 0, "an obsolete pending result is not routed");
    editor.querySelector("#source").dispatchEvent(new Event("update"));
    resolve("new result");
    await nextTask();
    assertEqual(received[0], "new result", "the new source remains active");
  });

  it("rejects cycles without replacing the last working listener", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="ready" from="source" type="change"></graph-event><graph-action id="first" from="ready" handler="First(event)"></graph-action><graph-action id="second" from="first" handler="Second(event)"></graph-action>';
    let runs = 0;
    const errors = [];
    registerGraphFunction(editor, "First", (event) => event.detail.data + 1);
    registerGraphFunction(editor, "Second", () => { runs += 1; });
    editor.addEventListener("error", (event) => errors.push(event.detail.data));
    document.body.append(editor);
    await nextTask();
    editor.querySelector("#first").setAttribute("from", "second");
    await nextTask();
    editor.querySelector("#source").dispatchEvent(new CustomEvent("change", { detail: { data: 1 } }));
    assert(errors.some((error) => error instanceof DOMException && /cycl/i.test(error.message)), "cycle reports an error");
    assertEqual(runs, 1, "the previous safe connection still works");
  });

  it("rejects cycles passing through graph-event bridges", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="ready" from="source" type="change"></graph-event><graph-action id="first" from="ready" handler="First(event)"></graph-action><graph-event id="echo" from="first" type="data"></graph-event>';
    const errors = [];
    registerGraphFunction(editor, "First", (event) => event.detail.data);
    editor.addEventListener("error", (event) => errors.push(event.detail.data));
    document.body.append(editor);
    await nextTask();

    editor.querySelector("#first").setAttribute("from", "echo");
    await nextTask();
    assert(errors.some((error) => /cycl/i.test(error.message)), "action-to-event-to-action cycles are rejected");

    errors.length = 0;
    editor.querySelector("#first").setAttribute("from", "ready");
    await nextTask();
    editor.querySelector("#ready").setAttribute("from", "first");
    editor.querySelector("#ready").setAttribute("type", "data");
    await nextTask();
    assert(errors.some((error) => /cycl/i.test(error.message)), "event rewiring cannot close a cycle");
  });

  it("keeps pending failures observable across unrelated edits but ignores removed actions", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="pending-event" from="source" type="message"></graph-event><graph-action id="pending-action" from="pending-event" handler="Process(event)"></graph-action>';
    const errors = [];
    let reject;
    registerGraphFunction(editor, "Process", () => new Promise((_, fail) => { reject = fail; }));
    editor.addEventListener("error", (event) => errors.push(event.detail.data));
    document.body.append(editor);
    await nextTask();
    const source = editor.querySelector("#source");
    source.dispatchEvent(new Event("message"));
    editor.append(document.createElement("div"));
    await nextTask();
    const failure = new Error("Pending request failed");
    reject(failure);
    await nextTask();
    assertEqual(errors[0], failure, "unrelated edits do not hide errors");
    source.dispatchEvent(new Event("message"));
    editor.querySelector("graph-action").remove();
    reject(new Error("Stale request failed"));
    await nextTask();
    assertEqual(errors.length, 1, "removed actions do not report stale errors");
  });
  it("reports async function failures through the editor and preserves the payload", async () => {
    const editor = document.createElement("graph-editor");
    editor.innerHTML = '<div id="source"></div><graph-event id="async-event" from="source" type="message"></graph-event><graph-action id="async-action" from="async-event" handler="Process(event)"></graph-action>';
    const failure = new Error("Processing failed");
    let received;
    let reported;
    registerGraphFunction(editor, "Process", async (event) => {
      received = event.detail;
      throw failure;
    });
    editor.addEventListener("error", (event) => { reported = event.detail; });
    document.body.append(editor);
    await nextTask();
    editor.querySelector("#source").dispatchEvent(new CustomEvent("message", {
      detail: { data: 42, metadata: { requestId: "request-1" } },
    }));
    await nextTask();
    assertEqual(received.data, 42, "the function receives data");
    assertEqual(received.metadata.requestId, "request-1", "application metadata survives");
    assertEqual(reported?.data, failure, "rejections become editor errors");
    assertEqual(reported?.metadata.nodeId, "async-action", "the failing action is identified");
  });
  it("dispatches run and invokes a safe global handler with bridged data", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "source";
    const eventNode = document.createElement("graph-event");
    eventNode.id = "message-ready";
    eventNode.setAttribute("from", "source");
    eventNode.setAttribute("type", "message");
    const action = document.createElement("graph-action");
    action.setAttribute("from", "message-ready");
    action.setAttribute("handler", "SaveChunk(event)");
    editor.append(source, eventNode, action);
    document.body.append(editor);
    await nextTask();
    const calls = [];
    globalThis.SaveChunk = (event) => calls.push([event.type, event.detail.data]);
    action.addEventListener("run", (event) => calls.push(["listener", event.detail.data]));

    source.dispatchEvent(new MessageEvent("message", { data: "payload" }));

    assertEqual(calls[0][0], "listener", "run is dispatched first");
    assertEqual(calls[1][0], "run", "handler receives the run event");
    assertEqual(calls[1][1], "payload", "handler receives bridged data");
  });

  it("prefers an editor-scoped function over a global handler with the same name", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "source";
    const eventNode = document.createElement("graph-event");
    eventNode.id = "ready";
    eventNode.setAttribute("from", "source");
    eventNode.setAttribute("type", "change");
    const action = document.createElement("graph-action");
    action.setAttribute("from", "ready");
    action.setAttribute("handler", "SaveChunk(event)");
    editor.append(source, eventNode, action);
    document.body.append(editor);
    const calls = [];
    globalThis.SaveChunk = () => calls.push("global");
    registerGraphFunction(editor, "SaveChunk", () => calls.push("scoped"));
    await nextTask();

    source.dispatchEvent(new Event("change"));

    assertEqual(calls.join(","), "scoped", "the local registry resolves first");
  });

  it("reports malformed handlers without replacing a working action", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "source";
    const eventNode = document.createElement("graph-event");
    eventNode.id = "ready";
    eventNode.setAttribute("from", "source");
    eventNode.setAttribute("type", "change");
    const action = document.createElement("graph-action");
    action.setAttribute("from", "ready");
    action.setAttribute("handler", "SaveChunk(event)");
    editor.append(source, eventNode, action);
    document.body.append(editor);
    await nextTask();
    let calls = 0;
    let failure;
    globalThis.SaveChunk = () => {
      calls += 1;
    };
    editor.addEventListener("error", (event) => {
      failure = event.detail.data;
    });

    action.setAttribute("handler", "alert('unsafe')");
    await nextTask();
    source.dispatchEvent(new Event("change"));

    assert(failure instanceof SyntaxError, "malformed handler reports SyntaxError");
    assertEqual(calls, 1, "previous safe handler remains active");
  });

  it("lets multiple actions consume one event and disposes removed actions", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "source";
    const eventNode = document.createElement("graph-event");
    eventNode.id = "ready";
    eventNode.setAttribute("from", "source");
    eventNode.setAttribute("type", "change");
    const first = document.createElement("graph-action");
    const second = document.createElement("graph-action");
    for (const action of [first, second]) {
      action.setAttribute("from", "ready");
      action.setAttribute("handler", "SaveChunk(event)");
    }
    editor.append(source, eventNode, first, second);
    document.body.append(editor);
    await nextTask();
    let calls = 0;
    globalThis.SaveChunk = () => {
      calls += 1;
    };

    source.dispatchEvent(new Event("change"));
    first.remove();
    source.dispatchEvent(new Event("change"));

    assertEqual(calls, 3, "removed action stops while the other remains active");
  });
});
