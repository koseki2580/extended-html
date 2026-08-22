const closedError = () =>
  new DOMException("Audio graph runtime is closed", "InvalidStateError");

const edgeKey = (edge, elementIndexes) =>
  `${elementIndexes.get(edge.from)}:${elementIndexes.get(edge.to)}`;

export class AudioGraphRuntime {
  #owner;
  #context;
  #plan;
  #nodes = new Map();
  #appliedEdges = new Map();
  #initialized = false;
  #state = "suspended";
  #resumePromise = null;
  #suspendPromise = null;
  #closePromise = null;

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
    this.#closePromise = this.#performClose();
    return this.#closePromise;
  }

  async #performResume() {
    if (this.#state === "running") {
      await this.#context.resume();
      return;
    }

    const activated = [];
    try {
      this.#initialize();
      // A prior failed attempt may have released edges while retaining reusable nodes.
      this.#applyAvailableEdges();
      await this.#context.resume();

      for (const { element } of this.#plan.sources) {
        // Include the current source so a partially acquired resource is also released.
        activated.push(element);
        await element._activate(this.#context);
        this.#captureActivatedNode(element);
        this.#applyAvailableEdges();
        await element._connected();
      }
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
      this.#applyAvailableEdges();
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
    if (this.#nodes.has(element)) return;
    this.#nodes.set(element, element._getAudioNode());
  }

  #applyAvailableEdges() {
    const indexes = new Map(
      this.#plan.nodes.map(({ element }, index) => [element, index]),
    );
    for (const edge of this.#plan.edges) {
      const from = this.#nodes.get(edge.from);
      const to = this.#nodes.get(edge.to);
      if (!from || !to) continue;
      const key = edgeKey(edge, indexes);
      if (this.#appliedEdges.has(key)) continue;
      from.connect(to);
      this.#appliedEdges.set(key, { from, to });
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
    for (const { from, to } of [...this.#appliedEdges.values()].reverse()) {
      try {
        from.disconnect(to);
      } catch {
        // A source hook may already have disconnected its native node.
      }
    }
    this.#appliedEdges.clear();
  }

  #releaseNodes() {
    for (const { element, role } of [...this.#plan.nodes].reverse()) {
      const node = this.#nodes.get(element);
      if (node && role !== "output") {
        try {
          node.disconnect();
        } catch {
          // Disconnection is best-effort during terminal cleanup and rollback.
        }
      }
      if (node) element._detachAudioNode(node);
      element._clearAudioOwner(this.#owner);
    }
    this.#nodes.clear();
    this.#initialized = false;
  }
}
