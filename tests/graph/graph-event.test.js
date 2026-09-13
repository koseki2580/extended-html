import "../../src/graph/graph-event.js";

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
});

describe("graph-event", () => {
  it("bridges wrapped event data and metadata from an element by id", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "recorder";
    const eventNode = document.createElement("graph-event");
    eventNode.id = "chunk-ready";
    eventNode.setAttribute("from", "recorder");
    eventNode.setAttribute("type", "dataavailable");
    editor.append(source, eventNode);
    document.body.append(editor);
    await nextTask();
    let received;
    eventNode.addEventListener("data", (event) => {
      received = event;
    });

    source.dispatchEvent(
      new CustomEvent("dataavailable", {
        detail: { data: "chunk", metadata: { timecode: 12 } },
      }),
    );

    assertEqual(received.detail.data, "chunk", "wrapped data is preserved");
    assertEqual(received.detail.metadata.timecode, 12, "source metadata is preserved");
    assertEqual(received.detail.metadata.sourceId, "recorder", "source id is added");
    assertEqual(received.detail.metadata.sourceEvent, "dataavailable", "event type is added");
    assertEqual(received.detail.metadata.eventId, "chunk-ready", "event node id is added");
  });

  it("keeps the previous listener when a replacement source is invalid", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "first";
    const eventNode = document.createElement("graph-event");
    eventNode.setAttribute("from", "first");
    eventNode.setAttribute("type", "message");
    editor.append(source, eventNode);
    document.body.append(editor);
    await nextTask();
    const payloads = [];
    const errors = [];
    eventNode.addEventListener("data", (event) => payloads.push(event.detail.data));
    editor.addEventListener("error", (event) => errors.push(event.detail.data));

    eventNode.setAttribute("from", "missing");
    await nextTask();
    source.dispatchEvent(new MessageEvent("message", { data: "still active" }));

    assertEqual(payloads[0], "still active", "previous source remains connected");
    assert(errors[0] instanceof DOMException, "invalid rewire reports an error");
  });

  it("detaches its source listener when removed", async () => {
    const editor = document.createElement("graph-editor");
    const source = document.createElement("div");
    source.id = "source";
    const eventNode = document.createElement("graph-event");
    eventNode.setAttribute("from", "source");
    eventNode.setAttribute("type", "change");
    editor.append(source, eventNode);
    document.body.append(editor);
    await nextTask();
    let calls = 0;
    eventNode.addEventListener("data", () => {
      calls += 1;
    });

    eventNode.remove();
    source.dispatchEvent(new Event("change"));

    assertEqual(calls, 0, "removed event node receives no late data");
  });
});
