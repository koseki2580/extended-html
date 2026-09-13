import {
  findUniqueGraphElement,
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
      const source = findUniqueGraphElement(
        this.#editor,
        this.getAttribute("from") ?? "",
        "graph-event",
      );
      const handlerPath = parseGraphHandler(this.getAttribute("handler"));
      if (source !== this.#source) {
        this.#detach();
        this.#source = source;
        source.addEventListener("data", this.#handleData);
      }
      this.#handlerPath = handlerPath;
    } catch (error) {
      reportGraphError(this, error);
    }
  }

  #detach() {
    this.#source?.removeEventListener("data", this.#handleData);
    this.#source = null;
  }

  #handleData = (event) => {
    const runEvent = new CustomEvent("run", { detail: event.detail });
    this.dispatchEvent(runEvent);
    try {
      resolveGraphHandler(this.#handlerPath).call(this, runEvent);
    } catch (error) {
      reportGraphError(this, error);
    }
  };
}

if (!customElements.get("graph-action")) {
  customElements.define("graph-action", GraphActionElement);
}
