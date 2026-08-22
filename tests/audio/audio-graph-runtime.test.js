import { AudioGraphRuntime } from "../../src/audio/audio-graph-runtime.js";
import {
  AudioNodeElement,
  AudioSourceElement,
} from "../../src/audio/audio-node-element.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

class RuntimeNodeElement extends AudioNodeElement {
  nativeNode = null;

  _createAudioNode() {
    return this.nativeNode;
  }
}

class RuntimeSourceElement extends AudioSourceElement {
  nativeNode = null;
  activate = async () => {};
  connected = async () => {};
  suspend = async () => {};
  close = async () => {};

  _createAudioNode() {
    if (this.nativeNode === null) {
      throw new DOMException("Deferred source", "NotSupportedError");
    }
    return this.nativeNode;
  }

  _activate(context) {
    return this.activate(context);
  }

  _connected() {
    return this.connected();
  }

  _suspend() {
    return this.suspend();
  }

  _close() {
    return this.close();
  }
}

if (!customElements.get("test-runtime-node")) {
  customElements.define("test-runtime-node", RuntimeNodeElement);
}
if (!customElements.get("test-runtime-source")) {
  customElements.define("test-runtime-source", RuntimeSourceElement);
}

const createNativeNode = (name, events) => ({
  name,
  connect(target) {
    events.push(`connect:${name}->${target.name}`);
  },
  disconnect(target) {
    events.push(`disconnect:${name}${target ? `->${target.name}` : ""}`);
  },
});

const createContext = (events) => ({
  state: "suspended",
  async resume() {
    events.push("context:resume");
    this.state = "running";
  },
  async suspend() {
    events.push("context:suspend");
    this.state = "suspended";
  },
  async close() {
    events.push("context:close");
    this.state = "closed";
  },
});

const createFixture = () => {
  const events = [];
  const owner = document.createElement("div");
  const first = document.createElement("test-runtime-source");
  const second = document.createElement("test-runtime-source");
  const filter = document.createElement("test-runtime-node");
  const output = document.createElement("test-runtime-node");
  first.nativeNode = createNativeNode("first", events);
  second.nativeNode = createNativeNode("second", events);
  filter.nativeNode = createNativeNode("filter", events);
  output.nativeNode = createNativeNode("output", events);
  const plan = {
    nodes: [
      { element: first, role: "source", rootSource: first },
      { element: filter, role: "processor", rootSource: first },
      { element: output, role: "output", rootSource: first },
      { element: second, role: "source", rootSource: second },
    ],
    edges: [
      { from: first, to: filter },
      { from: filter, to: output },
      { from: second, to: filter },
    ],
    sources: [
      { element: first, role: "source", rootSource: first },
      { element: second, role: "source", rootSource: second },
    ],
  };
  const context = createContext(events);
  return { events, owner, first, second, filter, output, plan, context };
};

describe("AudioGraphRuntime", () => {
  it("creates nodes, applies static edges, and activates sources in DOM order", async () => {
    const fixture = createFixture();
    fixture.first.activate = async () => fixture.events.push("activate:first");
    fixture.first.connected = async () => fixture.events.push("connected:first");
    fixture.second.activate = async () => fixture.events.push("activate:second");
    fixture.second.connected = async () => fixture.events.push("connected:second");

    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();

    assertEqual(
      fixture.events.join(","),
      "connect:first->filter,connect:filter->output,connect:second->filter,context:resume,activate:first,connected:first,activate:second,connected:second",
      "build and activation order",
    );
    assertEqual(fixture.first._getAudioOwner(), fixture.owner, "source owner");
    assertEqual(fixture.filter._getAudioOwner(), fixture.owner, "processor owner");
    assertEqual(runtime.state, "running", "runtime state");
  });

  it("waits for each source before activating the next and leaves both active", async () => {
    const fixture = createFixture();
    let resolveFirst;
    let firstActive = false;
    let secondActive = false;
    fixture.first.activate = () =>
      new Promise((resolve) => {
        resolveFirst = () => {
          firstActive = true;
          resolve();
        };
      });
    fixture.second.activate = async () => {
      assert(firstActive, "first source completed before second starts");
      secondActive = true;
    };

    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    const resuming = runtime.resume();
    await Promise.resolve();
    await Promise.resolve();
    assertEqual(secondActive, false, "second source is still pending");
    resolveFirst();
    await resuming;

    assertEqual(firstActive, true, "first remains active");
    assertEqual(secondActive, true, "second remains active");
  });

  it("connects a microphone source only after activation and before its open hook", async () => {
    const fixture = createFixture();
    fixture.plan.nodes[0].element = fixture.first;
    fixture.first.nativeNode = null;
    fixture.first.activate = async () => {
      fixture.events.push("activate:mic");
      fixture.first.nativeNode = createNativeNode("mic", fixture.events);
      fixture.first._attachAudioNode(fixture.first.nativeNode);
    };
    fixture.first.connected = async () => fixture.events.push("open:mic");

    await new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    ).resume();

    const activation = fixture.events.indexOf("activate:mic");
    const connection = fixture.events.indexOf("connect:mic->filter");
    const opened = fixture.events.indexOf("open:mic");
    assert(activation < connection && connection < opened, "mic activation/connect/open order");
  });

  it("rolls back activated sources and native resources in reverse on failure", async () => {
    const fixture = createFixture();
    const failure = new Error("second failed");
    fixture.first.activate = async () => fixture.events.push("activate:first");
    fixture.first.close = async () => fixture.events.push("close:first");
    fixture.second.activate = async () => {
      fixture.events.push("activate:second");
      throw failure;
    };
    fixture.second.close = async () => fixture.events.push("close:second");
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );

    let rejected;
    try {
      await runtime.resume();
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected, failure, "original activation error");
    assert(
      fixture.events.indexOf("close:second") <
        fixture.events.indexOf("close:first"),
      "sources close in reverse",
    );
    assert(
      fixture.events.indexOf("close:first") <
        fixture.events.lastIndexOf("context:suspend"),
      "native context suspends after source rollback",
    );
    assertEqual(fixture.first._getAudioOwner(), null, "source owner is cleared");
    assertEqual(fixture.filter._getAudioOwner(), null, "processor owner is cleared");
    assertEqual(runtime.state, "suspended", "runtime reports suspended");
  });

  it("suspends sources in reverse and closes terminal resources once", async () => {
    const fixture = createFixture();
    fixture.first.suspend = async () => fixture.events.push("suspend:first");
    fixture.second.suspend = async () => fixture.events.push("suspend:second");
    fixture.first.close = async () => fixture.events.push("close:first");
    fixture.second.close = async () => fixture.events.push("close:second");
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;

    await runtime.suspend();
    await runtime.suspend();
    assertEqual(
      fixture.events.join(","),
      "suspend:second,suspend:first,context:suspend",
      "idempotent reverse suspension",
    );
    fixture.events.length = 0;

    const firstClose = runtime.close();
    const secondClose = runtime.close();
    assertEqual(firstClose, secondClose, "close callers share a promise");
    await firstClose;
    assert(fixture.events.includes("close:second"), "second source closes");
    assert(fixture.events.includes("close:first"), "first source closes");
    assertEqual(
      fixture.events.at(-1),
      "context:close",
      "native context closes last",
    );
    assertEqual(runtime.state, "closed", "terminal runtime state");
  });
});
