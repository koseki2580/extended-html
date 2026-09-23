import { assertGraphAcyclic, findUniqueGraphElement, reportGraphError } from "./graph-handler.js";

const eventPayload = (event) => {
  if (event.detail && Object.hasOwn(event.detail, "data")) {
    return {
      data: event.detail.data,
      metadata: event.detail.metadata ?? {},
    };
  }
  if ("data" in event) return { data: event.data, metadata: {} };
  return { data: event, metadata: {} };
};

export class GraphEventElement extends HTMLElement {
  static observedAttributes = ["from", "type"];

  #editor = null;
  #source = null;
  #sourceType = null;
  #observer = null;
  #rewireQueued = false;

  connectedCallback() {
    this.#editor = this.closest("graph-editor");
    if (!this.#editor) {
      reportGraphError(
        this,
        new DOMException("<graph-event> requires a <graph-editor> ancestor", "SyntaxError"),
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
      );
      if (source === this) {
        throw new DOMException("<graph-event> cannot listen to itself", "SyntaxError");
      }
      assertGraphAcyclic(this.#editor, this, source);
      const type = this.getAttribute("type")?.trim();
      if (!type) {
        throw new DOMException("<graph-event> requires a non-empty type", "SyntaxError");
      }
      if (source === this.#source && type === this.#sourceType) return;
      this.#detach();
      this.#source = source;
      this.#sourceType = type;
      source.addEventListener(type, this.#handleSourceEvent);
    } catch (error) {
      reportGraphError(this, error);
    }
  }

  #detach() {
    this.#source?.removeEventListener(this.#sourceType, this.#handleSourceEvent);
    this.#source = null;
    this.#sourceType = null;
  }

  #handleSourceEvent = (event) => {
    const payload = eventPayload(event);
    this.dispatchEvent(
      new CustomEvent("data", {
        detail: {
          data: payload.data,
          metadata: {
            ...payload.metadata,
            sourceId: this.#source.id,
            sourceEvent: this.#sourceType,
            eventId: this.id || null,
          },
        },
      }),
    );
  };
}

if (!customElements.get("graph-event")) {
  customElements.define("graph-event", GraphEventElement);
}
