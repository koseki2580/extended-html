import { WebSocketSession } from "../../src/web-socket/web-socket-session.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
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

  constructor(url) {
    super();
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    this.closeCalls = 0;
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = FakeWebSocket.CLOSING;
  }

  emitOpen() {
    this.readyState = FakeWebSocket.OPEN;
    this.dispatchEvent(new Event("open"));
  }

  emitMessage(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
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
    const id = this.#nextId++;
    this.#tasks.set(id, { callback, delay });
    return id;
  };

  clearTimeout = (id) => this.#tasks.delete(id);

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

const createSession = () => {
  const events = [];
  const timers = new FakeTimers();
  const session = new WebSocketSession({
    emit: (type, data) => events.push({ type, data }),
    WebSocketImpl: FakeWebSocket,
    setTimeoutImpl: timers.setTimeout,
    clearTimeoutImpl: timers.clearTimeout,
  });
  return { session, events, timers };
};

beforeEach(() => {
  FakeWebSocket.instances = [];
});

describe("WebSocketSession", () => {
  it("owns connection lifecycle without depending on the DOM", () => {
    const { session, events } = createSession();
    session.configure({
      url: "wss://example.test/socket",
      reconnect: false,
      reconnectDelay: null,
    });

    session.open();
    session.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();
    socket.emitMessage("hello");
    socket.emitClose({ code: 1001, reason: "away", wasClean: true });

    assertEqual(FakeWebSocket.instances.length, 1, "open is idempotent");
    assertEqual(events[0].type, "state", "connecting state is emitted");
    assertEqual(events[1].data, FakeWebSocket.OPEN, "open state is emitted");
    assertEqual(events[2].type, "open", "open is forwarded");
    assertEqual(events[3].data, "hello", "message data is forwarded");
    assertEqual(events[4].data, FakeWebSocket.CLOSED, "closed state is emitted");
    assertEqual(events[5].data.code, 1001, "close data is forwarded");
  });

  it("forwards send data only while open", () => {
    const { session } = createSession();
    session.configure({
      url: "wss://example.test/socket",
      reconnect: false,
      reconnectDelay: null,
    });
    let thrown;

    try {
      session.send("early");
    } catch (error) {
      thrown = error;
    }

    assertEqual(thrown?.name, "InvalidStateError", "idle send is rejected");
    session.open();
    FakeWebSocket.instances[0].emitOpen();
    session.send("ready");
    assertEqual(FakeWebSocket.instances[0].sent[0], "ready", "data is forwarded");
  });

  it("reconnects with exponential backoff and live configuration", () => {
    const { session, timers } = createSession();
    session.configure({
      url: "wss://example.test/first",
      reconnect: true,
      reconnectDelay: null,
    });
    session.open();

    FakeWebSocket.instances[0].emitClose();
    assertEqual(timers.delays[0], 1000, "first retry waits one second");
    session.configure({
      url: "wss://example.test/second",
      reconnect: true,
      reconnectDelay: 2500,
    });
    timers.runNext();
    assertEqual(
      FakeWebSocket.instances[1].url,
      "wss://example.test/second",
      "retry reads the latest url",
    );
    FakeWebSocket.instances[1].emitClose();
    assertEqual(timers.delays[0], 2500, "retry reads the latest fixed delay");
  });

  it("invokes browser timer functions with the platform global receiver", () => {
    let scheduledDelay;
    const setTimeoutImpl = function (_callback, delay) {
      if (this !== globalThis) throw new TypeError("Illegal invocation");
      scheduledDelay = delay;
      return 1;
    };
    const session = new WebSocketSession({
      emit: () => {},
      WebSocketImpl: FakeWebSocket,
      setTimeoutImpl,
      clearTimeoutImpl: () => {},
    });
    session.configure({
      url: "wss://example.test/socket",
      reconnect: true,
      reconnectDelay: 25,
    });
    session.open();

    FakeWebSocket.instances[0].emitClose();

    assertEqual(scheduledDelay, 25, "platform timer schedules reconnect");
  });

  it("stops retry work and ignores stale events after disposal", () => {
    const { session, events, timers } = createSession();
    session.configure({
      url: "wss://example.test/socket",
      reconnect: true,
      reconnectDelay: null,
    });
    session.open();
    const socket = FakeWebSocket.instances[0];
    socket.emitOpen();

    session.dispose();
    socket.emitMessage("stale");
    socket.emitClose();

    assertEqual(socket.closeCalls, 1, "dispose closes an active socket");
    assertEqual(timers.delays.length, 0, "dispose leaves no retry timer");
    assertEqual(
      events.filter(({ type }) => type === "message").length,
      0,
      "disposed socket messages are ignored",
    );
  });
});
