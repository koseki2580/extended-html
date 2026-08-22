import { AudioContextElement } from "../../src/audio/audio-context.js";
import { AudioInputFileElement } from "../../src/audio/audio-input-file.js";
import { AudioBiquadFilterElement } from "../../src/audio/audio-biquad-filter.js";
import { AudioOutputElement } from "../../src/audio/audio-output.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertRejects = async (promise, name, message) => {
  try {
    await promise;
  } catch (error) {
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return error;
  }
  throw new Error("expected a rejection");
};

if (!customElements.get("audio-context")) {
  customElements.define("audio-context", AudioContextElement);
}
if (!customElements.get("audio-input-file")) {
  customElements.define("audio-input-file", AudioInputFileElement);
}
if (!customElements.get("audio-biquad-filter")) {
  customElements.define("audio-biquad-filter", AudioBiquadFilterElement);
}
if (!customElements.get("audio-output")) {
  customElements.define("audio-output", AudioOutputElement);
}

class FakeAudioContext extends EventTarget {
  static instances = [];
  static nodeCreations = 0;
  static mediaSourceCreations = 0;

  constructor() {
    super();
    this.state = "suspended";
    this.currentTime = 12.5;
    this.sampleRate = 48_000;
    this.events = [];
    this.destination = this.createNode("destination");
    FakeAudioContext.instances.push(this);
  }

  createNode(name) {
    FakeAudioContext.nodeCreations += 1;
    return {
      name,
      connect: (target) => this.events.push(`connect:${name}->${target.name}`),
      disconnect: () => this.events.push(`disconnect:${name}`),
    };
  }

  createMediaElementSource() {
    FakeAudioContext.mediaSourceCreations += 1;
    return this.createNode("file");
  }

  createBiquadFilter() {
    return {
      ...this.createNode("filter"),
      type: "lowpass",
      frequency: { value: 350 },
      detune: { value: 0 },
      Q: { value: 1 },
      gain: { value: 0 },
    };
  }

  async resume() {
    this.events.push("resume");
    this.state = "running";
    this.dispatchEvent(new Event("statechange"));
  }

  async suspend() {
    this.events.push("suspend");
    this.state = "suspended";
    this.dispatchEvent(new Event("statechange"));
  }

  async close() {
    this.events.push("close");
    this.state = "closed";
    this.dispatchEvent(new Event("statechange"));
  }
}

const nativeDescriptor = Object.getOwnPropertyDescriptor(globalThis, "AudioContext");

const installFakeAudioContext = () => {
  FakeAudioContext.instances.length = 0;
  FakeAudioContext.nodeCreations = 0;
  FakeAudioContext.mediaSourceCreations = 0;
  Object.defineProperty(globalThis, "AudioContext", {
    configurable: true,
    writable: true,
    value: FakeAudioContext,
  });
};

const restoreAudioContext = () => {
  if (nativeDescriptor) Object.defineProperty(globalThis, "AudioContext", nativeDescriptor);
  else delete globalThis.AudioContext;
};

const createElement = () => {
  const context = document.createElement("audio-context");
  context.id = "audio";
  context.innerHTML = `
    <audio-input-file>
      <audio-biquad-filter><audio-output></audio-output></audio-biquad-filter>
    </audio-input-file>`;
  const file = context.querySelector("audio-input-file");
  file._getMediaElement().play = async () => {};
  file._getMediaElement().pause = () => {};
  return { context, file };
};

const flushReconciliation = () =>
  new Promise((resolve) => setTimeout(resolve, 0));

