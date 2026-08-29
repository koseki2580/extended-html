import { AudioGraphRuntime } from "../../src/audio/audio-graph-runtime.js";
import {
  AudioNodeElement,
  AudioSourceElement,
} from "../../src/audio/audio-node-element.js";
import { AudioInputMicElement } from "../../src/audio/audio-input-mic.js";

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
  configuration = null;
  candidateConfiguration = null;

  _createAudioNode() {
    return this.nativeNode;
  }

  _configureAudioNode() {
    if (this.candidateConfiguration !== null) {
      this.configuration = this.candidateConfiguration;
    }
  }

  _captureAudioConfiguration() {
    return this.configuration;
  }

  _restoreAudioConfiguration(configuration) {
    this.configuration = configuration;
  }
}

class RuntimeSourceElement extends AudioSourceElement {
  nativeNode = null;
  activate = async () => {};
  connected = async () => {};
  suspend = async () => {};
  close = async () => {};
  rollbackCandidate = async () => this.suspend();

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

  _rollbackAudioCandidate() {
    return this.rollbackCandidate();
  }
}

if (!customElements.get("test-runtime-node")) {
  customElements.define("test-runtime-node", RuntimeNodeElement);
}
if (!customElements.get("test-runtime-source")) {
  customElements.define("test-runtime-source", RuntimeSourceElement);
}
if (!customElements.get("test-runtime-mic")) {
  customElements.define("test-runtime-mic", AudioInputMicElement);
}

