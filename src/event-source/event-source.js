import { WorkerBridge } from "../core/worker-bridge.js";
import {
  EventSourceSession,
  EVENT_SOURCE_CLOSED,
  EVENT_SOURCE_CONNECTING,
  EVENT_SOURCE_OPEN,
} from "./event-source-session.js";

// Declarative handlers allow global function calls without evaluating source text.
const DECLARATIVE_HANDLER_PATTERN =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(\s*event\s*\)\s*;?\s*$/;

const HANDLER_ATTRIBUTES = new Set(["onopen", "onmessage"]);

export class EventSourceElement extends HTMLElement {
  static observedAttributes = [...HANDLER_ATTRIBUTES];

  #transport = null;
  #readyState = EVENT_SOURCE_CLOSED;
  #resolvedUrl = "";
  #eventHandlers = new Map();

  get CONNECTING() {
    return EVENT_SOURCE_CONNECTING;
  }

  get OPEN() {
    return EVENT_SOURCE_OPEN;
  }

  get CLOSED() {
    return EVENT_SOURCE_CLOSED;
  }

  get readyState() {
    return this.#readyState;
  }

  get url() {
    return this.#resolvedUrl || this.getAttribute("url") || "";
  }

  get withCredentials() {
    return this.hasAttribute("with-credentials");
  }

  get onopen() {
    return this.#eventHandlers.get("open") ?? null;
  }

  set onopen(handler) {
    this.#setEventHandler("open", handler);
  }

  get onmessage() {
    return this.#eventHandlers.get("message") ?? null;
  }

  set onmessage(handler) {
    this.#setEventHandler("message", handler);
  }

  get onerror() {
    return this.#eventHandlers.get("error") ?? null;
  }

  set onerror(handler) {
    this.#setEventHandler("error", handler);
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (HANDLER_ATTRIBUTES.has(name)) {
      this.#updateDeclarativeHandler(name, newValue);
    }
  }

  connectedCallback() {
    if (!this.hasAttribute("auto")) return;
    try {
      this.open();
    } catch (error) {
      this.#dispatchWrappedEvent("error", error, "main");
    }
  }

  disconnectedCallback() {
    this.#disposeTransport();
  }

  open() {
    if ([EVENT_SOURCE_CONNECTING, EVENT_SOURCE_OPEN].includes(this.#readyState)) {
      return;
    }
    this.#validateTransportFlags();
    const configuration = this.#getConfiguration();
    this.#validateConfiguration(configuration);

    if (this.hasAttribute("background")) {
      this.#openWorker(configuration);
      return;
    }
    this.#openMain(configuration);
  }

  close() {
    if (!this.#transport) {
      this.#readyState = EVENT_SOURCE_CLOSED;
      return;
    }
    if (this.#transport.kind === "main") {
      this.#transport.session.close();
    } else {
      this.#readyState = EVENT_SOURCE_CLOSED;
      this.#transport.bridge.postMessage({ type: "close" });
    }
  }

  #openMain(configuration) {
    if (!this.#transport || this.#transport.kind !== "main") {
      this.#disposeTransport();
      this.#transport = this.#createMainTransport();
    }
    this.#transport.session.open(configuration);
  }

  #createMainTransport() {
    let transport;
    const session = new EventSourceSession({
      emit: (type, data) => {
        if (transport !== this.#transport) return;
        this.#handleSessionOutput(type, data, "main");
      },
    });
    transport = { kind: "main", session };
    return transport;
  }

  #openWorker(configuration) {
    if (this.#transport && this.#transport.kind !== "worker") {
      this.#disposeTransport();
    }
    if (this.#transport) {
      this.#readyState = EVENT_SOURCE_CONNECTING;
      this.#transport.configuration = configuration;
      this.#transport.bridge.postMessage({ type: "open", data: configuration });
      return;
    }

    const allowFallback = this.hasAttribute("fallback");
    let transport;
    try {
      const bridge = new WorkerBridge(
        new URL("./event-source.worker.js", import.meta.url),
        {
          onMessage: (message) => this.#handleWorkerMessage(transport, message),
          onFailure: (error, phase) =>
            this.#handleWorkerFailure(transport, error, phase),
          WorkerImpl: globalThis.Worker,
        },
      );
      transport = {
        kind: "worker",
        bridge,
        configuration,
        allowFallback,
      };
    } catch (error) {
      this.#handleWorkerCreationFailure(error, configuration, allowFallback);
      return;
    }

