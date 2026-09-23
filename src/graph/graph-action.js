import {
  findGraphActionSource,
  parseGraphHandler,
  reportGraphError,
  resolveGraphHandler,
} from "./graph-handler.js";

export class GraphActionElement extends HTMLElement {
  static observedAttributes = ["from", "handler"];

  #editor = null;
  #source = null;
  #handlerPath = null;
  #observer = null;
  #rewireQueued = false;
  #revision = 0;

  connectedCallback() {
    this.#editor = this.closest("graph-editor");
    if (!this.#editor) {
      reportGraphError(
        this,
        new DOMException("<graph-action> requires a <graph-editor> ancestor", "SyntaxError"),
      );
      return;
    }
    this.#observer = new MutationObserver(() => this.#queueRewire());
    this.#observer.observe(this.#editor, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["id"],
    });
    this.#queueRewire();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#editor = null;
    this.#detach();
  }

  attributeChangedCallback() {
    if (this.isConnected) this.#queueRewire();
  }

  #queueRewire() {
    if (this.#rewireQueued) return;
    this.#rewireQueued = true;
    queueMicrotask(() => {
      this.#rewireQueued = false;
      if (this.isConnected) this.#rewire();
    });
  }

  #rewire() {
    try {
      const source = findGraphActionSource(this.#editor, this, this.getAttribute("from"));
      const handlerPath = parseGraphHandler(this.getAttribute("handler"));
      const handlerChanged = handlerPath.join(".") !== this.#handlerPath?.join(".");
      if (source !== this.#source) {
        this.#detach();
        this.#source = source;
        source?.addEventListener("data", this.#handleData);
      }
      this.#handlerPath = handlerPath;
      if (handlerChanged) this.#revision += 1;
    } catch (error) {
      reportGraphError(this, error);
    }
  }

  #detach() {
    this.#revision += 1;
    this.#source?.removeEventListener("data", this.#handleData);
    this.#source = null;
  }

  #handleData = (event) => {
    const runEvent = new CustomEvent("run", { detail: event.detail });
    this.dispatchEvent(runEvent);
    const revision = this.#revision;
    try {
      const result = resolveGraphHandler(this.#handlerPath, this.#editor).call(this, runEvent);
      const publish = (data) => {
        if (!this.isConnected || revision !== this.#revision || data === undefined) return;
        this.dispatchEvent(new CustomEvent("data", {
          detail: {
            data,
            metadata: { ...event.detail?.metadata, producerId: this.id || null },
          },
        }));
      };
      if (result && typeof result.then === "function") {
        Promise.resolve(result).then(publish, (error) => {
          if (this.isConnected && revision === this.#revision) reportGraphError(this, error);
        });
      } else {
        publish(result);
      }
    } catch (error) {
      reportGraphError(this, error);
    }
  };
}

if (!customElements.get("graph-action")) {
  customElements.define("graph-action", GraphActionElement);
}
