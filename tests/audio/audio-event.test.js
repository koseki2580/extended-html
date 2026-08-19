import {
  AudioEventTargetElement,
  dispatchAudioEvent,
} from "../../src/audio/audio-event.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertThrows = (callback, ErrorType, name, message) => {
  try {
    callback();
  } catch (error) {
    assert(error instanceof ErrorType, `expected ${ErrorType.name}`);
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return;
  }
  throw new Error("expected an error");
};

class TestAudioEventTargetElement extends AudioEventTargetElement {
  static observedAttributes = ["onready"];
}

if (!customElements.get("test-audio-event-target")) {
  customElements.define("test-audio-event-target", TestAudioEventTargetElement);
}

const createElement = () => document.createElement("test-audio-event-target");

describe("dispatchAudioEvent", () => {
  it("dispatches a non-bubbling, non-composed event with audio metadata", () => {
    const element = createElement();
    element.id = "oscillator";
    const owner = { id: "context-a" };
    const payload = { frequency: 440 };
    let received;
    element.addEventListener("ready", (event) => {
      received = event;
    });

    const dispatched = dispatchAudioEvent(element, "ready", payload, owner);

    assertEqual(dispatched, true, "dispatch result");
    assertEqual(received.detail.data, payload, "event data");
    assertEqual(received.detail.metadata.contextId, "context-a", "context id");
    assertEqual(received.detail.metadata.nodeId, "oscillator", "node id");
    assertEqual(
      received.detail.metadata.nodeName,
      "test-audio-event-target",
      "node name",
    );
    assertEqual(received.bubbles, false, "event does not bubble");
    assertEqual(received.composed, false, "event is not composed");
  });

  it("uses null metadata IDs when no owner or node ID is available", () => {
    const element = createElement();
    let received;
    element.addEventListener("closed", (event) => {
      received = event;
    });

    dispatchAudioEvent(element, "closed", null, null);

    assertEqual(received.detail.data, null, "null data is preserved");
    assertEqual(received.detail.metadata.contextId, null, "missing context ID");
    assertEqual(received.detail.metadata.nodeId, null, "missing node ID");
  });
});

describe("AudioEventTargetElement handlers", () => {
  it("replaces and removes property event handlers", () => {
    const element = createElement();
    let firstCalls = 0;
    let secondCalls = 0;
    const first = () => {
      firstCalls += 1;
    };
    const second = () => {
      secondCalls += 1;
    };

    element._setAudioEventHandler("ready", first);
    element.dispatchEvent(new Event("ready"));
    element._setAudioEventHandler("ready", second);
    element.dispatchEvent(new Event("ready"));
    element._setAudioEventHandler("ready", null);
    element.dispatchEvent(new Event("ready"));

    assertEqual(firstCalls, 1, "replaced handler is removed");
    assertEqual(secondCalls, 1, "active handler is called once");
    assertEqual(element.onready, null, "property is cleared");
  });

  it("clears a property handler when assigned a non-function", () => {
    const element = createElement();
    element._setAudioEventHandler("ready", () => {});

    element._setAudioEventHandler("ready", "not a function");

    assertEqual(element.onready, null, "non-function clears handler");
  });

  it("binds global and dotted declarative handlers with the element as this", () => {
    const element = createElement();
    const calls = [];
    globalThis.AudioEventTestHandlers = {
      global(event) {
        calls.push(["global", this, event.type]);
      },
      namespace: {
        nested(event) {
          calls.push(["nested", this, event.type]);
        },
      },
    };

    try {
      element._updateDeclarativeAudioHandler(
        "onready",
        " AudioEventTestHandlers.global(event); ",
      );
      element.dispatchEvent(new Event("ready"));
      element._updateDeclarativeAudioHandler(
        "onready",
        "AudioEventTestHandlers.namespace.nested(event)",
      );
      element.dispatchEvent(new Event("ready"));

      assertEqual(calls.length, 2, "both declarative handlers run once");
      assertEqual(calls[0][0], "global", "global handler is selected");
      assertEqual(calls[1][0], "nested", "dotted handler is selected");
      assertEqual(calls[0][1], element, "global handler this value");
      assertEqual(calls[1][1], element, "dotted handler this value");
    } finally {
      delete globalThis.AudioEventTestHandlers;
    }
  });

  it("updates declarative handlers when an observed attribute is added or removed", () => {
    const element = createElement();
    let calls = 0;
    globalThis.AudioEventAttributeHandler = () => {
      calls += 1;
    };

    try {
      element.setAttribute("onready", "AudioEventAttributeHandler(event)");
      element.dispatchEvent(new Event("ready"));
      element.removeAttribute("onready");
      element.dispatchEvent(new Event("ready"));

      assertEqual(calls, 1, "removed declarative attribute clears its handler");
      assertEqual(element.onready, null, "property reflects removed attribute");
    } finally {
      delete globalThis.AudioEventAttributeHandler;
    }
  });

  it("rejects unsafe declarative syntax and clears handlers when removed", () => {
    const element = createElement();

    assertThrows(
      () => element._updateDeclarativeAudioHandler("onready", "run()"),
      SyntaxError,
      "SyntaxError",
      "onready must call a global handler with event, for example Handler(event)",
    );
    element._updateDeclarativeAudioHandler("onready", "Handler(event)");
    element._updateDeclarativeAudioHandler("onready", null);

    assertEqual(element.onready, null, "removed attribute clears its handler");
  });

  it("throws a ReferenceError when a declarative global handler is unavailable", () => {
    const element = createElement();
    element._updateDeclarativeAudioHandler("onready", "MissingAudioHandler(event)");

    assertThrows(
      () => element.onready(new Event("ready")),
      ReferenceError,
      "ReferenceError",
      "MissingAudioHandler is not a global function",
    );
  });
});
