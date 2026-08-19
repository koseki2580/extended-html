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
  static audioEventTypes = ["ready"];
}

class ErrorAudioEventTargetElement extends AudioEventTargetElement {
  static observedAttributes = ["onerror"];
  static audioEventTypes = ["error"];
}

if (!customElements.get("test-audio-event-target")) {
  customElements.define("test-audio-event-target", TestAudioEventTargetElement);
}
if (!customElements.get("test-audio-error-event-target")) {
  customElements.define("test-audio-error-event-target", ErrorAudioEventTargetElement);
}

const createElement = () => document.createElement("test-audio-event-target");
const createErrorElement = () => document.createElement("test-audio-error-event-target");

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

  it("uses null context metadata when an owner has no ID", () => {
    const element = createElement();
    let received;
    element.addEventListener("ready", (event) => {
      received = event;
    });

    dispatchAudioEvent(element, "ready", undefined, { id: "" });

    assertEqual(received.detail.metadata.contextId, null, "empty owner ID is absent");
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

    element.onready = first;
    element.dispatchEvent(new Event("ready"));
    element.onready = second;
    element.dispatchEvent(new Event("ready"));
    element.onready = null;
    element.dispatchEvent(new Event("ready"));

    assertEqual(firstCalls, 1, "replaced handler is removed");
    assertEqual(secondCalls, 1, "active handler is called once");
    assertEqual(element.onready, null, "property is cleared");
  });

  it("clears a property handler when assigned a non-function", () => {
    const element = createElement();
    element.onready = () => {};

    element.onready = "not a function";

    assertEqual(element.onready, null, "non-function clears handler");
  });

  it("keeps an independently registered handler when the matching property handler clears", () => {
    const element = createElement();
    let calls = 0;
    const handler = () => {
      calls += 1;
    };

    element.addEventListener("ready", handler);
    element.onready = handler;
    element.dispatchEvent(new Event("ready"));
    element.onready = null;
    element.dispatchEvent(new Event("ready"));
    element.removeEventListener("ready", handler);

    assertEqual(calls, 3, "property listener does not share the native listener slot");
  });

  it("hydrates a pre-upgrade onready expando through the declared property accessor", () => {
    const tagName = "test-audio-event-upgrade";
    const element = document.createElement(tagName);
    let calls = 0;
    element.onready = () => {
      calls += 1;
    };
    document.body.append(element);

    class UpgradedAudioEventTargetElement extends AudioEventTargetElement {
      static audioEventTypes = ["ready"];
    }

    customElements.define(tagName, UpgradedAudioEventTargetElement);
    element.dispatchEvent(new Event("ready"));
    element.remove();

    assertEqual(calls, 1, "pre-upgrade handler is subscribed after upgrade");
    assert(typeof element.onready === "function", "generated accessor exposes hydrated handler");
  });

  it("hydrates and clears a pre-upgrade native error handler through the custom property slot", () => {
    const tagName = "test-audio-error-event-upgrade";
    const element = document.createElement(tagName);
    let oldCalls = 0;
    let newCalls = 0;
    const oldHandler = () => {
      oldCalls += 1;
    };
    const newHandler = () => {
      newCalls += 1;
    };
    element.onerror = oldHandler;
    document.body.append(element);

    class UpgradedErrorAudioEventTargetElement extends AudioEventTargetElement {
      static audioEventTypes = ["error"];
    }

    customElements.define(tagName, UpgradedErrorAudioEventTargetElement);
    assertEqual(element.onerror, oldHandler, "native handler is hydrated into the custom slot");
    element.dispatchEvent(new Event("error"));
    element.onerror = newHandler;
    element.dispatchEvent(new Event("error"));
    element.onerror = null;
    element.dispatchEvent(new Event("error"));
    element.remove();

    assertEqual(oldCalls, 1, "old native handler runs only before replacement");
    assertEqual(newCalls, 1, "new handler runs only before clearing");
  });

  it("hydrates a pre-upgrade native error handler through a private-field subclass accessor", async () => {
    const tagName = "test-audio-subclass-error-event-upgrade";
    const element = document.createElement(tagName);
    let oldCalls = 0;
    let newCalls = 0;
    const oldHandler = () => {
      oldCalls += 1;
    };
    const newHandler = () => {
      newCalls += 1;
    };
    element.onerror = oldHandler;
    document.body.append(element);

    class UpgradedSubclassErrorAudioEventTargetElement extends AudioEventTargetElement {
      static audioEventTypes = ["error"];

      #handler = null;

      get onerror() {
        return this.#handler;
      }

      set onerror(handler) {
        this.#handler = typeof handler === "function" ? handler : null;
        this._setAudioEventHandler("error", handler);
      }
    }

    customElements.define(tagName, UpgradedSubclassErrorAudioEventTargetElement);
    await Promise.resolve();
    assertEqual(element.onerror, oldHandler, "subclass accessor receives native handler");
    element.dispatchEvent(new Event("error"));
    element.onerror = newHandler;
    element.dispatchEvent(new Event("error"));
    element.onerror = null;
    element.dispatchEvent(new Event("error"));
    element.remove();

    assertEqual(oldCalls, 1, "old native handler runs only before replacement");
    assertEqual(newCalls, 1, "new handler runs only before clearing");
  });

  it("hydrates a pre-upgrade onready expando through a private-field subclass accessor", async () => {
    const tagName = "test-audio-subclass-ready-event-upgrade";
    const element = document.createElement(tagName);
    let oldCalls = 0;
    let newCalls = 0;
    const oldHandler = () => {
      oldCalls += 1;
    };
    const newHandler = () => {
      newCalls += 1;
    };
    element.onready = oldHandler;
    document.body.append(element);

    class UpgradedSubclassReadyAudioEventTargetElement extends AudioEventTargetElement {
      static audioEventTypes = ["ready"];

      #handler = null;

      get onready() {
        return this.#handler;
      }

      set onready(handler) {
        this.#handler = typeof handler === "function" ? handler : null;
        this._setAudioEventHandler("ready", handler);
      }
    }

    customElements.define(tagName, UpgradedSubclassReadyAudioEventTargetElement);
    await Promise.resolve();
    assertEqual(element.onready, oldHandler, "subclass accessor receives expando handler");
    element.dispatchEvent(new Event("ready"));
    element.onready = newHandler;
    element.dispatchEvent(new Event("ready"));
    element.onready = null;
    element.dispatchEvent(new Event("ready"));
    element.remove();

    assertEqual(oldCalls, 1, "old expando handler runs only before replacement");
    assertEqual(newCalls, 1, "new handler runs only before clearing");
  });

  it("cancels deferred expando hydration when a private-field subclass handler changes", async () => {
    const tagName = "test-audio-subclass-ready-handler-cancel";
    const element = document.createElement(tagName);
    let oldCalls = 0;
    let newCalls = 0;
    const oldHandler = () => {
      oldCalls += 1;
    };
    const newHandler = () => {
      newCalls += 1;
    };
    element.onready = oldHandler;
    document.body.append(element);

    class CancelingSubclassReadyAudioEventTargetElement extends AudioEventTargetElement {
      static audioEventTypes = ["ready"];

      #handler = null;

      get onready() {
        return this.#handler;
      }

      set onready(handler) {
        this.#handler = typeof handler === "function" ? handler : null;
        this._setAudioEventHandler("ready", handler);
      }
    }

    customElements.define(tagName, CancelingSubclassReadyAudioEventTargetElement);
    element.onready = newHandler;
    element.onready = null;
    await Promise.resolve();
    element.dispatchEvent(new Event("ready"));
    element.remove();

    assertEqual(oldCalls, 0, "pending expando handler is cancelled");
    assertEqual(newCalls, 0, "cleared replacement handler does not run");
  });

  it("binds global and one-segment dotted declarative handlers with the element as this", () => {
    const element = createElement();
    const calls = [];
    globalThis.AudioEventTestHandlers = {
      global(event) {
        calls.push(["global", this, event.type]);
      },
    };
    globalThis.AudioEventTestNamespace = {
      nested(event) {
        calls.push(["nested", this, event.type]);
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
        "AudioEventTestNamespace.nested(event)",
      );
      element.dispatchEvent(new Event("ready"));

      assertEqual(calls.length, 2, "both declarative handlers run once");
      assert(typeof element.onready === "function", "declarative binding uses the property accessor");
      assertEqual(calls[0][0], "global", "global handler is selected");
      assertEqual(calls[1][0], "nested", "dotted handler is selected");
      assertEqual(calls[0][1], element, "global handler this value");
      assertEqual(calls[1][1], element, "dotted handler this value");
    } finally {
      delete globalThis.AudioEventTestHandlers;
      delete globalThis.AudioEventTestNamespace;
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

  it("runs a built-in error declarative handler exactly once", () => {
    const element = createErrorElement();
    let calls = 0;
    globalThis.ReviewSafeErrorHandler = () => {
      calls += 1;
    };

    try {
      element.setAttribute("onerror", "ReviewSafeErrorHandler(event)");
      element.dispatchEvent(new Event("error"));

      assertEqual(calls, 1, "error handler runs through the declarative slot once");
      assertEqual(
        element.getAttribute("onerror"),
        "ReviewSafeErrorHandler(event)",
        "declarative attribute is preserved",
      );
    } finally {
      delete globalThis.ReviewSafeErrorHandler;
    }
  });

  it("does not execute arbitrary code from a built-in error attribute", () => {
    const element = createErrorElement();
    globalThis.reviewUnsafeErrorAttributeExecuted = false;

    try {
      element.setAttribute(
        "onerror",
        "globalThis.reviewUnsafeErrorAttributeExecuted = true",
      );
      element.dispatchEvent(new Event("error"));

      assertEqual(
        globalThis.reviewUnsafeErrorAttributeExecuted,
        false,
        "native inline code is never dispatched",
      );
    } finally {
      delete globalThis.reviewUnsafeErrorAttributeExecuted;
    }
  });

  it("rejects unsafe declarative syntax and clears handlers when removed", () => {
    const element = createElement();

    assertThrows(
      () => element._updateDeclarativeAudioHandler("onready", "A.B.Handler(event)"),
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

  it("throws a ReferenceError when a declarative global resolves to a non-function", () => {
    const element = createElement();
    globalThis.NonFunctionAudioHandler = {};

    try {
      element._updateDeclarativeAudioHandler("onready", "NonFunctionAudioHandler(event)");

      assertThrows(
        () => element.onready(new Event("ready")),
        ReferenceError,
        "ReferenceError",
        "NonFunctionAudioHandler is not a global function",
      );
    } finally {
      delete globalThis.NonFunctionAudioHandler;
    }
  });
});
