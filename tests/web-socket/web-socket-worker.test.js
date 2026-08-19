import { createWebSocketWorkerRuntime } from "../../src/web-socket/web-socket.worker.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

class FakeScope extends EventTarget {
  messages = [];

  postMessage(message) {
    this.messages.push(message);
  }

  command(type, data) {
    this.dispatchEvent(new MessageEvent("message", { data: { type, data } }));
  }
}

class FakeSession {
  static instance;
  calls = [];

  constructor({ emit }) {
    this.emit = emit;
    FakeSession.instance = this;
  }

  configure(data) {
    this.calls.push(["configure", data]);
  }

  open() {
    this.calls.push(["open"]);
  }

  send(data) {
    this.calls.push(["send", data]);
  }

  close() {
    this.calls.push(["close"]);
  }

  dispose() {
    this.calls.push(["dispose"]);
  }
}

describe("web-socket Worker runtime", () => {
  it("translates commands and session output across the Worker boundary", () => {
    const scope = new FakeScope();
    createWebSocketWorkerRuntime(scope, { Session: FakeSession });
    const config = {
      url: "wss://example.test/socket",
      reconnect: true,
      reconnectDelay: null,
    };

    scope.command("open", config);
    scope.command("send", "hello");
    FakeSession.instance.emit("state", 1);
    FakeSession.instance.emit("message", "received");
    scope.command("close");
    scope.command("dispose");

    assertEqual(scope.messages[0].type, "ready", "ready is announced first");
    assertEqual(
      FakeSession.instance.calls[0][0],
      "configure",
      "open config is set",
    );
    assertEqual(FakeSession.instance.calls[1][0], "open", "open is forwarded");
    assertEqual(
      FakeSession.instance.calls[2][1],
      "hello",
      "send data is forwarded",
    );
    assertEqual(scope.messages[1].type, "state", "state is forwarded separately");
    assertEqual(scope.messages[1].data.readyState, 1, "ready state is preserved");
    assertEqual(
      scope.messages[2].type,
      "event",
      "public output is an event message",
    );
    assertEqual(scope.messages[2].name, "message", "event name is preserved");
    assertEqual(scope.messages[2].data, "received", "event data is preserved");
    assertEqual(
      FakeSession.instance.calls.at(-2)[0],
      "close",
      "close is forwarded",
    );
    assertEqual(
      FakeSession.instance.calls.at(-1)[0],
      "dispose",
      "dispose is forwarded",
    );
  });

  it("turns command failures into clone-safe error and closed-state messages", () => {
    class ThrowingSession extends FakeSession {
      open() {
        throw new DOMException("Invalid URL", "SyntaxError");
      }
    }
    const scope = new FakeScope();
    createWebSocketWorkerRuntime(scope, { Session: ThrowingSession });

    scope.command("open", { url: "bad" });

    assertEqual(scope.messages[1].type, "event", "failure becomes an event");
    assertEqual(scope.messages[1].name, "error", "failure uses the error event");
    assertEqual(
      scope.messages[1].data.name,
      "SyntaxError",
      "error name is serializable",
    );
    assertEqual(
      scope.messages[1].data.message,
      "Invalid URL",
      "error message is retained",
    );
    assertEqual(scope.messages[2].type, "state", "failure resets connection state");
    assertEqual(scope.messages[2].data.readyState, 3, "failure reports CLOSED");
  });
});
