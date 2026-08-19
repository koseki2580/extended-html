export class WorkerBridge {
  #worker;
  #onMessage;
  #onFailure;
  #phase = "initialization";
  #queue = [];
  #disposed = false;

  constructor(
    workerUrl,
    {
      onMessage = () => {},
      onFailure = () => {},
      WorkerImpl = globalThis.Worker,
    } = {},
  ) {
    this.#onMessage = onMessage;
    this.#onFailure = onFailure;
    this.#worker = new WorkerImpl(workerUrl, { type: "module" });
    this.#worker.addEventListener("message", this.#handleMessage);
    this.#worker.addEventListener("error", this.#handleFailure);
    this.#worker.addEventListener("messageerror", this.#handleFailure);
  }

  postMessage(message) {
    if (this.#disposed) {
      throw new DOMException("The Worker bridge is disposed", "InvalidStateError");
    }
    if (this.#phase === "initialization") {
      this.#queue.push(message);
      return;
    }
    this.#postToWorker(message);
  }

  dispose() {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#queue = [];
    this.#worker.removeEventListener("message", this.#handleMessage);
    this.#worker.removeEventListener("error", this.#handleFailure);
    this.#worker.removeEventListener("messageerror", this.#handleFailure);
    this.#worker.terminate();
  }

  #handleMessage = (event) => {
    if (this.#disposed) return;
    if (event.data?.type === "ready") {
      if (this.#phase === "ready") return;
      this.#phase = "ready";
      const queued = this.#queue;
      this.#queue = [];
      for (const message of queued) {
        if (this.#disposed) break;
        this.#postToWorker(message);
      }
      return;
    }
    this.#onMessage(event.data);
  };

  #handleFailure = (event) => {
    if (this.#disposed) return;
    event.preventDefault?.();
    const phase =
      this.#phase === "initialization" ? "initialization" : "runtime";
    const error =
      event.error ??
      new Error(event.message || "The Worker transport failed unexpectedly");
    this.dispose();
    this.#onFailure(error, phase);
  };

  #postToWorker(message) {
    try {
      // Do not use a transfer list: caller-owned buffers must remain usable.
      this.#worker.postMessage(message);
    } catch (error) {
      this.dispose();
      const phase =
        this.#phase === "initialization" ? "initialization" : "runtime";
      this.#onFailure(error, phase);
    }
  }
}
