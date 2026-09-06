import { createEventSourceWorkerRuntime } from "../../src/event-source/event-source.worker.js";

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

  open(data) {
    this.calls.push(["open", data]);
  }

  close() {
    this.calls.push(["close"]);
  }

  dispose() {
    this.calls.push(["dispose"]);
  }
}

describe("event-source Worker runtime", () => {
  it("translates commands and clone-safe session output", () => {
    const scope = new FakeScope();
    createEventSourceWorkerRuntime(scope, { Session: FakeSession });
    const configuration = { url: "https://example.test/events", withCredentials: true };

    scope.command("open", configuration);
    FakeSession.instance.emit("state", {
      readyState: 1,
      url: configuration.url,
      withCredentials: true,
    });
    FakeSession.instance.emit("message", {
      data: "hello",
      origin: "https://example.test",
      lastEventId: "event-4",
    });
    scope.command("close");
    scope.command("dispose");

    assertEqual(scope.messages[0].type, "ready", "ready is announced first");
    assertEqual(FakeSession.instance.calls[0][0], "open", "open is forwarded");
    assertEqual(FakeSession.instance.calls[0][1], configuration, "config is forwarded");
    assertEqual(scope.messages[1].type, "state", "state is forwarded");
    assertEqual(scope.messages[2].name, "message", "event name is retained");
    assertEqual(scope.messages[2].data.lastEventId, "event-4", "metadata is retained");
    assertEqual(FakeSession.instance.calls.at(-2)[0], "close", "close is forwarded");
    assertEqual(FakeSession.instance.calls.at(-1)[0], "dispose", "dispose is forwarded");
  });

  it("serializes command errors and reports CLOSED", () => {
    class ThrowingSession extends FakeSession {
      open() {
        throw new DOMException("Invalid URL", "SyntaxError");
      }
    }
    const scope = new FakeScope();
    createEventSourceWorkerRuntime(scope, { Session: ThrowingSession });

    scope.command("open", { url: "bad" });

    assertEqual(scope.messages[1].name, "error", "failure becomes error event");
    assertEqual(scope.messages[1].data.name, "SyntaxError", "error is clone-safe");
    assertEqual(scope.messages[2].data.readyState, 2, "failure reports CLOSED");
  });
});