describe("AudioContextElement", () => {
  beforeEach(installFakeAudioContext);
  afterEach(() => {
    for (const element of document.querySelectorAll("audio-context")) element.remove();
    restoreAudioContext();
  });

  it("creates no native context until resume and proxies native state", async () => {
    const { context } = createElement();

    assertEqual(FakeAudioContext.instances.length, 0, "native context is lazy");
    assertEqual(context.state, "suspended", "initial state");
    assertEqual(context.currentTime, 0, "initial currentTime");
    assertEqual(context.sampleRate, null, "initial sampleRate");
    await context.resume();

    assertEqual(FakeAudioContext.instances.length, 1, "one native context");
    assertEqual(context.state, "running", "running state");
    assertEqual(context.currentTime, 12.5, "native currentTime");
    assertEqual(context.sampleRate, 48_000, "native sampleRate");
  });

  it("validates the complete graph before creating native resources", async () => {
    const context = document.createElement("audio-context");
    context.innerHTML = "<audio-output></audio-output>";

    await assertRejects(
      context.resume(),
      "SyntaxError",
      "<audio-output> must be nested directly under a recognized audio node",
    );

    assertEqual(FakeAudioContext.instances.length, 0, "invalid graph creates no context");
  });

  it("preflights node configuration before creating browser resources", async () => {
    const { context } = createElement();
    context.querySelector("audio-biquad-filter").setAttribute("frequency", "12px");

    await assertRejects(
      context.resume(),
      "SyntaxError",
      'Biquad frequency must be a finite number, received "12px"',
    );

    assertEqual(FakeAudioContext.instances.length, 0, "no native context");
    assertEqual(FakeAudioContext.nodeCreations, 0, "no native node");
    assertEqual(FakeAudioContext.mediaSourceCreations, 0, "no media source");
  });

  it("coalesces concurrent resume and suspend calls", async () => {
    const { context } = createElement();
    const firstResume = context.resume();
    const secondResume = context.resume();
    assertEqual(firstResume, secondResume, "resume callers share a promise");
    await firstResume;

    const native = FakeAudioContext.instances[0];
    const firstSuspend = context.suspend();
    const secondSuspend = context.suspend();
    assertEqual(firstSuspend, secondSuspend, "suspend callers share a promise");
    await firstSuspend;

    assertEqual(
      native.events.filter((event) => event === "resume").length,
      1,
      "one resume",
    );
    assertEqual(
      native.events.filter((event) => event === "suspend").length,
      1,
      "one suspend",
    );
  });

  it("serializes alternating lifecycle requests in call order", async () => {
    const { context } = createElement();

    const firstResume = context.resume();
    const suspend = context.suspend();
    const finalResume = context.resume();
    assert(firstResume !== finalResume, "a resume after suspend is a new operation");
    await Promise.all([firstResume, suspend, finalResume]);

    const native = FakeAudioContext.instances[0];
    assertEqual(context.state, "running", "last requested state wins");
    assertEqual(
      native.events
        .filter((event) => ["resume", "suspend"].includes(event))
        .join(","),
      "resume,suspend,resume",
      "operations stay ordered",
    );
  });

  it("proxies and wraps native state changes with context metadata", async () => {
    const { context } = createElement();
    const states = [];
    context.onstatechange = (event) => states.push(event);
    await context.resume();
    const native = FakeAudioContext.instances[0];
    states.length = 0;

    native.state = "interrupted";
    const nativeEvent = new Event("statechange");
    native.dispatchEvent(nativeEvent);

    assertEqual(context.state, "interrupted", "state follows the native context");
    assertEqual(states.length, 1, "one wrapped native event");
    assertEqual(states[0].detail.data, nativeEvent, "native event data");
    assertEqual(states[0].detail.metadata.contextId, "audio", "context metadata");
    assertEqual(states[0].detail.metadata.nodeId, "audio", "node metadata");
    assertEqual(states[0].detail.metadata.nodeName, "audio-context", "node name");
  });

  it("resumes a natively interrupted context without replaying active sources", async () => {
    const { context, file } = createElement();
    await context.resume();
    const native = FakeAudioContext.instances[0];
    let plays = 0;
    file._getMediaElement().play = async () => {
      plays += 1;
    };
    native.state = "interrupted";

    await context.resume();

    assertEqual(context.state, "running", "native context resumes");
    assertEqual(plays, 0, "already active file is not replayed");
    assertEqual(
      native.events.filter((event) => event === "resume").length,
      2,
      "native resume is invoked again",
    );
  });

  it("wraps lifecycle errors without synthesizing state changes", async () => {
    const { context, file } = createElement();
    const failure = new Error("play failed");
    file._getMediaElement().play = async () => {
      throw failure;
    };
    const states = [];
    let receivedError;
    context.onstatechange = (event) => states.push(event);
    context.onerror = (event) => {
      receivedError = event;
    };

    const rejected = await assertRejects(context.resume(), "Error", "play failed");

    assertEqual(rejected, failure, "original error is preserved");
    assertEqual(states.length, 2, "native resume and rollback changes are wrapped");
    assert(states.every((event) => event.detail.data instanceof Event), "native event data");
    assertEqual(context.state, "suspended", "state follows native rollback");
    assertEqual(states[0].detail.metadata.contextId, "audio", "state context metadata");
    assertEqual(states[0].detail.metadata.nodeId, "audio", "state node metadata");
    assertEqual(states[0].detail.metadata.nodeName, "audio-context", "state node name");
    assertEqual(receivedError.detail.data, failure, "error data");
    assertEqual(receivedError.detail.metadata.contextId, "audio", "error metadata");
  });

  it("shares terminal close and rejects lifecycle operations afterwards", async () => {
    const { context } = createElement();
    await context.resume();

    const firstClose = context.close();
    const secondClose = context.close();
    assertEqual(firstClose, secondClose, "close callers share a promise");
    await firstClose;

    assertEqual(context.state, "closed", "closed state");
    await assertRejects(
      context.resume(),
      "InvalidStateError",
      "Audio context is closed",
    );
    await assertRejects(
      context.suspend(),
      "InvalidStateError",
      "Audio context is closed",
    );
  });

  it("forwards one asynchronously queued native closed state before detaching", async () => {
    const { context } = createElement();
    const states = [];
    context.onstatechange = (event) => states.push(event);
    await context.resume();
    const native = FakeAudioContext.instances[0];
    states.length = 0;
    native.close = () => {
      native.events.push("close");
      setTimeout(() => {
        native.state = "closed";
        native.dispatchEvent(new Event("statechange"));
      }, 0);
      return Promise.resolve();
    };

    await context.close();
    assertEqual(states.length, 0, "close resolution does not synthesize an event");
    await new Promise((resolve) => setTimeout(resolve, 0));

    assertEqual(states.length, 1, "queued closed state is forwarded once");
    assertEqual(states[0].detail.data.type, "statechange", "native event data");
    assertEqual(context.state, "closed", "native closed state is proxied");
    native.dispatchEvent(new Event("statechange"));
    assertEqual(states.length, 1, "listener detaches after forwarding closed");
  });

  it("uses DOM removal as terminal cleanup without an unhandled rejection", async () => {
    const { context } = createElement();
    document.body.append(context);
    await context.resume();
    const native = FakeAudioContext.instances[0];
    let unhandled = false;
    const onUnhandled = () => {
      unhandled = true;
    };
    globalThis.addEventListener("unhandledrejection", onUnhandled);

    context.remove();
    await new Promise((resolve) => setTimeout(resolve, 0));

    globalThis.removeEventListener("unhandledrejection", onUnhandled);
    assertEqual(context.state, "closed", "removal closes element");
    assertEqual(native.state, "closed", "removal closes native context");
    assertEqual(unhandled, false, "cleanup rejection is handled");
  });

  it("cancels in-flight resume when removed before starting later sources", async () => {
    const { context, file: first } = createElement();
    const second = document.createElement("audio-input-file");
    second.append(document.createElement("audio-output"));
    context.append(second);
    let resolveFirst;
    let firstPauses = 0;
    let secondPlays = 0;
    first._getMediaElement().play = () =>
      new Promise((resolve) => {
        resolveFirst = resolve;
      });
    first._getMediaElement().pause = () => {
      firstPauses += 1;
    };
    second._getMediaElement().play = async () => {
      secondPlays += 1;
    };
    document.body.append(context);
    const resumeResult = context.resume().catch((error) => error);
    while (!resolveFirst) await Promise.resolve();

    context.remove();
    const closeResult = context.close();
    resolveFirst();
    const resumeError = await resumeResult;
    await closeResult;

    assertEqual(resumeError.name, "InvalidStateError", "resume cancellation name");
    assertEqual(secondPlays, 0, "later file never starts");
    assert(firstPauses >= 1, "late first playback is released");
    assertEqual(context.state, "closed", "removal close completes");
  });

  it("batches same-turn graph mutations and applies only the final valid candidate", async () => {
    const { context } = createElement();
    document.body.append(context);
    await context.resume();
    const errors = [];
    context.onerror = (event) => errors.push(event.detail.data);
    const source = context.querySelector("audio-input-file");
    const second = document.createElement("audio-input-file");
    second.innerHTML = `
      <audio-biquad-filter id="later"><audio-output></audio-output></audio-biquad-filter>`;
    second._getMediaElement().play = async () => {};
    second._getMediaElement().pause = () => {};

    source.setAttribute("to", "later");
    context.append(second);
    await flushReconciliation();

    assertEqual(errors.length, 0, "transient invalid state is not reconciled");
    assertEqual(
      FakeAudioContext.instances[0].events.filter(
        (event) => event === "connect:file->filter",
      ).length,
      3,
      "one structural edge per source plus the final cross-tree edge",
    );
  });

  it("updates live filter configuration and reports invalid candidates without stopping", async () => {
    const { context } = createElement();
    document.body.append(context);
    await context.resume();
    const filter = context.querySelector("audio-biquad-filter");
    const native = FakeAudioContext.instances[0];
    const nodeCreations = FakeAudioContext.nodeCreations;
    const errors = [];
    context.onerror = (event) => errors.push(event.detail.data);

    native.events.length = 0;
    filter.setAttribute("frequency", "900");
    await flushReconciliation();
    assertEqual(filter.frequency.value, 900, "valid live value is applied");
    assertEqual(
      FakeAudioContext.nodeCreations,
      nodeCreations,
      "live configuration reuses native nodes",
    );
    assert(
      !native.events.some(
        (event) => event.startsWith("connect:") || event.startsWith("disconnect:"),
      ),
      "live configuration does not replace graph edges",
    );

    filter.setAttribute("frequency", "12px");
    await flushReconciliation();
    assertEqual(filter.frequency.value, 900, "invalid live value is preserved");
    assertEqual(errors.length, 1, "invalid candidate reports one error");
    assertEqual(errors[0].name, "SyntaxError", "wrapped validation error");
    assertEqual(context.state, "running", "recoverable error keeps context running");

    filter.setAttribute("frequency", "1200");
    await flushReconciliation();
    assertEqual(filter.frequency.value, 1200, "observer recovers after failure");
    assertEqual(errors.length, 1, "valid recovery adds no error");
  });

  it("reconciles added and removed running sources without restarting unchanged sources", async () => {
    const { context, file: first } = createElement();
    document.body.append(context);
    let firstPlays = 0;
    let firstPauses = 0;
    first._getMediaElement().play = async () => {
      firstPlays += 1;
    };
    first._getMediaElement().pause = () => {
      firstPauses += 1;
    };
    await context.resume();

    const second = document.createElement("audio-input-file");
    second.append(document.createElement("audio-output"));
    let secondPlays = 0;
    let secondPauses = 0;
    second._getMediaElement().play = async () => {
      secondPlays += 1;
    };
    second._getMediaElement().pause = () => {
      secondPauses += 1;
    };
    context.append(second);
    await flushReconciliation();

    assertEqual(firstPlays, 1, "existing source is not replayed");
    assertEqual(secondPlays, 1, "new source starts");

    second.remove();
    await flushReconciliation();
    assertEqual(secondPauses, 1, "removed source closes");
    assertEqual(firstPauses, 0, "existing source keeps running");
    assertEqual(context.state, "running", "context remains running");
  });

  it("preserves the last valid graph after an invalid live mutation", async () => {
    const { context } = createElement();
    document.body.append(context);
    await context.resume();
    const native = FakeAudioContext.instances[0];
    const source = context.querySelector("audio-input-file");
    const errors = [];
    context.onerror = (event) => errors.push(event.detail.data);
    native.events.length = 0;

    source.setAttribute("to", "missing");
    await flushReconciliation();

    assertEqual(errors.length, 1, "invalid candidate reports an error");
    assertEqual(errors[0].name, "SyntaxError", "graph validation error");
    assert(
      !native.events.some((event) => event.startsWith("disconnect:")),
      "old graph remains connected",
    );
    assertEqual(context.state, "running", "old graph keeps running");

    const second = document.createElement("audio-input-file");
    second.innerHTML = `
      <audio-biquad-filter id="missing"><audio-output></audio-output></audio-biquad-filter>`;
    second._getMediaElement().play = async () => {};
    second._getMediaElement().pause = () => {};
    context.append(second);
    await flushReconciliation();

    assertEqual(errors.length, 1, "valid follow-up adds no error");
    assert(
      native.events.filter((event) => event === "connect:file->filter").length >= 2,
      "observer applies a valid candidate after failure",
    );
  });

  it("reports a new-source activation failure while old sources keep running", async () => {
    const { context, file: first } = createElement();
    document.body.append(context);
    let firstPauses = 0;
    first._getMediaElement().pause = () => {
      firstPauses += 1;
    };
    await context.resume();
    const native = FakeAudioContext.instances[0];
    const errors = [];
    context.onerror = (event) => errors.push(event.detail.data);
    native.events.length = 0;

    const failing = document.createElement("audio-input-file");
    failing.append(document.createElement("audio-output"));
    failing._getMediaElement().play = async () => {
      throw new Error("added playback failed");
    };
    let failingPauses = 0;
    failing._getMediaElement().pause = () => {
      failingPauses += 1;
    };
    context.append(failing);
    await flushReconciliation();

    assertEqual(errors.length, 1, "activation failure is reported");
    assertEqual(errors[0].message, "added playback failed", "original failure data");
    assertEqual(firstPauses, 0, "old source is not stopped");
    assertEqual(failingPauses, 1, "failed source is cleaned");
    assertEqual(context.state, "running", "old graph remains running");
    assert(
      !native.events.includes("disconnect:file->filter"),
      "old graph edge is preserved",
    );
  });

  it("disconnects its observer synchronously when terminal close starts", async () => {
    const { context } = createElement();
    document.body.append(context);
    await context.resume();
    const errors = [];
    context.onerror = (event) => errors.push(event.detail.data);

    const closing = context.close();
    context.querySelector("audio-input-file").setAttribute("to", "missing");
    await closing;
    await flushReconciliation();

    assertEqual(errors.length, 0, "post-close mutation is ignored");
    assertEqual(context.state, "closed", "context stays closed");
  });
});
