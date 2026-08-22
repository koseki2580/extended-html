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
    return {
      name,
      connect: (target) => this.events.push(`connect:${name}->${target.name}`),
      disconnect: () => this.events.push(`disconnect:${name}`),
    };
  }

  createMediaElementSource() {
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
});
