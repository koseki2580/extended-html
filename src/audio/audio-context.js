import { AudioEventTargetElement, dispatchAudioEvent } from "./audio-event.js";
import { buildAudioGraphPlan } from "./audio-graph-plan.js";
import { AudioGraphRuntime } from "./audio-graph-runtime.js";

const closedError = () =>
  new DOMException("Audio context is closed", "InvalidStateError");

const unavailableError = () =>
  new DOMException("Web Audio API is not available", "NotSupportedError");

const GRAPH_ATTRIBUTES = [
  "id",
  "to",
  "type",
  "frequency",
  "detune",
  "q",
  "gain",
];

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
  #observer;
  #reconciliationQueued = false;
  #mutationGeneration = 0;
  #handleNativeStateChange = (event) => {
    dispatchAudioEvent(this, "statechange", event, this);
    if (this.#closed && this.#nativeContext?.state === "closed") {
      this.#removeNativeStateChangeListener();
    }
  };

  constructor() {
    super();
    this.#observer = new MutationObserver(() => {
      this.#mutationGeneration += 1;
      this.#queueReconciliation();
    });
    this.#observer.observe(this, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: GRAPH_ATTRIBUTES,
    });
  }

  get state() {
    if (this.#nativeContext !== null) return this.#nativeContext.state;
    return this.#closed ? "closed" : "suspended";
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
    // Stop observing before any asynchronous cleanup so later DOM writes are ignored.
    this.#observer.disconnect();
    this.#reconciliationQueued = false;
    this.#runtime?._requestTerminalClose();
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
      if (this.#closed) throw closedError();
      if (this.#runtime === null) {
        // Validation must complete before the first browser resource is created.
        const plan = buildAudioGraphPlan(this);
        for (const { element } of plan.nodes) {
          element._validateAudioConfiguration();
        }
        const Context = globalThis.AudioContext ?? globalThis.webkitAudioContext;
        if (typeof Context !== "function") throw unavailableError();
        this.#nativeContext = new Context();
        this.#nativeContext.addEventListener(
          "statechange",
          this.#handleNativeStateChange,
        );
        this.#runtime = new AudioGraphRuntime(this, this.#nativeContext, plan);
      }
      await this.#runtime.resume();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  async #performSuspend() {
    try {
      if (this.#runtime === null || this.#runtime.state === "suspended") return;
      await this.#runtime.suspend();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  async #performClose() {
    try {
      if (this.#runtime !== null) await this.#runtime.close();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      this.#removeNativeStateChangeListener();
      throw error;
    }
  }

  #queueReconciliation() {
    if (this.#closed || this.#runtime === null || this.#reconciliationQueued) {
      return;
    }
    this.#reconciliationQueued = true;
    queueMicrotask(() => {
      if (this.#closed || !this.#reconciliationQueued) return;
      this.#reconciliationQueued = false;
      this.#enqueue(() => this.#performReconciliation()).catch(() => {
        // Reconciliation errors are reported through the context error event.
      });
    });
  }

  async #performReconciliation() {
    if (this.#closed || this.#runtime === null) return;
    try {
      const generation = this.#mutationGeneration;
      const candidatePlan = buildAudioGraphPlan(this);
      for (const { element } of candidatePlan.nodes) {
        element._validateAudioConfiguration();
      }
      await this.#runtime.reconcile(candidatePlan, {
        isCurrent: () =>
          !this.#closed && generation === this.#mutationGeneration,
      });
    } catch (error) {
      if (!this.#closed) dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  #removeNativeStateChangeListener() {
    this.#nativeContext?.removeEventListener(
      "statechange",
      this.#handleNativeStateChange,
    );
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
