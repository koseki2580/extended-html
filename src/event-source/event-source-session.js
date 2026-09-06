export const EVENT_SOURCE_CONNECTING = 0;
export const EVENT_SOURCE_OPEN = 1;
export const EVENT_SOURCE_CLOSED = 2;

export class EventSourceSession {
  #emit;
  #EventSource;
  #source = null;
  #readyState = EVENT_SOURCE_CLOSED;
  #url = "";
  #withCredentials = false;

  constructor({ emit, EventSourceImpl = globalThis.EventSource }) {
    this.#emit = emit;
    this.#EventSource = EventSourceImpl;
  }

  get readyState() {
    return this.#readyState;
  }

  get url() {
    return this.#url;
  }

  get withCredentials() {
    return this.#withCredentials;
  }

  open({ url, withCredentials = false }) {
    if ([EVENT_SOURCE_CONNECTING, EVENT_SOURCE_OPEN].includes(this.#readyState)) {
      return;
    }
    if (!url?.trim()) {
      throw new TypeError("<event-source> requires a non-empty url attribute");
    }
    if (typeof this.#EventSource !== "function") {
      throw new DOMException("EventSource API is not available", "NotSupportedError");
    }

    const source = new this.#EventSource(url, {
      withCredentials: Boolean(withCredentials),
    });
    this.#source = source;
    this.#url = source.url;
    this.#withCredentials = source.withCredentials;
    this.#setState(source.readyState);

    source.addEventListener("open", () => {
      if (source !== this.#source) return;
      this.#setState(source.readyState);
      this.#emit("open", { url: source.url });
    });
    source.addEventListener("message", (event) => {
      if (source !== this.#source) return;
      this.#emit("message", {
        data: event.data,
        origin: event.origin,
        lastEventId: event.lastEventId,
      });
    });
    source.addEventListener("error", () => {
      if (source !== this.#source) return;
      this.#setState(source.readyState);
      this.#emit("error", { readyState: source.readyState });
    });
  }

  close() {
    const source = this.#source;
    this.#source = null;
    source?.close();
    this.#setState(EVENT_SOURCE_CLOSED);
  }

  dispose() {
    this.close();
  }

  #setState(readyState) {
    this.#readyState = readyState;
    this.#emit("state", {
      readyState,
      url: this.#url,
      withCredentials: this.#withCredentials,
    });
  }
}
