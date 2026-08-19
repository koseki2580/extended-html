import "../../src/index.js";

const assert = (condition, message) => {
  if (!condition) {
    throw new Error(message);
  }
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

class FakeWebSocket extends EventTarget {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];
  static constructorError = null;

  constructor(url) {
    super();
    if (FakeWebSocket.constructorError) {
      throw FakeWebSocket.constructorError;
    }
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.closeCalls = [];
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    if (this.readyState !== FakeWebSocket.OPEN) {
      throw new DOMException("The socket is not open", "InvalidStateError");
    }
    this.sent.push(data);
  }

  close(code, reason) {
    this.closeCalls.push({ code, reason });
    this.readyState = FakeWebSocket.CLOSING;
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitError() {
    this.dispatchEvent(new Event("error"));
  }

  emitClose({ code = 1000, reason = "", wasClean = true } = {}) {
    this.readyState = FakeWebSocket.CLOSED;
    this.dispatchEvent(new CloseEvent("close", { code, reason, wasClean }));
  }
}

class FakeTimers {
  #nextId = 1;
  #tasks = new Map();

  setTimeout = (callback, delay) => {
    const id = this.#nextId;
    this.#nextId += 1;
    this.#tasks.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => {
    this.#tasks.delete(id);
  };

  get delays() {
    return [...this.#tasks.values()].map(({ delay }) => delay);
  }

  runNext() {
    const next = this.#tasks.entries().next().value;
    assert(next, "expected a pending timer");
    const [id, task] = next;
    this.#tasks.delete(id);
    task.callback();
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

const withFakeTimers = (callback) => {
  const nativeSetTimeout = globalThis.setTimeout;
  const nativeClearTimeout = globalThis.clearTimeout;
  const timers = new FakeTimers();
  globalThis.setTimeout = timers.setTimeout;
  globalThis.clearTimeout = timers.clearTimeout;
  try {
    callback(timers);
  } finally {
    globalThis.setTimeout = nativeSetTimeout;
    globalThis.clearTimeout = nativeClearTimeout;
  }
};

const NativeWebSocket = globalThis.WebSocket;
const NativeWorker = globalThis.Worker;

beforeEach(() => {
  FakeWebSocket.instances = [];
  FakeWebSocket.constructorError = null;
  FakeWorker.instances = [];
  FakeWorker.constructorError = null;
  globalThis.WebSocket = FakeWebSocket;
  globalThis.Worker = FakeWorker;
});

afterEach(() => {
  document.querySelectorAll("web-socket").forEach((element) => element.remove());
  globalThis.WebSocket = NativeWebSocket;
  globalThis.Worker = NativeWorker;
});

describe("web-socket registration", () => {
  it("is registered after importing the aggregate entry point", () => {
    assert(
      typeof customElements.get("web-socket") === "function",
      "expected <web-socket> to be registered",
    );
  });
});

describe("web-socket connection", () => {
  it("opens one native WebSocket when open is called repeatedly", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);

    assertEqual(FakeWebSocket.instances.length, 0, "manual element starts idle");

    element.open();
    element.open();

    assertEqual(FakeWebSocket.instances.length, 1, "only one socket is created");
    assertEqual(
      FakeWebSocket.instances[0].url,
      "wss://example.test/socket",
      "url is forwarded",
    );
  });

  it("keeps open idempotent when an active element gains invalid retry config", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    element.open();
    element.setAttribute("reconnect", "");
    element.setAttribute("reconnect-delay", "later");

    element.open();

    assertEqual(FakeWebSocket.instances.length, 1, "active socket is unchanged");
  });

  it("wraps native WebSocket events under the same event names", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    const received = [];

    for (const type of ["open", "message", "error", "close"]) {
      element.addEventListener(type, (event) => received.push({ type, event }));
    }

    element.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage("hello");
    socket.emitError();
    socket.emitClose({ code: 1001, reason: "away", wasClean: true });

    assertEqual(received.length, 4, "all native events are wrapped");
    for (const { event } of received) {
      assertEqual(
        event.detail.metadata.transport,
        "main",
        "every main-thread event identifies its transport",
      );
    }
    assertEqual(received[0].type, "open", "open name is preserved");
    assertEqual(
      received[0].event.detail.data.url,
      "wss://example.test/socket",
      "open data contains the url",
    );
    assertEqual(received[1].type, "message", "message name is preserved");
    assertEqual(received[1].event.detail.data, "hello", "message data is preserved");
    assertEqual(received[2].type, "error", "error name is preserved");
    assert(received[2].event.detail.data instanceof Event, "native error is preserved");
    assertEqual(received[3].type, "close", "close name is preserved");
    assertEqual(received[3].event.detail.data.code, 1001, "close code is preserved");
    assertEqual(received[3].event.detail.data.reason, "away", "close reason is preserved");
    assertEqual(received[3].event.detail.data.wasClean, true, "clean state is preserved");
  });

  it("supports event-handler properties", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    const calls = [];

    element.onopen = (event) => calls.push([event.type, event.detail.data]);
    element.onmessage = (event) => calls.push([event.type, event.detail.data]);

    element.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage("payload");

    assertEqual(calls.length, 2, "property handlers are called");
    assertEqual(calls[0][0], "open", "open property receives open event");
    assertEqual(calls[1][1], "payload", "message property receives wrapped data");
  });
});

