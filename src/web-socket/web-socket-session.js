const INITIAL_RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30000;
const RECONNECT_BACKOFF_MULTIPLIER = 2;

export class WebSocketSession {
  #emit;
  #WebSocket;
  #setTimeout;
  #clearTimeout;
  #config = { url: null, reconnect: false, reconnectDelay: null };
  #socket = null;
  #retryTimer = null;
  #retryAttempt = 0;
  #manuallyStopped = true;

  constructor({
    emit,
    WebSocketImpl = globalThis.WebSocket,
    setTimeoutImpl = globalThis.setTimeout,
    clearTimeoutImpl = globalThis.clearTimeout,
  }) {
    this.#emit = emit;
    this.#WebSocket = WebSocketImpl;
    // Browser timer functions require their Window or Worker global as receiver.
    this.#setTimeout = setTimeoutImpl.bind(globalThis);
    this.#clearTimeout = clearTimeoutImpl.bind(globalThis);
  }

  configure(config) {
    this.#config = { ...config };
    if (!this.#config.reconnect) this.#cancelRetry();
  }

  open() {
    if (this.#isSocketActive()) return;
    this.#validateConfiguration();
    this.#manuallyStopped = false;
    this.#cancelRetry();
    this.#retryAttempt = 0;
    this.#connect();
  }

  send(data) {
    if (!this.#socket || this.#socket.readyState !== this.#WebSocket.OPEN) {
      throw new DOMException(
        "Failed to execute 'send': the WebSocket is not open",
        "InvalidStateError",
      );
    }
    this.#socket.send(data);
  }

  close() {
    this.#manuallyStopped = true;
    this.#cancelRetry();
    if (this.#isSocketActive()) {
      this.#socket.close();
      this.#emit("state", this.#WebSocket.CLOSING);
    }
  }

  dispose() {
    this.#manuallyStopped = true;
    this.#cancelRetry();
    const socket = this.#socket;
    // Clear first so events queued by close() cannot escape a disposed session.
    this.#socket = null;
    if (this.#isSocketActive(socket)) socket.close();
    this.#emit("state", this.#WebSocket.CLOSED);
  }

  #connect() {
    if (this.#isSocketActive()) return;
    const url = this.#getUrl();
    const socket = new this.#WebSocket(url);
    this.#socket = socket;
    this.#emit("state", this.#WebSocket.CONNECTING);

    socket.addEventListener("open", () => {
      if (socket !== this.#socket) return;
      this.#retryAttempt = 0;
      this.#emit("state", this.#WebSocket.OPEN);
      this.#emit("open", { url });
    });
    socket.addEventListener("message", (event) => {
      if (socket !== this.#socket) return;
      this.#emit("message", event.data);
    });
    socket.addEventListener("error", (event) => {
      if (socket !== this.#socket) return;
      this.#emit("error", event);
    });
    socket.addEventListener("close", (event) => {
      if (socket !== this.#socket) return;
      this.#socket = null;
      this.#emit("state", this.#WebSocket.CLOSED);
      this.#emit("close", {
        code: event.code,
        reason: event.reason,
        wasClean: event.wasClean,
      });
      this.#scheduleReconnect();
    });
  }

  #scheduleReconnect() {
    if (
      this.#manuallyStopped ||
      !this.#config.reconnect ||
      this.#retryTimer !== null
    ) {
      return;
    }

    let delay;
    try {
      delay = this.#getRetryDelay();
    } catch (error) {
      this.#emit("error", error);
      return;
    }

    this.#retryTimer = this.#setTimeout(() => {
      this.#retryTimer = null;
      if (this.#manuallyStopped || !this.#config.reconnect) return;
      try {
        this.#connect();
      } catch (error) {
        this.#emit("error", error);
        this.#scheduleReconnect();
      }
    }, delay);
  }

  #validateConfiguration() {
    this.#getUrl();
    if (this.#config.reconnect) this.#getConfiguredRetryDelay();
  }

  #getUrl() {
    const url = this.#config.url?.trim();
    if (!url) {
      throw new TypeError("<web-socket> requires a non-empty url attribute");
    }
    return url;
  }

  #getRetryDelay() {
    const configuredDelay = this.#getConfiguredRetryDelay();
    if (configuredDelay !== null) return configuredDelay;
    const delay = Math.min(
      INITIAL_RECONNECT_DELAY_MS *
        RECONNECT_BACKOFF_MULTIPLIER ** this.#retryAttempt,
      MAX_RECONNECT_DELAY_MS,
    );
    this.#retryAttempt += 1;
    return delay;
  }

  #getConfiguredRetryDelay() {
    const value = this.#config.reconnectDelay;
    if (value === null || value === undefined) return null;
    const delay = Number(value);
    if (value === "" || !Number.isFinite(delay) || delay < 0) {
      throw new RangeError("reconnect-delay must be a non-negative number");
    }
    return delay;
  }

  #cancelRetry() {
    if (this.#retryTimer === null) return;
    this.#clearTimeout(this.#retryTimer);
    this.#retryTimer = null;
  }

  #isSocketActive(socket = this.#socket) {
    return (
      socket !== null &&
      [this.#WebSocket.CONNECTING, this.#WebSocket.OPEN].includes(
        socket.readyState,
      )
    );
  }
}
