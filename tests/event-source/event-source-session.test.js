import {
  EventSourceSession,
  EVENT_SOURCE_CLOSED,
  EVENT_SOURCE_CONNECTING,
  EVENT_SOURCE_OPEN,
} from "../../src/event-source/event-source-session.js";

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
  static instances = [];

  constructor(url, options) {
    super();
    this.url = new URL(url, "https://example.test/").href;
    this.withCredentials = options.withCredentials;
    this.readyState = EVENT_SOURCE_CONNECTING;
    this.closeCalls = 0;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closeCalls += 1;
    this.readyState = EVENT_SOURCE_CLOSED;
  }
}

describe("EventSourceSession", () => {
  beforeEach(() => {
    FakeEventSource.instances = [];
  });

  it("normalizes native state and events without replacing an active source", () => {
    const outputs = [];
    const session = new EventSourceSession({
      emit: (type, data) => outputs.push({ type, data }),
      EventSourceImpl: FakeEventSource,
    });

    session.open({ url: "/events", withCredentials: true });
    session.open({ url: "/ignored" });
    const source = FakeEventSource.instances[0];
    source.readyState = EVENT_SOURCE_OPEN;
    source.dispatchEvent(new Event("open"));
    source.dispatchEvent(
      new MessageEvent("message", {
        data: "payload",
        origin: "https://example.test",
        lastEventId: "42",
      }),
    );

    assertEqual(FakeEventSource.instances.length, 1, "active open is idempotent");
    assertEqual(session.readyState, EVENT_SOURCE_OPEN, "native state is mirrored");
    assertEqual(session.url, "https://example.test/events", "url is resolved");
    assertEqual(session.withCredentials, true, "credentials are retained");
    assertEqual(outputs.at(-1).data.data, "payload", "message data is normalized");
    assertEqual(outputs.at(-1).data.lastEventId, "42", "message id is normalized");

    session.close();
    source.dispatchEvent(new MessageEvent("message", { data: "late" }));
    assertEqual(source.closeCalls, 1, "close reaches native source once");
    assertEqual(session.readyState, EVENT_SOURCE_CLOSED, "close state is mirrored");
    assertEqual(outputs.at(-1).type, "state", "late events are ignored");
  });
});
