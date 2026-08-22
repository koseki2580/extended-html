const closedError = () =>
  new DOMException("Audio graph runtime is closed", "InvalidStateError");

const closingError = () =>
  new DOMException("Audio context is closing", "InvalidStateError");

const STALE_CANDIDATE = Symbol("stale audio graph candidate");

export class AudioGraphRuntime {
  #owner;
  #context;
  #plan;
  #nodes = new Map();
  #appliedEdges = new Map();
  #nativeEdgeReferences = new WeakMap();
  #elementIds = new WeakMap();
  #nextElementId = 0;
  #initialized = false;
  #state = "suspended";
  #resumePromise = null;
  #suspendPromise = null;
  #closePromise = null;
  #terminalRequested = false;

  constructor(owner, context, plan) {
    this.#owner = owner;
    this.#context = context;
    this.#plan = plan;
  }

  get state() {
    return this.#state;
  }

  resume() {
    if (this.#state === "closed") return Promise.reject(closedError());
    if (this.#terminalRequested) return Promise.reject(closingError());
    if (this.#state === "running" && this.#context.state === "running") {
      return Promise.resolve();
    }
    if (this.#resumePromise !== null) return this.#resumePromise;

    const operation = this.#performResume();
    this.#resumePromise = operation;
    operation.then(
      () => {
        if (this.#resumePromise === operation) this.#resumePromise = null;
      },
      () => {
        if (this.#resumePromise === operation) this.#resumePromise = null;
      },
    );
    return operation;
  }

  suspend() {
    if (this.#state === "closed") return Promise.reject(closedError());
    if (this.#state === "suspended" && this.#resumePromise === null) {
      return Promise.resolve();
    }
    if (this.#suspendPromise !== null) return this.#suspendPromise;

    const operation = this.#performSuspend();
    this.#suspendPromise = operation;
    operation.then(
      () => {
        if (this.#suspendPromise === operation) this.#suspendPromise = null;
      },
      () => {
        if (this.#suspendPromise === operation) this.#suspendPromise = null;
      },
    );
    return operation;
  }

  close() {
    if (this.#closePromise !== null) return this.#closePromise;
    this._requestTerminalClose();
    this.#closePromise = this.#performClose();
    return this.#closePromise;
  }

  async reconcile(
    candidatePlan,
    { isCurrent = () => true, dirtyNodes = new Set() } = {},
  ) {
    if (this.#state === "closed") throw closedError();
    if (this.#terminalRequested) throw closingError();
    if (!isCurrent()) return false;

    const previousPlan = this.#plan;
    const previousElements = new Set(
      previousPlan.nodes.map(({ element }) => element),
    );
    const candidateElements = new Set(
      candidatePlan.nodes.map(({ element }) => element),
    );
    const addedNodes = candidatePlan.nodes.filter(
      ({ element }) => !previousElements.has(element),
    );
    const addedSources = candidatePlan.sources.filter(
      ({ element }) => !previousElements.has(element),
    );
    const addedEdgeKeys = [];
    const activatedSources = [];
    const configuredNodes = [];
    const configuredElements = new Set();
    const configureNode = (element) => {
      if (configuredElements.has(element) || !this.#nodes.has(element)) return;
      const configuration = element._captureAudioConfiguration();
      if (configuration !== null) {
        configuredNodes.push({ element, configuration });
      }
      element._configureAudioNode(this.#nodes.get(element));
      configuredElements.add(element);
    };

    try {
      this.#throwIfCandidateStale(isCurrent);
      for (const { element } of candidatePlan.nodes) {
        if (
          !previousElements.has(element) ||
          !this.#nodes.has(element) ||
          !dirtyNodes.has(element)
        ) {
          continue;
        }
        configureNode(element);
      }

      for (const { element, role } of addedNodes) {
        element._setAudioOwner(this.#owner);
        if (role === "source") {
          try {
            this.#createAndAttachNode(element);
          } catch (error) {
            if (error.name !== "NotSupportedError") throw error;
          }
        } else {
          this.#createAndAttachNode(element);
        }
        configureNode(element);
      }

      this.#applyAvailableEdges(candidatePlan, addedEdgeKeys);
      if (this.#state === "running") {
        for (const { element } of addedSources) {
          this.#throwIfTerminalRequested();
          this.#throwIfCandidateStale(isCurrent);
          activatedSources.push(element);
          await element._activate(this.#context);
          this.#throwIfTerminalRequested();
          this.#throwIfCandidateStale(isCurrent);
          this.#captureActivatedNode(element);
          configureNode(element);
          this.#applyAvailableEdges(candidatePlan, addedEdgeKeys);
          this.#throwIfTerminalRequested();
          this.#throwIfCandidateStale(isCurrent);
          await element._connected();
          this.#throwIfCandidateStale(isCurrent);
        }
      }
      this.#throwIfCandidateStale(isCurrent);
    } catch (error) {
      await this.#rollbackCandidate(
        activatedSources,
        addedEdgeKeys,
        addedNodes,
        configuredNodes,
      );
      if (error === STALE_CANDIDATE) return false;
      throw error;
    }

    const candidateEdgeKeys = new Set(
      candidatePlan.edges.map((edge) => this.#edgeKey(edge)),
    );
    for (const [key, edge] of [...this.#appliedEdges]) {
      if (candidateEdgeKeys.has(key)) continue;
      this.#disconnectEdge(key, edge);
    }

    this.#plan = candidatePlan;
    let firstCleanupError = null;
    const removedNodes = [...previousPlan.nodes]
      .reverse()
      .filter(({ element }) => !candidateElements.has(element));
    for (const node of removedNodes) {
      if (node.role === "source") {
        try {
          await node.element._close();
        } catch (error) {
          firstCleanupError ??= error;
        }
      }
      this.#releaseNode(node);
    }
    if (firstCleanupError !== null) throw firstCleanupError;
    return true;
  }

  _requestTerminalClose() {
    this.#terminalRequested = true;
  }

  async #performResume() {
    this.#throwIfTerminalRequested();
    if (this.#state === "running") {
      await this.#context.resume();
      this.#throwIfTerminalRequested();
      return;
    }

    const activated = [];
    try {
      this.#initialize();
      // A prior failed attempt may have released edges while retaining reusable nodes.
      this.#applyAvailableEdges(this.#plan);
      await this.#context.resume();
      this.#throwIfTerminalRequested();

      for (const { element } of this.#plan.sources) {
        this.#throwIfTerminalRequested();
        // Include the current source so a partially acquired resource is also released.
        activated.push(element);
        await element._activate(this.#context);
        this.#throwIfTerminalRequested();
        this.#captureActivatedNode(element);
        this.#applyAvailableEdges(this.#plan);
        this.#throwIfTerminalRequested();
        await element._connected();
        this.#throwIfTerminalRequested();
      }
      this.#throwIfTerminalRequested();
      this.#state = "running";
    } catch (error) {
      await this.#rollback(activated);
      throw error;
    }
  }

  async #performSuspend() {
    if (this.#resumePromise !== null) await this.#resumePromise;

    let firstError = null;
    for (const { element } of [...this.#plan.sources].reverse()) {
      try {
        await element._suspend();
      } catch (error) {
        firstError ??= error;
      }
    }
    try {
      await this.#context.suspend();
    } catch (error) {
      firstError ??= error;
    }
    // Any attempted suspension may have paused a subset of sources.
    // A later resume must therefore run the complete source activation sequence.
    this.#state = "suspended";
    if (firstError !== null) throw firstError;
  }

  async #performClose() {
    if (this.#resumePromise !== null) {
      try {
        await this.#resumePromise;
      } catch {
        // Resume rollback has already released everything acquired by that operation.
      }
    }

    let firstError = null;
    for (const { element } of [...this.#plan.sources].reverse()) {
      try {
        await element._close();
      } catch (error) {
        firstError ??= error;
      }
    }
    this.#disconnectGraph();
    this.#releaseNodes();
    try {
      await this.#context.close();
    } catch (error) {
      firstError ??= error;
    }
    this.#state = "closed";
    if (firstError !== null) throw firstError;
  }

  #initialize() {
    if (this.#initialized) return;

    try {
      for (const { element, role } of this.#plan.nodes) {
        element._setAudioOwner(this.#owner);
        if (role === "source") {
          try {
            this.#createAndAttachNode(element);
          } catch (error) {
            // Microphone sources cannot create a node until permission resolves.
            if (error.name !== "NotSupportedError") throw error;
          }
        } else {
          this.#createAndAttachNode(element);
        }
      }
      this.#applyAvailableEdges(this.#plan);
      this.#initialized = true;
    } catch (error) {
      this.#disconnectGraph();
      this.#releaseNodes();
      throw error;
    }
  }

  #createAndAttachNode(element) {
    const node = element._createAudioNode(this.#context);
    element._attachAudioNode(node);
    this.#nodes.set(element, node);
  }

  #captureActivatedNode(element) {
    const activatedNode = element._getAudioNode();
    const previousNode = this.#nodes.get(element);
    if (previousNode === activatedNode) return;
    if (previousNode) {
      for (const [key, edge] of [...this.#appliedEdges]) {
        if (edge.fromElement === element || edge.toElement === element) {
          this.#disconnectEdge(key, edge);
        }
      }
    }
    this.#nodes.set(element, activatedNode);
  }

  #applyAvailableEdges(plan, addedEdgeKeys = null) {
    for (const edge of plan.edges) {
      const from = this.#nodes.get(edge.from);
      const to = this.#nodes.get(edge.to);
      if (!from || !to) continue;
      const key = this.#edgeKey(edge);
      if (this.#appliedEdges.has(key)) continue;
      try {
        this.#retainNativeEdge(from, to);
      } catch (error) {
        try {
          from.disconnect(to);
        } catch {
          // A failed native connection may not have created an edge to remove.
        }
        throw error;
      }
      this.#appliedEdges.set(key, {
        from,
        to,
        fromElement: edge.from,
        toElement: edge.to,
      });
      addedEdgeKeys?.push(key);
    }
  }

  #retainNativeEdge(from, to) {
    let targets = this.#nativeEdgeReferences.get(from);
    if (!targets) {
      targets = new Map();
      this.#nativeEdgeReferences.set(from, targets);
    }
    const references = targets.get(to) ?? 0;
    if (references === 0) from.connect(to);
    targets.set(to, references + 1);
  }

  #releaseNativeEdge(from, to) {
    const targets = this.#nativeEdgeReferences.get(from);
    const references = targets?.get(to) ?? 0;
    if (references > 1) {
      targets.set(to, references - 1);
      return;
    }
    if (references === 1) {
      try {
        from.disconnect(to);
      } catch {
        // A source hook may already have disconnected its native node.
      }
      targets.delete(to);
    }
  }

  #edgeKey({ from, to }) {
    return `${this.#elementId(from)}:${this.#elementId(to)}`;
  }

  #elementId(element) {
    if (!this.#elementIds.has(element)) {
      this.#elementIds.set(element, this.#nextElementId);
      this.#nextElementId += 1;
    }
    return this.#elementIds.get(element);
  }

  async #rollbackCandidate(
    activatedSources,
    addedEdgeKeys,
    addedNodes,
    configuredNodes,
  ) {
    for (const element of [...activatedSources].reverse()) {
      try {
        await element._close();
      } catch {
        // Candidate cleanup preserves the reconciliation error reported to the owner.
      }
    }
    for (const key of [...addedEdgeKeys].reverse()) {
      const edge = this.#appliedEdges.get(key);
      if (edge) this.#disconnectEdge(key, edge);
    }
    for (const node of [...addedNodes].reverse()) this.#releaseNode(node);
    for (const { element, configuration } of [...configuredNodes].reverse()) {
      try {
        element._restoreAudioConfiguration(configuration);
      } catch {
        // Rollback remains best-effort and preserves the candidate failure.
      }
    }
  }

  async #rollback(activated) {
    for (const element of [...activated].reverse()) {
      try {
        await element._suspend();
      } catch {
        // Rollback preserves the activation failure reported to the caller.
      }
    }
    this.#disconnectGraph();
    try {
      await this.#context.suspend();
    } catch {
      // Rollback preserves the activation failure reported to the caller.
    }
    this.#state = "suspended";
  }

  #disconnectGraph() {
    for (const [key, edge] of [...this.#appliedEdges].reverse()) {
      this.#disconnectEdge(key, edge);
    }
  }

  #disconnectEdge(key, { from, to }) {
    this.#releaseNativeEdge(from, to);
    this.#appliedEdges.delete(key);
  }

  #throwIfTerminalRequested() {
    if (this.#terminalRequested) throw closingError();
  }

  #throwIfCandidateStale(isCurrent) {
    if (!isCurrent()) throw STALE_CANDIDATE;
  }

  #releaseNodes() {
    for (const planNode of [...this.#plan.nodes].reverse()) {
      this.#releaseNode(planNode);
    }
    this.#nodes.clear();
    this.#initialized = false;
  }

  #releaseNode({ element, role }) {
    const node = this.#nodes.get(element);
    if (node && role !== "output") {
      try {
        node.disconnect();
      } catch {
        // Disconnection is best-effort during terminal cleanup and rollback.
      }
    }
    if (node) element._detachAudioNode(node);
    this.#nodes.delete(element);
    element._clearAudioOwner(this.#owner);
  }
}