describe("web-socket Worker transport", () => {
  it("queues open for a required module Worker and wraps its events", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    document.body.append(element);
    const received = [];
    element.addEventListener("open", (event) => received.push(event));
    element.addEventListener("message", (event) => received.push(event));

    element.open();
    const worker = FakeWorker.instances[0];
    assertEqual(FakeWebSocket.instances.length, 0, "main socket is not created");
    assertEqual(worker.options.type, "module", "module Worker is requested");
    assertEqual(worker.messages.length, 0, "open waits for Worker readiness");

    worker.emitMessage({ type: "ready" });
    assertEqual(worker.messages[0].type, "open", "open command is flushed");
    worker.emitMessage({ type: "state", data: { readyState: 1 } });
    worker.emitMessage({
      type: "event",
      name: "open",
      data: { url: "wss://example.test/socket" },
    });
    worker.emitMessage({ type: "event", name: "message", data: "hello" });

    assertEqual(received.length, 2, "Worker events are wrapped");
    assertEqual(received[0].detail.metadata.transport, "worker", "open is marked");
    assertEqual(received[1].detail.data, "hello", "message data is retained");
    assertEqual(received[1].detail.metadata.transport, "worker", "message is marked");
  });

  it("mirrors Worker state so send remains synchronously validated", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    document.body.append(element);
    element.open();
    const worker = FakeWorker.instances[0];
    worker.emitMessage({ type: "ready" });
    let thrown;

    try {
      element.send("early");
    } catch (error) {
      thrown = error;
    }
    assertEqual(thrown?.name, "InvalidStateError", "connecting send is rejected");

    worker.emitMessage({ type: "state", data: { readyState: 1 } });
    const payload = new ArrayBuffer(4);
    element.send(payload);
    assertEqual(worker.messages[1].type, "send", "send command is forwarded");
    assertEqual(payload.byteLength, 4, "caller buffer is not detached");
  });

  it("reports strict initialization failure without silently falling back", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    document.body.append(element);
    let errorEvent;
    element.addEventListener("error", (event) => {
      errorEvent = event;
    });

    element.open();
    FakeWorker.instances[0].emitError("module failed");

    assertEqual(errorEvent.detail.metadata.transport, "worker", "failure is marked");
    assertEqual(FakeWebSocket.instances.length, 0, "main fallback is not implicit");
  });

  it("reports initialization failure before an explicit main fallback", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
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
    FakeWebSocket.instances[0].emitOpen();

    assertEqual(transports[0], "worker", "Worker failure is emitted first");
    assertEqual(FakeWebSocket.instances.length, 1, "main fallback connects");
    assertEqual(transports[1], "main", "fallback connection is marked main");
  });

  it("falls back when the Worker constructor fails synchronously", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    element.setAttribute("fallback", "");
    const expected = new DOMException("Worker blocked", "SecurityError");
    FakeWorker.constructorError = expected;
    let received;
    element.addEventListener("error", (event) => {
      received = event;
    });

    element.open();

    assertEqual(received.detail.data, expected, "creation error is retained");
    assertEqual(received.detail.metadata.transport, "worker", "error is marked");
    assertEqual(FakeWebSocket.instances.length, 1, "main fallback connects");
  });

  it("does not fallback after a ready Worker fails at runtime", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    element.setAttribute("fallback", "");
    document.body.append(element);
    const received = [];
    element.addEventListener("error", (event) => received.push(event));
    element.addEventListener("close", (event) => received.push(event));

    element.open();
    const worker = FakeWorker.instances[0];
    worker.emitMessage({ type: "ready" });
    worker.emitError("runtime failed");

    assertEqual(FakeWebSocket.instances.length, 0, "runtime failure does not fallback");
    assertEqual(received.length, 2, "error and close are emitted");
    assertEqual(received[0].detail.metadata.transport, "worker", "error is marked");
    assertEqual(received[1].detail.data.code, 1006, "close is abnormal");
    assertEqual(received[1].detail.data.wasClean, false, "close is not clean");
  });

  it("rejects fallback without background", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("fallback", "");
    let thrown;

    try {
      element.open();
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof TypeError, "invalid flag combination throws TypeError");
    assertEqual(FakeWorker.instances.length, 0, "Worker is not created");
    assertEqual(FakeWebSocket.instances.length, 0, "socket is not created");
  });

  it("reports an automatic fallback-only configuration as an error event", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("fallback", "");
    element.setAttribute("auto", "");
    let received;
    element.addEventListener("error", (event) => {
      received = event;
    });

    document.body.append(element);

    assert(received.detail.data instanceof TypeError, "auto reports TypeError");
    assertEqual(received.detail.metadata.transport, "main", "error is marked main");
  });

  it("terminates the Worker when removed from the DOM", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("background", "");
    document.body.append(element);
    element.open();
    const worker = FakeWorker.instances[0];

    element.remove();

    assertEqual(worker.terminateCalls, 1, "removal terminates Worker transport");
  });
});

