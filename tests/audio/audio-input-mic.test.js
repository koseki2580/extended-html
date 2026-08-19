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

const assertRejects = async (promise, ErrorType, name, message) => {
  try {
    await promise;
  } catch (error) {
    assert(error instanceof ErrorType, `expected ${ErrorType.name}`);
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return error;
  }
  throw new Error("expected a rejection");
};

if (!customElements.get("test-audio-input-mic")) {
  customElements.define("test-audio-input-mic", AudioInputMicElement);
}

const createElement = () => document.createElement("test-audio-input-mic");

const createTrack = (events = [], name = "track") => ({
  enabled: true,
  readyState: "live",
  stop() {
    events.push(`stop:${name}`);
    this.readyState = "ended";
  },
});

const createStream = (tracks) => ({
  getTracks: () => tracks,
});

const createContext = (events = []) => {
  const nodes = [];
  return {
    nodes,
    createMediaStreamSource(stream) {
      events.push("create");
      const node = {
        stream,
        disconnectCalls: 0,
        disconnect() {
          this.disconnectCalls += 1;
          events.push("disconnect");
        },
      };
      nodes.push(node);
      return node;
    },
  };
};

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

describe("AudioInputMicElement", () => {
  it("defers open until the runtime reports that graph connections are ready", async () => {
    const element = createElement();
    element.id = "mic";
    element._setAudioOwner({ id: "audio" });
    const events = [];
    const track = createTrack();
    const stream = createStream([track]);
    const context = createContext(events);
    let resolveStream;
    const restore = installMediaDevices((constraints) => {
      events.push(`request:${JSON.stringify(constraints)}`);
      return new Promise((resolve) => {
        resolveStream = resolve;
      });
    });
    let opened;
    element.addEventListener("open", (event) => {
      events.push("open");
      opened = event;
    });

    try {
      const activation = element._activate(context);
      await Promise.resolve();
      assertEqual(context.nodes.length, 0, "source is not created before acquisition");
      resolveStream(stream);
      await activation;

      assertEqual(
        events.join(","),
        'request:{"audio":true},create',
        "acquisition readiness order",
      );
      assertEqual(context.nodes[0].stream, stream, "stream reaches source creation");
      assertEqual(element._getAudioNode(), context.nodes[0], "native source is attached");
      assertEqual(opened, undefined, "open is not emitted before graph connection");

      await element._connected();

      assertEqual(events.at(-1), "open", "open follows the connection hook");
      assertEqual(opened.detail.data, stream, "open data");
      assertEqual(opened.detail.metadata.contextId, "audio", "open context metadata");
      assertEqual(opened.detail.metadata.nodeId, "mic", "open node metadata");
      assertEqual(opened.detail.metadata.nodeName, "test-audio-input-mic", "open node name");
    } finally {
      restore();
    }
  });

  it("coalesces concurrent activation and re-enables existing live tracks", async () => {
    const element = createElement();
    const first = createTrack([], "first");
    const second = createTrack([], "second");
    const stream = createStream([first, second]);
    const context = createContext();
    let requests = 0;
    let resolveStream;
    const restore = installMediaDevices(() => {
      requests += 1;
      return new Promise((resolve) => {
        resolveStream = resolve;
      });
    });
    let opens = 0;
    element.addEventListener("open", () => {
      opens += 1;
    });

    try {
      const firstActivation = element._activate(context);
      const secondActivation = element._activate(context);
      resolveStream(stream);
      await Promise.all([firstActivation, secondActivation]);
      await element._connected();
      await element._suspend();
      assertEqual(first.enabled, false, "first track is disabled");
      assertEqual(second.enabled, false, "second track is disabled");

      await element._activate(context);
      await element._connected();

      assertEqual(first.enabled, true, "first track is re-enabled");
      assertEqual(second.enabled, true, "second track is re-enabled");
      assertEqual(requests, 1, "live stream is not reacquired");
      assertEqual(context.nodes.length, 1, "source is created once");
      assertEqual(opens, 1, "open describes acquisition rather than every resume");
    } finally {
      restore();
    }
  });

  it("shares pending close and cancels late acquisition before node creation", async () => {
    const element = createElement();
    const events = [];
    const track = createTrack(events);
    const stream = createStream([track]);
    const context = createContext(events);
    let resolveStream;
    const restore = installMediaDevices(
      () =>
        new Promise((resolve) => {
          resolveStream = resolve;
        }),
    );
    let opens = 0;
    let closes = 0;
    element.addEventListener("open", () => {
      opens += 1;
      events.push("open");
    });
    element.addEventListener("close", (event) => {
      closes += 1;
      events.push("close");
      assertEqual(event.detail.data, stream, "late stream is close data");
    });

    try {
      const activationResult = element._activate(context).catch((error) => error);
      const firstClose = element._close();
      const secondClose = element._close();
      let firstResolved = false;
      let secondResolved = false;
      firstClose.then(() => {
        firstResolved = true;
        events.push("first-resolved");
      });
      secondClose.then(() => {
        secondResolved = true;
        events.push("second-resolved");
      });

      assertEqual(firstClose, secondClose, "close callers share one promise");
      await Promise.resolve();
      assertEqual(firstResolved, false, "first close waits for acquisition");
      assertEqual(secondResolved, false, "second close waits for acquisition");

      resolveStream(stream);
      const activationError = await activationResult;
      await Promise.all([firstClose, secondClose]);

      assertEqual(activationError.name, "InvalidStateError", "activation is cancelled");
      assertEqual(activationError.message, "Microphone input is closed", "cancel message");
      assertEqual(context.nodes.length, 0, "late stream never creates a native node");
      assertEqual(opens, 0, "late stream never emits open");
      assertEqual(closes, 1, "terminal close is emitted once");
      assertEqual(
        events.join(","),
        "stop:track,close,first-resolved,second-resolved",
        "all close callers resolve after cleanup and event dispatch",
      );
      await assertRejects(
        Promise.resolve().then(() => element._getAudioNode()),
        DOMException,
        "InvalidStateError",
        "Audio node is not attached",
      );
    } finally {
      restore();
    }
  });

  it("suspends every owned track", async () => {
    const element = createElement();
    const tracks = [createTrack(), createTrack()];
    const restore = installMediaDevices(async () => createStream(tracks));

    try {
      await element._activate(createContext());
      tracks[1].readyState = "ended";
      await element._suspend();

      assert(tracks.every((track) => track.enabled === false), "all tracks are disabled");
    } finally {
      restore();
    }
  });

  it("stops every track, disconnects its source, and emits close afterwards", async () => {
    const element = createElement();
    const events = [];
    const tracks = [createTrack(events, "first"), createTrack(events, "second")];
    const stream = createStream(tracks);
    const context = createContext(events);
    const restore = installMediaDevices(async () => stream);
    element.addEventListener("close", (event) => {
      events.push("close");
      assertEqual(event.detail.data, stream, "close data");
    });

    try {
      await element._activate(context);
      events.length = 0;
      await element._close();

      assertEqual(
        events.join(","),
        "stop:first,stop:second,disconnect,close",
        "terminal cleanup order",
      );
      assertEqual(context.nodes[0].disconnectCalls, 1, "source is disconnected once");
      assertEqual(tracks[0].readyState, "ended", "first track ended");
      assertEqual(tracks[1].readyState, "ended", "second track ended");
      await assertRejects(
        Promise.resolve().then(() => element._getAudioNode()),
        DOMException,
        "InvalidStateError",
        "Audio node is not attached",
      );
      await element._close();
      assertEqual(context.nodes[0].disconnectCalls, 1, "repeated close is idempotent");
    } finally {
      restore();
    }
  });

  it("rejects and emits a wrapped error when acquisition fails", async () => {
    const element = createElement();
    element.id = "mic";
    element._setAudioOwner({ id: "audio" });
    const failure = new DOMException("permission denied", "NotAllowedError");
    const restore = installMediaDevices(async () => {
      throw failure;
    });
    let received;
    element.addEventListener("error", (event) => {
      received = event;
    });

    try {
      const rejected = await assertRejects(
        element._activate(createContext()),
        DOMException,
        "NotAllowedError",
        "permission denied",
      );

      assertEqual(rejected, failure, "original acquisition error is preserved");
      assertEqual(received.detail.data, failure, "error data");
      assertEqual(received.detail.metadata.contextId, "audio", "error context metadata");
      assertEqual(received.detail.metadata.nodeId, "mic", "error node metadata");
    } finally {
      restore();
    }
  });

  it("releases an acquired stream when native source creation fails", async () => {
    const element = createElement();
    const events = [];
    const track = createTrack(events);
    const stream = createStream([track]);
    const failure = new Error("source creation failed");
    const context = {
      createMediaStreamSource() {
        throw failure;
      },
    };
    const restore = installMediaDevices(async () => stream);
    let received;
    element.addEventListener("error", (event) => {
      received = event;
    });

    try {
      const rejected = await assertRejects(
        element._activate(context),
        Error,
        "Error",
        "source creation failed",
      );

      assertEqual(rejected, failure, "original creation error is preserved");
      assertEqual(events.join(","), "stop:track", "acquired track is released");
      assertEqual(received.detail.data, failure, "creation failure is wrapped");
    } finally {
      restore();
    }
  });

  it("reacquires after every prior track has ended", async () => {
    const element = createElement();
    const firstTrack = createTrack();
    const secondTrack = createTrack();
    const streams = [createStream([firstTrack]), createStream([secondTrack])];
    const context = createContext();
    let requests = 0;
    const restore = installMediaDevices(async () => streams[requests++]);

    try {
      await element._activate(context);
      firstTrack.readyState = "ended";
      await element._activate(context);

      assertEqual(requests, 2, "ended stream is reacquired");
      assertEqual(context.nodes.length, 2, "replacement source is created");
      assertEqual(context.nodes[0].disconnectCalls, 1, "ended source is disconnected");
      assertEqual(element._getAudioNode(), context.nodes[1], "replacement source is attached");
    } finally {
      restore();
    }
  });

  it("rejects a different AudioContext and activation after terminal close", async () => {
    const element = createElement();
    const track = createTrack();
    let requests = 0;
    const restore = installMediaDevices(async () => {
      requests += 1;
      return createStream([track]);
    });
    const firstContext = createContext();
    const secondContext = createContext();

    try {
      await element._activate(firstContext);
      await assertRejects(
        element._activate(secondContext),
        DOMException,
        "InvalidStateError",
        "Microphone input already belongs to a different AudioContext",
      );
      await element._close();
      await assertRejects(
        element._activate(firstContext),
        DOMException,
        "InvalidStateError",
        "Microphone input is closed",
      );

      assertEqual(requests, 1, "invalid activations do not reacquire media");
    } finally {
      restore();
    }
  });

  it("does not expose independent public open or close methods", () => {
    const element = createElement();

    assertEqual("open" in element, false, "public open is absent");
    assertEqual("close" in element, false, "public close is absent");
    assertEqual(typeof element._activate, "function", "context activation hook exists");
    assertEqual(typeof element._close, "function", "context close hook exists");
  });
});
