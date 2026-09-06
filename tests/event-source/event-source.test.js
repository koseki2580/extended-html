import "../../src/index.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

class FakeEventSource extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 2;
  static instances = [];
  static constructorError = null;

  constructor(url, options = {}) {
    super();
    if (FakeEventSource.constructorError) throw FakeEventSource.constructorError;
    this.url = new URL(url, document.baseURI).href;
    this.withCredentials = options.withCredentials === true;
    this.readyState = FakeEventSource.CONNECTING;
    this.closeCalls = 0;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeEventSource.CLOSED;
  }

  emitOpen() {
    this.readyState = FakeEventSource.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(data, { origin = "https://example.test", lastEventId = "" } = {}) {
    this.dispatchEvent(
      new MessageEvent("message", { data, origin, lastEventId }),
    );
  }

  emitError(readyState = this.readyState) {
    this.readyState = readyState;
    this.dispatchEvent(new Event("error"));
  }
}

class FakeWorker extends EventTarget {
  static instances = [];
  static constructorError = null;

  constructor(url, options) {
    super();
    if (FakeWorker.constructorError) throw FakeWorker.constructorError;
    this.url = url;
    this.options = options;
    this.messages = [];
    this.terminateCalls = 0;
    FakeWorker.instances.push(this);
  }

  postMessage(message) {
    this.messages.push(structuredClone(message));
  }

  terminate() {
    this.terminateCalls += 1;
  }

  emitMessage(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitError(message = "worker failed") {
    this.dispatchEvent(new ErrorEvent("error", { message }));
  }
}

const NativeEventSource = globalThis.EventSource;
const NativeWorker = globalThis.Worker;

beforeEach(() => {
  FakeEventSource.instances = [];
  FakeEventSource.constructorError = null;
  FakeWorker.instances = [];
  FakeWorker.constructorError = null;
  globalThis.EventSource = FakeEventSource;
  globalThis.Worker = FakeWorker;
});

afterEach(() => {
  document.querySelectorAll("event-source").forEach((element) => element.remove());
  globalThis.EventSource = NativeEventSource;
  globalThis.Worker = NativeWorker;
  delete globalThis.OnSseMessage;
  delete globalThis.OnSseError;
});

describe("event-source Worker transport", () => {
  it("queues open for a module Worker and preserves message metadata", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("with-credentials", "");
    element.setAttribute("background", "");
    document.body.append(element);
    const received = [];
    element.addEventListener("open", (event) => received.push(event));
    element.addEventListener("message", (event) => received.push(event));

    element.open();
    const worker = FakeWorker.instances[0];
    assertEqual(worker.options.type, "module", "module Worker is requested");
    assertEqual(worker.messages.length, 0, "open waits for readiness");

    worker.emitMessage({ type: "ready" });
    assertEqual(worker.messages[0].type, "open", "open command is flushed");
    assertEqual(worker.messages[0].data.withCredentials, true, "credentials pass");
    worker.emitMessage({
      type: "state",
      data: { readyState: 1, url: "https://example.test/events" },
    });
    worker.emitMessage({
      type: "event",
      name: "open",
      data: { url: "https://example.test/events" },
    });
    worker.emitMessage({
      type: "event",
      name: "message",
      data: { data: "hello", origin: "https://example.test", lastEventId: "9" },
    });

    assertEqual(element.readyState, element.OPEN, "Worker state is mirrored");
    assertEqual(received[0].detail.metadata.transport, "worker", "open transport");
    assertEqual(received[1].detail.data, "hello", "message data is retained");
    assertEqual(received[1].detail.metadata.lastEventId, "9", "last id is retained");
  });

  it("does not silently fall back after strict initialization failure", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("background", "");
    document.body.append(element);
    let failure;
    element.addEventListener("error", (event) => {
      failure = event;
    });

    element.open();
    FakeWorker.instances[0].emitError("module failed");

    assertEqual(failure.detail.metadata.transport, "worker", "failure transport");
    assertEqual(FakeEventSource.instances.length, 0, "main is not implicit");
    assertEqual(element.readyState, element.CLOSED, "failure closes transport");
  });