describe("web-socket data and shutdown", () => {
  it("forwards send data unchanged to an open native socket", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    const payload = new Uint8Array([1, 2, 3]);

    element.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    element.send(payload);

    assertEqual(socket.sent.length, 1, "one value is sent");
    assertEqual(socket.sent[0], payload, "send preserves the original value");
  });

  it("throws InvalidStateError when send has no open connection", () => {
    const element = document.createElement("web-socket");
    let thrown;

    try {
      element.send("too early");
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof DOMException, "send throws a DOMException");
    assertEqual(thrown.name, "InvalidStateError", "send identifies invalid state");
  });

  it("closes the native socket and still wraps its close event", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    let closeData;
    element.addEventListener("close", (event) => {
      closeData = event.detail.data;
    });

    element.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    element.close();
    socket.emitClose({ code: 1000, reason: "manual", wasClean: true });

    assertEqual(socket.closeCalls.length, 1, "native close is called once");
    assertEqual(closeData.reason, "manual", "manual close event is wrapped");
  });

  it("closes the socket on DOM removal and ignores its later events", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    document.body.append(element);
    let messages = 0;
    element.addEventListener("message", () => {
      messages += 1;
    });

    element.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    element.remove();
    socket.emitMessage("stale");

    assertEqual(socket.closeCalls.length, 1, "DOM removal closes the socket");
    assertEqual(messages, 0, "removed socket events are ignored");
  });
});

describe("web-socket automatic connection", () => {
  it("opens when an element with auto is connected", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("auto", "");

    document.body.append(element);

    assertEqual(FakeWebSocket.instances.length, 1, "auto creates a socket");
  });

  it("uses reconnect-delay as a fixed retry delay", () => {
    withFakeTimers((timers) => {
      const element = document.createElement("web-socket");
      element.setAttribute("url", "wss://example.test/socket");
      element.setAttribute("reconnect", "");
      element.setAttribute("reconnect-delay", "2500");
      document.body.append(element);
      element.open();

      FakeWebSocket.instances[0].emitClose();

      assertEqual(timers.delays.length, 1, "one retry is scheduled");
      assertEqual(timers.delays[0], 2500, "configured delay is used");
      timers.runNext();
      assertEqual(FakeWebSocket.instances.length, 2, "retry opens another socket");
    });
  });

  it("uses exponential backoff capped at thirty seconds", () => {
    withFakeTimers((timers) => {
      const element = document.createElement("web-socket");
      element.setAttribute("url", "wss://example.test/socket");
      element.setAttribute("reconnect", "");
      document.body.append(element);
      element.open();
      const expectedDelays = [1000, 2000, 4000, 8000, 16000, 30000, 30000];

      for (const expectedDelay of expectedDelays) {
        FakeWebSocket.instances.at(-1).emitClose();
        assertEqual(timers.delays[0], expectedDelay, "backoff delay is correct");
        timers.runNext();
      }
    });
  });

  it("resets exponential backoff after a successful connection", () => {
    withFakeTimers((timers) => {
      const element = document.createElement("web-socket");
      element.setAttribute("url", "wss://example.test/socket");
      element.setAttribute("reconnect", "");
      document.body.append(element);
      element.open();

      FakeWebSocket.instances[0].emitClose();
      timers.runNext();
      FakeWebSocket.instances[1].emitClose();
      assertEqual(timers.delays[0], 2000, "backoff advances before success");
      timers.runNext();
      FakeWebSocket.instances[2].emitOpen();
      FakeWebSocket.instances[2].emitClose();

      assertEqual(timers.delays[0], 1000, "successful open resets backoff");
    });
  });

  it("cancels retry after explicit close or DOM removal", () => {
    withFakeTimers((timers) => {
      const first = document.createElement("web-socket");
      first.setAttribute("url", "wss://example.test/first");
      first.setAttribute("reconnect", "");
      document.body.append(first);
      first.open();
      FakeWebSocket.instances[0].emitClose();
      first.close();

      assertEqual(timers.delays.length, 0, "close cancels retry");

      const second = document.createElement("web-socket");
      second.setAttribute("url", "wss://example.test/second");
      second.setAttribute("reconnect", "");
      document.body.append(second);
      second.open();
      FakeWebSocket.instances[1].emitClose();
      second.remove();

      assertEqual(timers.delays.length, 0, "DOM removal cancels retry");
    });
  });
});

