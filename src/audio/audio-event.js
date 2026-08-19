const DECLARATIVE_HANDLER_PATTERN =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(\s*event\s*\)\s*;?\s*$/;

export const dispatchAudioEvent = (element, type, data, owner) =>
  element.dispatchEvent(
    new CustomEvent(type, {
      bubbles: false,
      composed: false,
      detail: {
        data,
        metadata: {
          contextId: owner?.id ?? null,
          nodeId: element.id || null,
          nodeName: element.localName,
        },
      },
    }),
  );

export class AudioEventTargetElement extends HTMLElement {
  static audioEventTypes = [];

  #audioEventHandlers = new Map();

  constructor() {
    super();
    for (const type of this.constructor.audioEventTypes ?? []) {
      this.#defineHandlerProperty(type);
    }
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (name.startsWith("on")) {
      this._updateDeclarativeAudioHandler(name, newValue);
    }
  }

  _setAudioEventHandler(type, handler) {
    this.#defineHandlerProperty(type);

    const current = this.#audioEventHandlers.get(type);
    if (current) this.removeEventListener(type, current);
    this.#audioEventHandlers.delete(type);

    if (typeof handler === "function") {
      this.#audioEventHandlers.set(type, handler);
      this.addEventListener(type, handler);
    }
  }

  _updateDeclarativeAudioHandler(attributeName, value) {
    const type = attributeName.slice(2);
    if (value === null) {
      this._setAudioEventHandler(type, null);
      return;
    }

    const match = value.match(DECLARATIVE_HANDLER_PATTERN);
    if (!match) {
      throw new SyntaxError(
        `${attributeName} must call a global handler with event, for example Handler(event)`,
      );
    }

    const path = match[1].split(".");
    this._setAudioEventHandler(type, (event) => {
      let handler = globalThis;
      for (const part of path) handler = handler?.[part];
      if (typeof handler !== "function") {
        throw new ReferenceError(`${match[1]} is not a global function`);
      }
      return handler.call(this, event);
    });
  }

  #defineHandlerProperty(type) {
    const propertyName = `on${type}`;
    if (Object.hasOwn(this, propertyName)) return;
    Object.defineProperty(this, propertyName, {
      configurable: true,
      get: () => this.#audioEventHandlers.get(type) ?? null,
      set: (handler) => this._setAudioEventHandler(type, handler),
    });
  }
}
