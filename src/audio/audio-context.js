import { AudioEventTargetElement, dispatchAudioEvent } from "./audio-event.js";
import { buildAudioGraphPlan } from "./audio-graph-plan.js";
import { AudioGraphRuntime } from "./audio-graph-runtime.js";

const closedError = () =>
  new DOMException("Audio context is closed", "InvalidStateError");

const unavailableError = () =>
  new DOMException("Web Audio API is not available", "NotSupportedError");

const outputSelectionUnavailableError = () =>
  new DOMException(
    "Audio output selection is not available",
    "NotSupportedError",
  );

const GRAPH_ATTRIBUTES = [
  "id",
  "to",
  "type",
  "frequency",
  "detune",
  "q",
  "gain",
];

const CONFIGURATION_ATTRIBUTES = new Set([
  "type",
  "frequency",
  "detune",
  "q",
  "gain",
]);

export class AudioContextElement extends AudioEventTargetElement {
  static audioEventTypes = ["statechange", "sinkchange", "error"];
  static observedAttributes = [
    "sink-id",
    "onstatechange",
    "onsinkchange",
    "onerror",
  ];

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
  #dirtyConfigurationElements = new Set();
  #dirtyConfigurationGenerations = new Map();
  #committedSinkId = "";
  #sinkChangePromise = Promise.resolve();
  #reflectingSinkId = false;
  #activeSinkRequest = null;
  #handleNativeStateChange = (event) => {
    dispatchAudioEvent(this, "statechange", event, this);
    if (this.#closed && this.#nativeContext?.state === "closed") {
      this.#removeNativeStateChangeListener();
    }
  };
  #handleNativeSinkChange = (event) => {
    const previousSinkId = this.#committedSinkId;
    const sinkId = String(this.#nativeContext?.sinkId ?? "");
    this.#committedSinkId = sinkId;
    if (this.#activeSinkRequest === null || this.sinkId === this.#activeSinkRequest) {
      this.#reflectSinkId(sinkId);
    }
    dispatchAudioEvent(
      this,
      "sinkchange",
      { previousSinkId, sinkId, event },
      this,
    );
  };

  constructor() {
    super();
    this.#observer = new MutationObserver((records) => {
      if (this.#recordMutations(records)) this.#queueReconciliation();
    });
    this.#observer.observe(this, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeOldValue: true,
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

  get sinkId() {
    return this.getAttribute("sink-id") ?? "";
  }

  set sinkId(value) {
    this.setAttribute("sink-id", String(value ?? ""));
  }

  setSinkId(value) {
    if (this.#closed) return Promise.reject(closedError());
    this.sinkId = value;
    return this.#sinkChangePromise;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (
      name !== "sink-id" ||
      oldValue === newValue ||
      this.#reflectingSinkId
    ) {
      return;
    }
    if (this.#nativeContext === null) {
      this.#sinkChangePromise = Promise.resolve();
      return;
    }

    const requestedSinkId = newValue ?? "";
    const operation = this.#enqueue(() =>
      this.#performSinkChange(requestedSinkId),
    );
    this.#sinkChangePromise = operation;
    operation.catch(() => {
      // A completed older request must not overwrite a newer requested value.
      if (this.sinkId !== requestedSinkId) return;
      this.#reflectSinkId(this.#committedSinkId);
    });
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
    this.#dirtyConfigurationElements.clear();
    this.#dirtyConfigurationGenerations.clear();
    this.#runtime?._requestTerminalClose();
    this.#closePromise = this.#enqueue(() => this.#performClose());
    return this.#closePromise;
  }

  _setMicrophoneDevice(element, deviceId) {
    if (this.#closed) return Promise.reject(closedError());
    return this.#enqueue(() =>
      this.#performMicrophoneDeviceChange(element, deviceId),
    );
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
      let initialPlan = null;
      let configurationSnapshot = null;
      if (this.#runtime === null) {
        // Validation must complete before the first browser resource is created.
        this.#recordMutations(this.#observer.takeRecords());
        const plan = buildAudioGraphPlan(this);
        initialPlan = plan;
        configurationSnapshot = this.#snapshotDirtyConfiguration();
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
        this.#nativeContext.addEventListener(
          "sinkchange",
          this.#handleNativeSinkChange,
        );
        this.#committedSinkId = String(this.#nativeContext.sinkId ?? "");
        this.#runtime = new AudioGraphRuntime(this, this.#nativeContext, plan);
      }
      await this.#applyNativeSink(this.sinkId);
      await this.#runtime.resume();
      if (initialPlan !== null) {
        this.#clearCommittedConfiguration(configurationSnapshot);
      }
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
      this.#removeNativeSinkChangeListener();
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      this.#removeNativeStateChangeListener();
      this.#removeNativeSinkChangeListener();
      throw error;
    }
  }

  async #performSinkChange(sinkId) {
    try {
      if (this.#closed) throw closedError();
      await this.#applyNativeSink(sinkId);
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  async #applyNativeSink(sinkId) {
    if (this.#nativeContext === null || sinkId === this.#committedSinkId) return;
    if (typeof this.#nativeContext.setSinkId !== "function") {
      throw outputSelectionUnavailableError();
    }

    this.#activeSinkRequest = sinkId;
    try {
      await this.#nativeContext.setSinkId(sinkId);
    } finally {
      this.#activeSinkRequest = null;
    }
  }

  async #performMicrophoneDeviceChange(element, deviceId) {
    try {
      if (this.#closed) throw closedError();
      if (this.#runtime === null || !element._hasActiveAudioDevice()) return;
      const candidate = await element._createDeviceCandidate(
        this.#nativeContext,
        deviceId,
      );
      if (this.#closed) {
        candidate.rollback();
        throw closedError();
      }
      candidate.setActive(this.#runtime.state === "running");
      this.#runtime.replaceSource(element, candidate);
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this);
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
      const configurationSnapshot = this.#snapshotDirtyConfiguration();
      const candidatePlan = buildAudioGraphPlan(this);
      for (const { element } of candidatePlan.nodes) {
        element._validateAudioConfiguration();
      }
      const committed = await this.#runtime.reconcile(candidatePlan, {
        isCurrent: () =>
          !this.#closed && generation === this.#mutationGeneration,
        dirtyNodes: new Set(configurationSnapshot.keys()),
      });
      if (committed) {
        this.#clearCommittedConfiguration(configurationSnapshot);
      }
    } catch (error) {
      if (!this.#closed) dispatchAudioEvent(this, "error", error, this);
      throw error;
    }
  }

  #recordMutations(records) {
    const historicalIdRecords = this.#historicalIdRemovalRecords(records);
    const relevantRecords = records.filter((record) =>
      this.#isRelevantMutation(record, historicalIdRecords),
    );
    if (relevantRecords.length === 0) return false;
    this.#mutationGeneration += 1;
    for (const record of relevantRecords) {
      if (
        record.type === "attributes" &&
        CONFIGURATION_ATTRIBUTES.has(record.attributeName)
      ) {
        this.#dirtyConfigurationElements.add(record.target);
        this.#dirtyConfigurationGenerations.set(
          record.target,
          this.#mutationGeneration,
        );
      }
    }
    return true;
  }

  #historicalIdRemovalRecords(records) {
    const relevant = new Set();
    const removals = records.filter(
      (record) =>
        record.type === "childList" &&
        record.removedNodes.length > 0 &&
        (record.target === this ||
          record.target.closest?.("audio-context") === this),
    );
    for (const attributeRecord of records) {
      if (
        attributeRecord.type !== "attributes" ||
        attributeRecord.attributeName !== "id" ||
        !attributeRecord.oldValue
      ) {
        continue;
      }
      for (const removal of removals) {
        const containsTarget = [...removal.removedNodes].some((node) =>
          this.#isolatedSubtreeContains(node, attributeRecord.target),
        );
        if (!containsTarget) continue;
        relevant.add(attributeRecord);
        relevant.add(removal);
      }
    }
    return relevant;
  }

  #isRelevantMutation(record, historicalIdRecords) {
    if (historicalIdRecords.has(record)) return true;
    const targetIsOwned =
      record.target === this ||
      record.target.closest?.("audio-context") === this;
    if (!targetIsOwned) return false;
    if (record.type !== "childList") return true;

    return [...record.addedNodes, ...record.removedNodes].some((node) =>
      this.#subtreeAffectsAudioGraph(node),
    );
  }

  #isolatedSubtreeContains(node, target) {
    if (node.nodeType !== 1 || node.localName === "audio-context") return false;
    if (node === target) return true;
    return [...node.children].some((child) =>
      this.#isolatedSubtreeContains(child, target),
    );
  }

  #subtreeAffectsAudioGraph(node) {
    if (node.nodeType !== 1) return false;
    if (node.localName === "audio-context") return false;
    if (node.id) return true;
    if (node.localName.startsWith("audio-")) return true;
    return [...node.children].some((child) =>
      this.#subtreeAffectsAudioGraph(child),
    );
  }

  #snapshotDirtyConfiguration() {
    return new Map(
      [...this.#dirtyConfigurationElements].map((element) => [
        element,
        this.#dirtyConfigurationGenerations.get(element),
      ]),
    );
  }

  #clearCommittedConfiguration(snapshot) {
    for (const [element, generation] of snapshot) {
      if (this.#dirtyConfigurationGenerations.get(element) !== generation) {
        continue;
      }
      this.#dirtyConfigurationElements.delete(element);
      this.#dirtyConfigurationGenerations.delete(element);
    }
  }

  #removeNativeStateChangeListener() {
    this.#nativeContext?.removeEventListener(
      "statechange",
      this.#handleNativeStateChange,
    );
  }

  #removeNativeSinkChangeListener() {
    this.#nativeContext?.removeEventListener(
      "sinkchange",
      this.#handleNativeSinkChange,
    );
  }

  #reflectSinkId(sinkId) {
    this.#reflectingSinkId = true;
    try {
      this.setAttribute("sink-id", sinkId);
    } finally {
      this.#reflectingSinkId = false;
    }
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