const installMediaDevices = (getUserMedia) => {
  const descriptor = Object.getOwnPropertyDescriptor(navigator, "mediaDevices");
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: { getUserMedia },
  });
  return () => {
    if (descriptor) Object.defineProperty(navigator, "mediaDevices", descriptor);
    else delete navigator.mediaDevices;
  };
};

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

  it("rolls back sources nonterminally in reverse and permits a later resume", async () => {
    const fixture = createFixture();
    const failure = new Error("second failed");
    let firstClosed = false;
    let secondClosed = false;
    let secondAttempts = 0;
    fixture.first.activate = async () => {
      if (firstClosed) throw new Error("first is terminal");
      fixture.events.push("activate:first");
    };
    fixture.first.suspend = async () => fixture.events.push("suspend:first");
    fixture.first.close = async () => {
      firstClosed = true;
      fixture.events.push("close:first");
    };
    fixture.second.activate = async () => {
      if (secondClosed) throw new Error("second is terminal");
      fixture.events.push("activate:second");
      secondAttempts += 1;
      if (secondAttempts === 1) throw failure;
    };
    fixture.second.suspend = async () => fixture.events.push("suspend:second");
    fixture.second.close = async () => {
      secondClosed = true;
      fixture.events.push("close:second");
    };
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
      fixture.events.indexOf("suspend:second") <
        fixture.events.indexOf("suspend:first"),
      "sources suspend in reverse",
    );
    assert(
      fixture.events.indexOf("suspend:first") <
        fixture.events.lastIndexOf("context:suspend"),
      "native context suspends after source rollback",
    );
    assertEqual(firstClosed, false, "first source remains resumable");
    assertEqual(secondClosed, false, "failed source remains resumable");
    assertEqual(
      fixture.first._getAudioOwner(),
      fixture.owner,
      "source ownership is retained for retry",
    );
    assertEqual(
      fixture.filter._getAudioOwner(),
      fixture.owner,
      "processor ownership is retained for retry",
    );
    assert(
      fixture.events.some((event) => event.startsWith("disconnect:")),
      "failed graph connections are released",
    );
    assertEqual(runtime.state, "suspended", "runtime reports suspended");

    await runtime.resume();

    assertEqual(secondAttempts, 2, "failed source is retried");
    assertEqual(
      fixture.events.filter((event) => event === "connect:first->filter").length,
      2,
      "released graph connections are restored",
    );
    assertEqual(runtime.state, "running", "retry starts the graph");
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

  it("reactivates every source after a partial source suspension failure", async () => {
    const fixture = createFixture();
    const failure = new Error("second suspend failed");
    let firstActive = false;
    let secondActive = false;
    let firstActivations = 0;
    let secondActivations = 0;
    fixture.first.activate = async () => {
      firstActive = true;
      firstActivations += 1;
    };
    fixture.second.activate = async () => {
      secondActive = true;
      secondActivations += 1;
    };
    fixture.first.suspend = async () => {
      fixture.events.push("suspend:first");
      firstActive = false;
    };
    fixture.second.suspend = async () => {
      fixture.events.push("suspend:second");
      secondActive = false;
      throw failure;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;

    let rejected;
    try {
      await runtime.suspend();
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected, failure, "original source suspension error");
    assertEqual(
      fixture.events.slice(0, 2).join(","),
      "suspend:second,suspend:first",
      "reverse suspension continues after failure",
    );
    assertEqual(runtime.state, "suspended", "runtime requires source recovery");
    await runtime.resume();

    assertEqual(firstActive, true, "first source is repaired");
    assertEqual(secondActive, true, "second source is repaired");
    assertEqual(firstActivations, 2, "first source reactivates");
    assertEqual(secondActivations, 2, "second source reactivates");
  });

  it("reactivates every source after native suspension partially fails", async () => {
    const fixture = createFixture();
    const failure = new Error("native suspend failed");
    let firstActivations = 0;
    let secondActivations = 0;
    fixture.first.activate = async () => {
      firstActivations += 1;
    };
    fixture.second.activate = async () => {
      secondActivations += 1;
    };
    fixture.context.suspend = async () => {
      fixture.events.push("context:suspend");
      fixture.context.state = "suspended";
      throw failure;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();

    let rejected;
    try {
      await runtime.suspend();
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected, failure, "original native suspension error");
    assertEqual(runtime.state, "suspended", "runtime requires source recovery");
    await runtime.resume();

    assertEqual(firstActivations, 2, "first source reactivates");
    assertEqual(secondActivations, 2, "second source reactivates");
    assertEqual(fixture.context.state, "running", "native context is repaired");
  });

  it("replaces ended source node connections before reporting the source connected", async () => {
    const fixture = createFixture();
    const oldNode = createNativeNode("old-mic", fixture.events);
    const replacementNode = createNativeNode("new-mic", fixture.events);
    fixture.first.nativeNode = oldNode;
    let activations = 0;
    fixture.first.activate = async () => {
      activations += 1;
      if (activations === 1) return;
      oldNode.disconnect();
      fixture.first._detachAudioNode(oldNode);
      fixture.first._attachAudioNode(replacementNode);
      fixture.first.nativeNode = replacementNode;
    };
    fixture.first.connected = async () => {
      if (activations > 1) fixture.events.push("connected:replacement");
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    await runtime.suspend();
    fixture.events.length = 0;

    await runtime.resume();

    const oldDisconnect = fixture.events.indexOf("disconnect:old-mic->filter");
    const replacementConnect = fixture.events.indexOf("connect:new-mic->filter");
    const connected = fixture.events.indexOf("connected:replacement");
    assert(oldDisconnect >= 0, "old native pair is removed from runtime tracking");
    assert(
      oldDisconnect < replacementConnect && replacementConnect < connected,
      "replacement connects exactly before the connected hook",
    );
    assertEqual(
      fixture.events.filter((event) => event === "connect:new-mic->filter").length,
      1,
      "replacement edge connects once",
    );
    assertEqual(fixture.first._getAudioNode(), replacementNode, "element node is replaced");
  });

  it("cancels in-flight activation before opening or starting later sources", async () => {
    const fixture = createFixture();
    let resolveFirst;
    let firstConnected = 0;
    let secondActivations = 0;
    let firstClosed = false;
    fixture.first.activate = () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      });
    fixture.first.connected = async () => {
      firstConnected += 1;
    };
    fixture.first.close = async () => {
      firstClosed = true;
    };
    fixture.second.activate = async () => {
      secondActivations += 1;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    const resumeResult = runtime.resume().catch((error) => error);
    while (!resolveFirst) await Promise.resolve();

    const firstClose = runtime.close();
    const secondClose = runtime.close();
    assertEqual(firstClose, secondClose, "terminal callers share completion");
    resolveFirst();
    const resumeError = await resumeResult;
    await firstClose;

    assertEqual(resumeError.name, "InvalidStateError", "resume cancellation name");
    assertEqual(
      resumeError.message,
      "Audio context is closing",
      "resume cancellation message",
    );
    assertEqual(firstConnected, 0, "first source never emits open");
    assertEqual(secondActivations, 0, "later source never starts");
    assertEqual(firstClosed, true, "late first resource is terminally released");
    assertEqual(runtime.state, "closed", "close completes terminally");
  });

  it("adds replacement edges before removing obsolete edges", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;
    const candidate = {
      ...fixture.plan,
      edges: [
        { from: fixture.first, to: fixture.output },
        { from: fixture.filter, to: fixture.output },
        { from: fixture.second, to: fixture.filter },
      ],
    };

    await runtime.reconcile(candidate);

    assertEqual(
      fixture.events.join(","),
      "connect:first->output,disconnect:first->filter",
      "replacement connection order",
    );
  });

  it("atomically replaces a source before releasing its previous resource", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;
    const previousNode = fixture.first.nativeNode;
    const replacementNode = createNativeNode("replacement", fixture.events);

    runtime.replaceSource(fixture.first, {
      node: replacementNode,
      commit() {
        fixture.events.push("commit");
        fixture.first._detachAudioNode(previousNode);
        fixture.first._attachAudioNode(replacementNode);
        return { node: previousNode };
      },
      connected() {
        fixture.events.push("notify");
      },
      releasePrevious() {
        fixture.events.push("release:previous");
      },
      rollback() {
        fixture.events.push("rollback:replacement");
      },
    });

    assertEqual(
      fixture.events.join(","),
      "connect:replacement->filter,commit,disconnect:first->filter,notify,release:previous",
      "replacement transaction order",
    );
    assertEqual(fixture.first._getAudioNode(), replacementNode, "replacement is attached");
  });

  it("rolls back a source candidate when its replacement edge cannot connect", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;
    const failure = new Error("replacement connection failed");
    const replacementNode = createNativeNode("replacement", fixture.events);
    replacementNode.connect = () => {
      fixture.events.push("connect:replacement->filter");
      throw failure;
    };
    let rejected;

    try {
      runtime.replaceSource(fixture.first, {
        node: replacementNode,
        commit() {
          throw new Error("must not commit");
        },
        connected() {},
        releasePrevious() {},
        rollback() {
          fixture.events.push("rollback:replacement");
        },
      });
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected, failure, "native connection failure is preserved");
    assertEqual(
      fixture.events.join(","),
      "connect:replacement->filter,disconnect:replacement->filter,rollback:replacement",
      "candidate-only resources roll back",
    );
    assertEqual(fixture.first._getAudioNode(), fixture.first.nativeNode, "old node remains");
  });

  it("keeps a shared native destination connected until its last logical edge is removed", async () => {
    const events = [];
    const owner = document.createElement("div");
    const source = document.createElement("test-runtime-source");
    const firstOutput = document.createElement("test-runtime-node");
    const secondOutput = document.createElement("test-runtime-node");
    source.nativeNode = createNativeNode("source", events);
    const destination = createNativeNode("destination", events);
    firstOutput.nativeNode = destination;
    secondOutput.nativeNode = destination;
    const sourcePlanNode = { element: source, role: "source", rootSource: source };
    const firstOutputPlanNode = {
      element: firstOutput,
      role: "output",
      rootSource: source,
    };
    const secondOutputPlanNode = {
      element: secondOutput,
      role: "output",
      rootSource: source,
    };
    const plan = {
      nodes: [sourcePlanNode, firstOutputPlanNode, secondOutputPlanNode],
      edges: [
        { from: source, to: firstOutput },
        { from: source, to: secondOutput },
      ],
      sources: [sourcePlanNode],
    };
    const runtime = new AudioGraphRuntime(owner, createContext(events), plan);

    await runtime.resume();
    assertEqual(
      events.filter((event) => event === "connect:source->destination").length,
      1,
      "shared native edge connects once",
    );
    events.length = 0;

    await runtime.reconcile({
      nodes: [sourcePlanNode, secondOutputPlanNode],
      edges: [{ from: source, to: secondOutput }],
      sources: [sourcePlanNode],
    });
    assertEqual(events.length, 0, "retained logical edge keeps native edge connected");

    await runtime.reconcile({
      nodes: [sourcePlanNode],
      edges: [],
      sources: [sourcePlanNode],
    });
    assertEqual(
      events.filter((event) => event === "disconnect:source->destination").length,
      1,
      "last logical edge disconnects native edge",
    );
  });

  it("starts added sources in candidate DOM order and terminally removes old sources", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;

    const third = document.createElement("test-runtime-source");
    third.nativeNode = createNativeNode("third", fixture.events);
    third.activate = async () => fixture.events.push("activate:third");
    third.connected = async () => fixture.events.push("connected:third");
    fixture.first.close = async () => fixture.events.push("close:first");
    const candidate = {
      nodes: [
        { element: fixture.second, role: "source", rootSource: fixture.second },
        { element: fixture.filter, role: "processor", rootSource: fixture.second },
        { element: fixture.output, role: "output", rootSource: fixture.second },
        { element: third, role: "source", rootSource: third },
      ],
      edges: [
        { from: fixture.second, to: fixture.filter },
        { from: fixture.filter, to: fixture.output },
        { from: third, to: fixture.output },
      ],
      sources: [
        { element: fixture.second, role: "source", rootSource: fixture.second },
        { element: third, role: "source", rootSource: third },
      ],
    };

    await runtime.reconcile(candidate);

    assert(
      fixture.events.indexOf("connect:third->output") <
        fixture.events.indexOf("activate:third"),
      "new source is connected before activation",
    );
    assert(
      fixture.events.indexOf("activate:third") <
        fixture.events.indexOf("close:first"),
      "candidate starts before removed source cleanup",
    );
    assertEqual(
      fixture.events.filter((event) => event === "activate:second").length,
      0,
      "unchanged source is not restarted",
    );
    assertEqual(third._getAudioOwner(), fixture.owner, "new source is committed");
    assertEqual(fixture.first._getAudioOwner(), null, "removed source is released");
  });

  it("rolls back only candidate additions when a native connection fails", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;
    fixture.filter.configuration = 350;
    fixture.filter.candidateConfiguration = 900;
    const added = document.createElement("test-runtime-node");
    added.nativeNode = createNativeNode("added", fixture.events);
    added.nativeNode.connect = () => {
      fixture.events.push("connect:added->output");
      throw new Error("connect failed");
    };
    const candidate = {
      nodes: [
        ...fixture.plan.nodes,
        { element: added, role: "processor", rootSource: fixture.first },
      ],
      edges: [
        ...fixture.plan.edges,
        { from: fixture.first, to: added },
        { from: added, to: fixture.output },
      ],
      sources: fixture.plan.sources,
    };

    let rejected;
    try {
      await runtime.reconcile(candidate, {
        dirtyNodes: new Set([fixture.filter]),
      });
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected.message, "connect failed", "native failure is preserved");
    assert(
      fixture.events.includes("disconnect:first->added"),
      "successfully added edge is rolled back",
    );
    assert(
      !fixture.events.includes("disconnect:first->filter"),
      "old edge remains connected",
    );
    assertEqual(added._getAudioOwner(), null, "candidate node owner is released");
    assertEqual(fixture.first._getAudioOwner(), fixture.owner, "old owner remains");
    assertEqual(
      fixture.filter.configuration,
      350,
      "retained node configuration is rolled back",
    );
  });

  it("cleans a failed new source while preserving previously running sources", async () => {
    const fixture = createFixture();
    let oldCloses = 0;
    fixture.first.close = async () => {
      oldCloses += 1;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;
    const added = document.createElement("test-runtime-source");
    added.nativeNode = createNativeNode("added", fixture.events);
    added.activate = async () => {
      throw new Error("new source failed");
    };
    added.rollbackCandidate = async () => fixture.events.push("rollback:added");
    const candidate = {
      nodes: [
        ...fixture.plan.nodes,
        { element: added, role: "source", rootSource: added },
      ],
      edges: [...fixture.plan.edges, { from: added, to: fixture.output }],
      sources: [
        ...fixture.plan.sources,
        { element: added, role: "source", rootSource: added },
      ],
    };

    let rejected;
    try {
      await runtime.reconcile(candidate);
    } catch (error) {
      rejected = error;
    }

    assertEqual(rejected.message, "new source failed", "activation failure");
    assert(fixture.events.includes("rollback:added"), "failed source rolls back");
    assert(
      fixture.events.includes("disconnect:added->output"),
      "failed source edge is removed",
    );
    assertEqual(oldCloses, 0, "old sources remain running");
    assertEqual(runtime.state, "running", "runtime stays running");
    assertEqual(added._getAudioOwner(), null, "failed source is released");
  });

  it("cancels a stale added source before its connected hook and rolls back only additions", async () => {
    const fixture = createFixture();
    let oldCloses = 0;
    fixture.first.close = async () => {
      oldCloses += 1;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;

    const added = document.createElement("test-runtime-source");
    added.nativeNode = createNativeNode("added", fixture.events);
    let resolveActivation;
    let connected = 0;
    let rolledBack = 0;
    added.activate = () =>
      new Promise((resolve) => {
        resolveActivation = resolve;
      });
    added.connected = async () => {
      connected += 1;
    };
    added.rollbackCandidate = async () => {
      rolledBack += 1;
    };
    const candidate = {
      nodes: [
        ...fixture.plan.nodes,
        { element: added, role: "source", rootSource: added },
      ],
      edges: [...fixture.plan.edges, { from: added, to: fixture.output }],
      sources: [
        ...fixture.plan.sources,
        { element: added, role: "source", rootSource: added },
      ],
    };
    let current = true;
    const reconciling = runtime.reconcile(candidate, {
      isCurrent: () => current,
    });
    while (!resolveActivation) await Promise.resolve();

    current = false;
    resolveActivation();
    const committed = await reconciling;

    assertEqual(committed, false, "stale candidate is not committed");
    assertEqual(connected, 0, "stale source never reaches connected hook");
    assertEqual(rolledBack, 1, "stale source resource is rolled back");
    assertEqual(oldCloses, 0, "old sources remain running");
    assertEqual(added._getAudioOwner(), null, "stale source owner is released");
    assertEqual(runtime.state, "running", "old runtime stays running");
  });

  it("retries a stale added microphone with a fresh stream and commits one open", async () => {
    const fixture = createFixture();
    let existingCloses = 0;
    fixture.first.close = async () => {
      existingCloses += 1;
    };
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    fixture.events.length = 0;

    const mic = document.createElement("test-runtime-mic");
    const firstTrack = {
      readyState: "live",
      enabled: true,
      stop() {
        this.readyState = "ended";
        fixture.events.push("stop:first-track");
      },
    };
    const secondTrack = {
      readyState: "live",
      enabled: true,
      stop() {
        this.readyState = "ended";
        fixture.events.push("stop:second-track");
      },
    };
    const firstStream = { getTracks: () => [firstTrack] };
    const secondStream = { getTracks: () => [secondTrack] };
    let resolveFirstStream;
    let requests = 0;
    const restoreMediaDevices = installMediaDevices(() => {
      requests += 1;
      if (requests === 1) {
        return new Promise((resolve) => {
          resolveFirstStream = resolve;
        });
      }
      return Promise.resolve(secondStream);
    });
    fixture.context.createMediaStreamSource = (stream) =>
      createNativeNode(
        stream === firstStream ? "stale-mic" : "committed-mic",
        fixture.events,
      );
    let opens = 0;
    let closes = 0;
    let errors = 0;
    mic.addEventListener("open", () => {
      opens += 1;
      fixture.events.push("open:mic");
    });
    mic.addEventListener("close", () => {
      closes += 1;
    });
    mic.addEventListener("error", () => {
      errors += 1;
    });
    const candidate = {
      nodes: [
        ...fixture.plan.nodes,
        { element: mic, role: "source", rootSource: mic },
      ],
      edges: [...fixture.plan.edges, { from: mic, to: fixture.filter }],
      sources: [
        ...fixture.plan.sources,
        { element: mic, role: "source", rootSource: mic },
      ],
    };
    let current = true;

    try {
      const firstReconciliation = runtime.reconcile(candidate, {
        isCurrent: () => current,
      });
      while (!resolveFirstStream) await Promise.resolve();
      current = false;
      resolveFirstStream(firstStream);

      assertEqual(await firstReconciliation, false, "stale mic is not committed");
      assertEqual(firstTrack.readyState, "ended", "provisional track is stopped");
      assert(fixture.events.includes("disconnect:stale-mic"), "provisional node disconnects");
      assertEqual(opens, 0, "stale mic emits no open");
      assertEqual(closes, 0, "nonterminal rollback emits no close");
      assertEqual(errors, 0, "stale mic emits no error");
      assertEqual(existingCloses, 0, "existing sources remain running");

      fixture.events.length = 0;
      current = true;
      assertEqual(await runtime.reconcile(candidate), true, "fresh mic commits");

      assertEqual(requests, 2, "retry acquires a fresh stream");
      assertEqual(secondTrack.readyState, "live", "committed track stays live");
      assertEqual(opens, 1, "committed mic opens once");
      assertEqual(closes, 0, "successful retry remains nonterminal");
      assertEqual(errors, 0, "successful retry emits no error");
      assert(
        fixture.events.indexOf("connect:committed-mic->filter") <
          fixture.events.indexOf("open:mic"),
        "fresh node connects before open",
      );
      assertEqual(mic._getAudioOwner(), fixture.owner, "committed mic keeps owner");
    } finally {
      restoreMediaDevices();
    }
  });

  it("uses terminal cleanup when close is requested during candidate activation", async () => {
    const fixture = createFixture();
    const runtime = new AudioGraphRuntime(
      fixture.owner,
      fixture.context,
      fixture.plan,
    );
    await runtime.resume();
    const added = document.createElement("test-runtime-source");
    added.nativeNode = createNativeNode("added", fixture.events);
    let resolveActivation;
    let rollbacks = 0;
    let closes = 0;
    added.activate = () =>
      new Promise((resolve) => {
        resolveActivation = resolve;
      });
    added.rollbackCandidate = async () => {
      rollbacks += 1;
    };
    added.close = async () => {
      closes += 1;
    };
    const candidate = {
      nodes: [
        ...fixture.plan.nodes,
        { element: added, role: "source", rootSource: added },
      ],
      edges: [...fixture.plan.edges, { from: added, to: fixture.output }],
      sources: [
        ...fixture.plan.sources,
        { element: added, role: "source", rootSource: added },
      ],
    };
    const result = runtime.reconcile(candidate).catch((error) => error);
    while (!resolveActivation) await Promise.resolve();

    runtime._requestTerminalClose();
    resolveActivation();
    const error = await result;

    assertEqual(error.name, "InvalidStateError", "terminal request cancels candidate");
    assertEqual(closes, 1, "candidate source closes terminally");
    assertEqual(rollbacks, 0, "terminal request does not use reusable rollback");
    await runtime.close();
  });
});