describe("web-socket declarative handlers and errors", () => {
  it("calls globally named inline handlers with wrapped events", () => {
    const calls = [];
    globalThis.OnSocketOpen = (event) => calls.push(["open", event.detail.data]);
    globalThis.OnSocketMessage = (event) =>
      calls.push(["message", event.detail.data]);
    globalThis.OnSocketError = (event) => calls.push(["error", event.detail.data]);
    globalThis.OnSocketClose = (event) => calls.push(["close", event.detail.data]);

    try {
      const element = document.createElement("web-socket");
      element.setAttribute("url", "wss://example.test/socket");
      element.setAttribute("onopen", "OnSocketOpen(event)");
      element.setAttribute("onmessage", "OnSocketMessage(event)");
      element.setAttribute("onerror", "OnSocketError(event)");
      element.setAttribute("onclose", "OnSocketClose(event)");
      document.body.append(element);
      element.open();
      const socket = FakeWebSocket.instances[0];

      socket.emitOpen();
      socket.emitMessage("hello");
      socket.emitError();
      socket.emitClose({ reason: "done" });

      assertEqual(calls.length, 4, "each inline handler runs once");
      assertEqual(calls[0][1].url, "wss://example.test/socket", "open is wrapped");
      assertEqual(calls[1][1], "hello", "message is wrapped");
      assert(calls[2][1] instanceof Event, "error is wrapped");
      assertEqual(calls[3][1].reason, "done", "close is wrapped");
    } finally {
      delete globalThis.OnSocketOpen;
      delete globalThis.OnSocketMessage;
      delete globalThis.OnSocketError;
      delete globalThis.OnSocketClose;
    }
  });

  it("throws from explicit open when url is missing", () => {
    const element = document.createElement("web-socket");
    let thrown;

    try {
      element.open();
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof TypeError, "missing url throws TypeError");
  });

  it("throws constructor failures from explicit open", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "not-a-websocket-url");
    const expected = new DOMException("Invalid URL", "SyntaxError");
    FakeWebSocket.constructorError = expected;
    let thrown;

    try {
      element.open();
    } catch (error) {
      thrown = error;
    }

    assertEqual(thrown, expected, "native constructor error is rethrown");
  });

  it("dispatches constructor failures as error events for auto", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "not-a-websocket-url");
    element.setAttribute("auto", "");
    const expected = new DOMException("Invalid URL", "SyntaxError");
    FakeWebSocket.constructorError = expected;
    let received;
    element.addEventListener("error", (event) => {
      received = event.detail.data;
    });

    document.body.append(element);

    assertEqual(received, expected, "auto reports constructor error");
  });

  it("rejects invalid reconnect-delay before connecting", () => {
    const element = document.createElement("web-socket");
    element.setAttribute("url", "wss://example.test/socket");
    element.setAttribute("reconnect", "");
    element.setAttribute("reconnect-delay", "later");
    let thrown;

    try {
      element.open();
    } catch (error) {
      thrown = error;
    }

    assert(thrown instanceof RangeError, "invalid delay throws RangeError");
    assertEqual(FakeWebSocket.instances.length, 0, "invalid delay does not connect");
  });

  it("ignores close events from a replaced socket", () => {
    withFakeTimers((timers) => {
      const element = document.createElement("web-socket");
      element.setAttribute("url", "wss://example.test/socket");
      element.setAttribute("reconnect", "");
      document.body.append(element);
      let closes = 0;
      element.addEventListener("close", () => {
        closes += 1;
      });

      element.open();
      const oldSocket = FakeWebSocket.instances[0];
      element.close();
      element.open();
      oldSocket.emitClose();

      assertEqual(FakeWebSocket.instances.length, 2, "new connection replaces closing one");
      assertEqual(closes, 0, "stale close is not forwarded");
      assertEqual(timers.delays.length, 0, "stale close does not reconnect");
    });
  });
});