  it("falls back only after an initialization failure when requested", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("background", "");
    element.setAttribute("fallback", "");
    document.body.append(element);
    const transports = [];
    element.addEventListener("error", (event) => {
      transports.push(event.detail.metadata.transport);
    });
    element.addEventListener("open", (event) => {
      transports.push(event.detail.metadata.transport);
    });

    element.open();
    FakeWorker.instances[0].emitError("module failed");
    FakeEventSource.instances[0].emitOpen();

    assertEqual(transports[0], "worker", "Worker failure is emitted first");
    assertEqual(FakeEventSource.instances.length, 1, "main fallback opens");
    assertEqual(transports[1], "main", "fallback event identifies main");
  });

  it("never falls back after a runtime Worker failure", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("background", "");
    element.setAttribute("fallback", "");
    document.body.append(element);

    element.open();
    const worker = FakeWorker.instances[0];
    worker.emitMessage({ type: "ready" });
    worker.emitError("runtime failure");

    assertEqual(FakeEventSource.instances.length, 0, "runtime fallback is forbidden");
    assertEqual(element.readyState, element.CLOSED, "runtime failure closes state");
  });

  it("closes through the Worker and terminates it on DOM removal", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("background", "");
    document.body.append(element);
    element.open();
    const worker = FakeWorker.instances[0];
    worker.emitMessage({ type: "ready" });

    element.close();
    assertEqual(worker.messages.at(-1).type, "close", "close command is sent");
    assertEqual(element.readyState, element.CLOSED, "close updates local state");

    element.remove();
    assertEqual(worker.terminateCalls, 1, "removal terminates Worker");
  });

  it("rejects fallback without background", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("fallback", "");
    document.body.append(element);
    let thrown;
    try {
      element.open();
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof TypeError, "invalid transport flags throw TypeError");
  });
});

describe("event-source main transport", () => {
  it("opens once and forwards native constructor configuration", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("with-credentials", "");
    document.body.append(element);

    element.open();
    element.open();

    assertEqual(FakeEventSource.instances.length, 1, "one source is created");
    assertEqual(FakeEventSource.instances[0].withCredentials, true, "credentials");
    assertEqual(element.readyState, FakeEventSource.CONNECTING, "connecting state");
    assertEqual(element.url, FakeEventSource.instances[0].url, "resolved url");
    assertEqual(element.withCredentials, true, "credentials property");
  });

  it("wraps open, message, and error with stable detail metadata", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    document.body.append(element);
    const received = [];
    for (const type of ["open", "message", "error"]) {
      element.addEventListener(type, (event) => received.push(event));
    }

    element.open();
    const source = FakeEventSource.instances[0];
    source.emitOpen();
    source.emitMessage("hello", {
      origin: "https://events.test",
      lastEventId: "event-7",
    });
    source.emitError(FakeEventSource.CONNECTING);

    assertEqual(received.length, 3, "three events are wrapped");
    assertEqual(received[0].detail.data.url, source.url, "open url");
    assertEqual(received[0].detail.metadata.transport, "main", "open transport");
    assertEqual(received[1].detail.data, "hello", "message data");
    assertEqual(received[1].detail.metadata.origin, "https://events.test", "origin");
    assertEqual(received[1].detail.metadata.lastEventId, "event-7", "last id");
    assertEqual(received[2].detail.data.readyState, 0, "error state");
    assertEqual(received[2].detail.metadata.transport, "main", "error transport");
  });

  it("supports handler properties and global declarative handlers", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    element.setAttribute("onmessage", "OnSseMessage(event)");
    element.setAttribute("onerror", "OnSseError(event)");
    const calls = [];
    globalThis.OnSseMessage = (event) => calls.push(["attribute", event.detail.data]);
    globalThis.OnSseError = (event) => calls.push(["error", event.detail.data]);
    element.onopen = (event) => calls.push(["property", event.type]);
    document.body.append(element);

    element.open();
    const source = FakeEventSource.instances[0];
    source.emitOpen();
    source.emitMessage("payload");
    source.emitError();

    assertEqual(calls[0][0], "property", "property handler runs");
    assertEqual(calls[1][0], "attribute", "attribute handler runs");
    assertEqual(calls[1][1], "payload", "attribute receives detail");
    assertEqual(calls[2][0], "error", "native handler attribute runs");
  });

  it("lets native EventSource reconnect and closes explicitly or on removal", () => {
    const element = document.createElement("event-source");
    element.setAttribute("url", "/events");
    document.body.append(element);
    element.open();
    const source = FakeEventSource.instances[0];

    source.emitError(FakeEventSource.CONNECTING);
    element.open();
    assertEqual(FakeEventSource.instances.length, 1, "reconnecting source is retained");

    element.close();
    assertEqual(source.closeCalls, 1, "explicit close reaches native source");
    assertEqual(element.readyState, FakeEventSource.CLOSED, "explicit closed state");

    element.open();
    const replacement = FakeEventSource.instances[1];
    element.remove();
    assertEqual(replacement.closeCalls, 1, "removal closes replacement");
    replacement.emitMessage("late");
  });

  it("validates configuration and reports auto startup errors", () => {
    const manual = document.createElement("event-source");
    document.body.append(manual);
    let thrown;
    try {
      manual.open();
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof TypeError, "manual missing url throws TypeError");

    const automatic = document.createElement("event-source");
    automatic.setAttribute("auto", "");
    let reported;
    automatic.addEventListener("error", (event) => {
      reported = event.detail.data;
    });
    document.body.append(automatic);
    assert(reported instanceof TypeError, "auto missing url reports error event");
  });
});
