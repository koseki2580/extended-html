import { WebSocketSession } from "./web-socket-session.js";
import { WorkerBridge } from "../core/worker-bridge.js";

// Declarative handlers allow only global function calls and never evaluate arbitrary code.
const DECLARATIVE_HANDLER_PATTERN =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*)\s*\(\s*event\s*\)\s*;?\s*$/;

const HANDLER_ATTRIBUTES = new Set(["onopen", "onmessage"]);
const CONFIGURATION_ATTRIBUTES = ["url", "reconnect", "reconnect-delay"];
const CONNECTING = 0;
const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;

export class WebSocketElement extends HTMLElement {
  static observedAttributes = [
    ...HANDLER_ATTRIBUTES,
    ...CONFIGURATION_ATTRIBUTES,
  ];

  #transport = null;
  #readyState = CLOSED;
  #eventHandlers = new Map();

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

  get onclose() {
    return this.#eventHandlers.get("close") ?? null;
  }

  set onclose(handler) {
    this.#setEventHandler("close", handler);
  }

  // HTML handles onerror/onclose natively, so observe only the two custom handler attributes.
  attributeChangedCallback(name, _oldValue, newValue) {
    if (HANDLER_ATTRIBUTES.has(name)) {
      this.#updateDeclarativeHandler(name, newValue);
      return;
    }
    this.#configureActiveTransport();
  }

  connectedCallback() {
    if (this.hasAttribute("auto")) {
      try {
        this.open();
      } catch (error) {
        this.#dispatchWrappedEvent("error", error, "main");
      }
    }
  }

  disconnectedCallback() {
    this.#disposeTransport();
  }

  open() {
    if ([CONNECTING, OPEN].includes(this.#readyState)) return;
    this.#validateTransportFlags();
    const configuration = this.#getConfiguration();
    this.#validateConfiguration(configuration);
    const kind = this.hasAttribute("background") ? "worker" : "main";

    if (this.#transport && this.#transport.kind !== kind) {
      this.#disposeTransport();
    }

    if (kind === "worker") {
      this.#openWorker(configuration);
    } else {
      this.#openMain(configuration);
    }
  }

  send(data) {
    if (this.#readyState !== OPEN || !this.#transport) {
      throw new DOMException(
        "Failed to execute 'send': the WebSocket is not open",
        "InvalidStateError",
      );
    }
    if (this.#transport.kind === "main") {
      this.#transport.session.send(data);
    } else {
      this.#transport.bridge.postMessage({ type: "send", data });
    }
  }

  close() {
    if (!this.#transport) return;
    if (this.#transport.kind === "main") {
      this.#transport.session.close();
    } else {
      this.#readyState = CLOSING;
      this.#transport.bridge.postMessage({ type: "close" });
    }
  }

  #openMain(configuration) {
    if (!this.#transport) {
      this.#transport = this.#createMainTransport();
    }
    this.#transport.configuration = configuration;
    this.#transport.session.configure(configuration);
    this.#transport.session.open();
  }

  #createMainTransport() {
    let transport;
    const session = new WebSocketSession({
      emit: (type, data) => {
        if (transport !== this.#transport) return;
        if (type === "state") {
          this.#readyState = data;
        } else {
          this.#dispatchWrappedEvent(type, data, "main");
        }
      },
      WebSocketImpl: globalThis.WebSocket,
      setTimeoutImpl: globalThis.setTimeout,
      clearTimeoutImpl: globalThis.clearTimeout,
    });
    transport = { kind: "main", session, configuration: null };
    return transport;
  }

  #openWorker(configuration) {
    if (this.#transport) {
      this.#transport.configuration = configuration;
      this.#readyState = CONNECTING;
      this.#transport.bridge.postMessage({ type: "open", data: configuration });
      return;
    }

    const allowFallback = this.hasAttribute("fallback");
    let transport;
    try {
      const bridge = new WorkerBridge(
        new URL("./web-socket.worker.js", import.meta.url),
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
    this.#readyState = CONNECTING;
    transport.bridge.postMessage({ type: "open", data: configuration });
  }

  #handleWorkerMessage(transport, message) {
    if (transport !== this.#transport) return;
    if (message?.type === "state") {
      this.#readyState = message.data.readyState;
      return;
    }
    if (message?.type === "event") {
      this.#dispatchWrappedEvent(message.name, message.data, "worker");
    }
  }

  #handleWorkerFailure(transport, error, phase) {
    if (transport !== this.#transport) return;
    this.#transport = null;
    this.#readyState = CLOSED;
    this.#dispatchWrappedEvent("error", error, "worker");

    if (phase === "initialization" && transport.allowFallback) {
      this.#startFallback(transport.configuration);
      return;
    }
    if (phase === "runtime") {
      this.#dispatchWrappedEvent(
        "close",
        {
          code: 1006,
          reason: "Worker terminated unexpectedly",
          wasClean: false,
        },
        "worker",
      );
    }
  }

  #handleWorkerCreationFailure(error, configuration, allowFallback) {
    this.#readyState = CLOSED;
    this.#dispatchWrappedEvent("error", error, "worker");
    if (allowFallback) this.#startFallback(configuration);
  }

  #startFallback(configuration) {
    try {
      this.#openMain(configuration);
    } catch (error) {
      this.#readyState = CLOSED;
      this.#dispatchWrappedEvent("error", error, "main");
    }
  }

  #configureActiveTransport() {
    if (!this.#transport) return;
    const configuration = this.#getConfiguration();
    this.#transport.configuration = configuration;
    if (this.#transport.kind === "main") {
      this.#transport.session.configure(configuration);
    } else {
      this.#transport.bridge.postMessage({
        type: "configure",
        data: configuration,
      });
    }
  }

  #disposeTransport() {
    if (!this.#transport) return;
    const transport = this.#transport;
    this.#transport = null;
    this.#readyState = CLOSED;
    if (transport.kind === "main") {
      transport.session.dispose();
    } else {
      transport.bridge.dispose();
    }
  }

  #getConfiguration() {
    return {
      url: this.getAttribute("url"),
      reconnect: this.hasAttribute("reconnect"),
      reconnectDelay: this.hasAttribute("reconnect-delay")
        ? this.getAttribute("reconnect-delay")
        : null,
    };
  }

  #validateTransportFlags() {
    if (this.hasAttribute("fallback") && !this.hasAttribute("background")) {
      throw new TypeError("fallback requires the background attribute");
    }
  }

  #validateConfiguration(configuration) {
    if (!configuration.url?.trim()) {
      throw new TypeError("<web-socket> requires a non-empty url attribute");
    }
    if (!configuration.reconnect || configuration.reconnectDelay === null) return;
    const delay = Number(configuration.reconnectDelay);
    if (
      configuration.reconnectDelay === "" ||
      !Number.isFinite(delay) ||
      delay < 0
    ) {
      throw new RangeError("reconnect-delay must be a non-negative number");
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

  #dispatchWrappedEvent(type, data, transport) {
    this.dispatchEvent(
      new CustomEvent(type, {
        detail: { data, metadata: { transport } },
      }),
    );
  }

  #setEventHandler(type, handler) {
    const current = this.#eventHandlers.get(type);
    if (current) {
      this.removeEventListener(type, current);
      this.#eventHandlers.delete(type);
    }

    if (typeof handler === "function") {
      this.#eventHandlers.set(type, handler);
      this.addEventListener(type, handler);
    }
  }
}

if (!customElements.get("web-socket")) {
  customElements.define("web-socket", WebSocketElement);
}
