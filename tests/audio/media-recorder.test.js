import { MediaRecorderElement } from "../../src/audio/media-recorder.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertThrows = (callback, name, message) => {
  try {
    callback();
  } catch (error) {
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return;
  }
  throw new Error("expected an error");
};

const recorderEvent = (type, properties = {}) => {
  const event = new Event(type);
  for (const [name, value] of Object.entries(properties)) {
    Object.defineProperty(event, name, { value });
  }
  return event;
};

class FakeMediaRecorder extends EventTarget {
  static instances = [];
  static supported = new Set(["audio/webm"]);

  static isTypeSupported(type) {
    return this.supported.has(type);
  }

  constructor(stream, options = {}) {
    super();
    this.stream = stream;
    this.options = options;
    this.mimeType = options.mimeType ?? "audio/webm";
    this.state = "inactive";
    this.startArguments = [];
    this.requestCount = 0;
    FakeMediaRecorder.instances.push(this);
  }

  start(...args) {
    this.startArguments = args;
    this.state = "recording";
    this.dispatchEvent(new Event("start"));
  }

  pause() {
    this.state = "paused";
    this.dispatchEvent(new Event("pause"));
  }

  resume() {
    this.state = "recording";
    this.dispatchEvent(new Event("resume"));
  }

  requestData() {
    this.requestCount += 1;
    this.dispatchEvent(
      recorderEvent("dataavailable", {
        data: new Blob(["requested"], { type: this.mimeType }),
        timecode: 12.5,
      }),
    );
  }

  stop() {
    this.state = "inactive";
    queueMicrotask(() => {
      this.dispatchEvent(
        recorderEvent("dataavailable", {
          data: new Blob(["final"], { type: this.mimeType }),
          timecode: 20,
        }),
      );
      this.dispatchEvent(new Event("stop"));
    });
  }
}

if (!customElements.get("test-media-recorder")) {
  customElements.define("test-media-recorder", MediaRecorderElement);
}

const installMediaRecorder = (implementation = FakeMediaRecorder) => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "MediaRecorder");
  Object.defineProperty(globalThis, "MediaRecorder", {
    configurable: true,
    value: implementation,
  });
  FakeMediaRecorder.instances.length = 0;
  return () => {
    if (descriptor) Object.defineProperty(globalThis, "MediaRecorder", descriptor);
    else delete globalThis.MediaRecorder;
  };
};

const createElement = () => {
  const element = document.createElement("test-media-recorder");
  element._setAudioOwner({ id: "audio" });
  return element;
};

describe("MediaRecorderElement", () => {
  it("validates and passes declarative constructor and start options", async () => {
    const restore = installMediaRecorder();
    try {
      const element = createElement();
      const stream = {};
      element.id = "capture";
      element.setAttribute("mime-type", "audio/webm");
      element.setAttribute("audio-bits-per-second", "128000");
      element.setAttribute("timeslice", "1000");

      element._validateAudioConfiguration();
      await element._activate(stream);
      const native = FakeMediaRecorder.instances[0];

      assertEqual(native.stream, stream, "owner stream");
      assertEqual(native.options.mimeType, "audio/webm", "MIME option");
      assertEqual(native.options.audioBitsPerSecond, 128000, "bitrate option");
      assertEqual(native.startArguments.join(","), "1000", "timeslice start argument");
      assertEqual(element.state, "recording", "native state");
      assertEqual(element.mimeType, "audio/webm", "native MIME type");
      assertEqual(element.stream, stream, "native stream");
    } finally {
      restore();
    }
  });

  it("rejects unsupported APIs, MIME types, and invalid numeric configuration", () => {
    const noRecorder = installMediaRecorder(null);
    try {
      assertThrows(
        () => createElement()._validateAudioConfiguration(),
        "NotSupportedError",
        "MediaRecorder API is not available",
      );
    } finally {
      noRecorder();
    }

    const restore = installMediaRecorder();
    try {
      const unsupported = createElement();
      unsupported.setAttribute("mime-type", "audio/unsupported");
      assertThrows(
        () => unsupported._validateAudioConfiguration(),
        "NotSupportedError",
        'MediaRecorder MIME type "audio/unsupported" is not supported',
      );

      for (const [name, value, message] of [
        ["audio-bits-per-second", "0", "audio-bits-per-second must be a positive integer"],
        ["audio-bits-per-second", "1.5", "audio-bits-per-second must be a positive integer"],
        ["timeslice", "-1", "timeslice must be a non-negative integer"],
        ["timeslice", "1.5", "timeslice must be a non-negative integer"],
      ]) {
        const invalid = createElement();
        invalid.setAttribute(name, value);
        assertThrows(
          () => invalid._validateAudioConfiguration(),
          "SyntaxError",
          message,
        );
      }
    } finally {
      restore();
    }
  });

  it("omits empty optional numeric attributes", async () => {
    const restore = installMediaRecorder();
    try {
      const element = createElement();
      element.setAttribute("audio-bits-per-second", "  ");
      element.setAttribute("timeslice", "");

      element._validateAudioConfiguration();
      await element._activate({});
      const native = FakeMediaRecorder.instances[0];

      assertEqual("audioBitsPerSecond" in native.options, false, "bitrate omitted");
      assertEqual(native.startArguments.length, 0, "timeslice omitted");
    } finally {
      restore();
    }
  });

  it("wraps native events and exposes Blob data with timecode metadata", async () => {
    const restore = installMediaRecorder();
    try {
      const element = createElement();
      const stream = {};
      element.id = "capture";
      const events = [];
      for (const type of ["start", "dataavailable", "pause", "resume", "stop"]) {
        element.addEventListener(type, (event) => events.push({ type, event }));
      }

      await element._activate(stream);
      element.requestData();
      await element._suspend();
      await element._activate(stream);
      await element._close();

      assertEqual(events.map(({ type }) => type).join(","), "start,dataavailable,pause,resume,dataavailable,stop", "native event order");
      assert(events[1].event.detail.data instanceof Blob, "request event carries a Blob");
      assertEqual(events[1].event.detail.metadata.timecode, 12.5, "request timecode");
      assertEqual(events[1].event.detail.metadata.contextId, "audio", "context metadata");
      assertEqual(events[1].event.detail.metadata.nodeId, "capture", "node metadata");
      assertEqual(events[4].event.detail.metadata.timecode, 20, "final timecode");
      assertEqual(element.state, "inactive", "closed recorder state");
      assertEqual(element.stream, null, "closed recorder releases stream");
    } finally {
      restore();
    }
  });

  it("delegates requestData only while a recorder is active", async () => {
    const restore = installMediaRecorder();
    try {
      const element = createElement();
      assertThrows(
        () => element.requestData(),
        "InvalidStateError",
        "Media recorder is not active",
      );

      await element._activate({});
      element.requestData();

      assertEqual(FakeMediaRecorder.instances[0].requestCount, 1, "native request count");
    } finally {
      restore();
    }
  });

  it("waits for final data and stop before terminal cleanup", async () => {
    const restore = installMediaRecorder();
    try {
      const element = createElement();
      const events = [];
      element.addEventListener("dataavailable", () => events.push("data"));
      element.addEventListener("stop", () => events.push("stop"));
      await element._activate({});

      const closing = element._close().then(() => events.push("closed"));
      assertEqual(events.join(","), "", "close waits for queued native events");
      await closing;

      assertEqual(events.join(","), "data,stop,closed", "finalization order");
    } finally {
      restore();
    }
  });
});