    this.#transport = transport;
    this.#readyState = EVENT_SOURCE_CONNECTING;
    transport.bridge.postMessage({ type: "open", data: configuration });
  }

  #handleWorkerMessage(transport, message) {
    if (transport !== this.#transport) return;
    if (message?.type === "state") {
      this.#readyState = message.data.readyState;
      this.#resolvedUrl = message.data.url || this.#resolvedUrl;
      return;
    }
    if (message?.type === "event") {
      this.#handleSessionOutput(message.name, message.data, "worker");
    }
  }

  #handleWorkerFailure(transport, error, phase) {
    if (transport !== this.#transport) return;
    this.#transport = null;
    this.#readyState = EVENT_SOURCE_CLOSED;
    this.#dispatchWrappedEvent("error", error, "worker");

    // Fallback is limited to startup so a live connection never changes transport.
    if (phase === "initialization" && transport.allowFallback) {
      this.#startFallback(transport.configuration);
    }
  }

  #handleWorkerCreationFailure(error, configuration, allowFallback) {
    this.#readyState = EVENT_SOURCE_CLOSED;
    this.#dispatchWrappedEvent("error", error, "worker");
    if (allowFallback) this.#startFallback(configuration);
  }

  #startFallback(configuration) {
    try {
      this.#openMain(configuration);
    } catch (error) {
      this.#readyState = EVENT_SOURCE_CLOSED;
      this.#dispatchWrappedEvent("error", error, "main");
    }
  }

  #handleSessionOutput(type, data, transport) {
    if (type === "state") {
      this.#readyState = data.readyState;
      this.#resolvedUrl = data.url || this.#resolvedUrl;
      return;
    }
    if (type === "message") {
      this.#dispatchWrappedEvent(type, data.data, transport, {
        origin: data.origin,
        lastEventId: data.lastEventId,
      });
      return;
    }
    this.#dispatchWrappedEvent(type, data, transport);
  }

  #disposeTransport() {
    if (!this.#transport) return;
    const transport = this.#transport;
    this.#transport = null;
    this.#readyState = EVENT_SOURCE_CLOSED;
    if (transport.kind === "main") transport.session.dispose();
    else transport.bridge.dispose();
  }

  #getConfiguration() {
    return {
      url: this.getAttribute("url"),
      withCredentials: this.hasAttribute("with-credentials"),
    };
  }

  #validateConfiguration(configuration) {
    if (!configuration.url?.trim()) {
      throw new TypeError("<event-source> requires a non-empty url attribute");
    }
  }

  #validateTransportFlags() {
    if (this.hasAttribute("fallback") && !this.hasAttribute("background")) {
      throw new TypeError("fallback requires the background attribute");
    }
  }

  #updateDeclarativeHandler(name, value) {
    if (value === null) {
      this[name] = null;
      return;
    }
    const match = value.match(DECLARATIVE_HANDLER_PATTERN);
    if (!match) {
      throw new SyntaxError(
        `${name} must call a global handler with event, for example Handler(event)`,
      );
    }
    const path = match[1].split(".");
    this[name] = (event) => {
      let handler = globalThis;
      for (const part of path) handler = handler?.[part];
      if (typeof handler !== "function") {
        throw new ReferenceError(`${match[1]} is not a global function`);
      }
      return handler.call(this, event);
    };
  }

  #dispatchWrappedEvent(type, data, transport, metadata = {}) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { data, metadata: { transport, ...metadata } },
      }),
    );
  }

  #setEventHandler(type, handler) {
    const current = this.#eventHandlers.get(type);
    if (current) this.removeEventListener(type, current);
    this.#eventHandlers.delete(type);
    if (typeof handler === "function") {
      this.#eventHandlers.set(type, handler);
      this.addEventListener(type, handler);
    }
  }
}

if (!customElements.get("event-source")) {
  customElements.define("event-source", EventSourceElement);
}
