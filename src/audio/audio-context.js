import { AudioEventTargetElement, dispatchAudioEvent } from "./audio-event.js";
import { buildAudioGraphPlan } from "./audio-graph-plan.js";
import { AudioGraphRuntime } from "./audio-graph-runtime.js";

const closedError = () =>
  new DOMException("Audio context is closed", "InvalidStateError");

const unavailableError = () =>
  new DOMException("Web Audio API is not available", "NotSupportedError");

export class AudioContextElement extends AudioEventTargetElement {
  static audioEventTypes = ["statechange", "error"];
  static observedAttributes = ["onstatechange", "onerror"];

  #nativeContext = null;
  #runtime = null;
  #closed = false;
  #operationTail = Promise.resolve();
  #pendingKind = null;
  #pendingPromise = null;
  #closePromise = null;

  get state() {
    if (this.#closed) return "closed";
    return this.#runtime?.state ?? "suspended";
  }

  get currentTime() {
    return this.#nativeContext?.currentTime ?? 0;
  }

  get sampleRate() {
    return this.#nativeContext?.sampleRate ?? null;
  }

  resume() {
    if (this.#closed) return Promise.reject(closedError());
    if (this.#pendingKind === "resume") return this.#pendingPromise;

    const operation = this.#enqueue(() => this.#performResume());
    this.#trackPending("resume", operation);
    return operation;
  }

  suspend() {
    if (this.#closed) return Promise.reject(closedError());
    if (this.#pendingKind === "suspend") return this.#pendingPromise;

    const operation = this.#enqueue(() => this.#performSuspend());
    this.#trackPending("suspend", operation);
    return operation;
  }

  close() {
    if (this.#closePromise !== null) return this.#closePromise;
    this.#closed = true;
    this.#closePromise = this.#enqueue(() => this.#performClose());
    return this.#closePromise;
  }

  disconnectedCallback() {
    this.close().catch(() => {
      // Public error events report cleanup failures; this branch prevents rejection leaks.
    });
  }

  #enqueue(operation) {
    const result = this.#operationTail.then(operation);
    this.#operationTail = result.catch(() => {});
    return result;
  }

  async #performResume() {
    try {
      if (this.#runtime === null) {
        // Validation must complete before the first browser resource is created.
        const plan = buildAudioGraphPlan(this);
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (typeof Context !== "function") throw unavailableError();
        this.#nativeContext = new Context();
        this.#runtime = new AudioGraphRuntime(this, this.#nativeContext, plan);
      }
      if (this.#runtime.state === "running") return;
      await this.#runtime.resume();
      this.#dispatchStateChange();
    } catch (error) {
      if (this.#runtime !== null) this.#dispatchStateChange();
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  async #performSuspend() {
    try {
      if (this.#runtime === null || this.#runtime.state === "suspended") return;
      await this.#runtime.suspend();
      this.#dispatchStateChange();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  async #performClose() {
    try {
      if (this.#runtime !== null) await this.#runtime.close();
      this.#dispatchStateChange();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  #dispatchStateChange() {
    dispatchAudioEvent(this, "statechange", this.state, this);
  }

  #trackPending(kind, operation) {
    this.#pendingKind = kind;
    this.#pendingPromise = operation;
    operation.then(
      () => this.#clearPending(operation),
      () => this.#clearPending(operation),
    );
  }

  #clearPending(operation) {
    if (this.#pendingPromise !== operation) return;
    this.#pendingKind = null;
    this.#pendingPromise = null;
  }
}
