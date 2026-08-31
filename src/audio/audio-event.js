const DECLARATIVE_HANDLER_PATTERN =
  /^\s*([A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)?)\s*\(\s*event\s*\)\s*;?\s*$/;

export const dispatchAudioEvent = (
  element,
  type,
  data,
  owner,
  metadata = {},
) =>
  element.dispatchEvent(
    new CustomEvent(type, {
      bubbles: false,
      composed: false,
      detail: {
        data,
        metadata: {
          contextId: owner?.id || null,
          nodeId: element.id || null,
          nodeName: element.localName,
          ...metadata,
        },
      },
    }),
  );

export class AudioEventTargetElement extends HTMLElement {
  static audioEventTypes = [];

  #audioEventHandlers = new Map();
  #pendingSubclassHandlers = new Map();

  constructor() {
    super();
    for (const type of this.constructor.audioEventTypes ?? []) {
      this.#defineHandlerProperty(type);
    }
  }

  attributeChangedCallback(name, _oldValue, newValue) {
    if (!name.startsWith("on")) return;
    try {
      this._updateDeclarativeAudioHandler(name, newValue);
    } catch (error) {
      if (!(error instanceof SyntaxError)) throw error;
    } finally {
      this.#clearNativeInlineHandler(name);
    }
  }

  _setAudioEventHandler(type, handler) {
    this.#pendingSubclassHandlers.delete(type);
    this.#defineHandlerProperty(type);

    const current = this.#audioEventHandlers.get(type);
    if (current) this.removeEventListener(type, current.listener);
    this.#audioEventHandlers.delete(type);

    if (typeof handler === "function") {
      const listener = (event) => handler.call(this, event);
      this.#audioEventHandlers.set(type, { handler, listener });
      this.addEventListener(type, listener);
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
    const ownDescriptor = Object.getOwnPropertyDescriptor(this, propertyName);
    if (ownDescriptor && !("value" in ownDescriptor)) return;

    const priorValue = ownDescriptor?.value;
    if (ownDescriptor && !delete this[propertyName]) return;

    const subclassDescriptor = this.#findSubclassPropertyDescriptor(propertyName);
    const nativeHandler =
      !ownDescriptor && !this.hasAttribute(propertyName)
        ? this.#takeNativeInlineHandler(propertyName)
        : null;
    if (!subclassDescriptor) {
      Object.defineProperty(this, propertyName, {
        configurable: true,
        get: () => this.#audioEventHandlers.get(type)?.handler ?? null,
        set: (handler) => this._setAudioEventHandler(type, handler),
      });
    }

    if (ownDescriptor && this.#canAssign(subclassDescriptor)) {
      if (subclassDescriptor) {
        this.#deferSubclassValue(type, propertyName, priorValue);
      } else {
        this[propertyName] = priorValue;
      }
    } else if (typeof nativeHandler === "function") {
      if (subclassDescriptor) {
        this.#deferSubclassValue(type, propertyName, nativeHandler);
      } else {
        this[propertyName] = nativeHandler;
      }
    }
  }

  #findSubclassPropertyDescriptor(propertyName) {
    let prototype = Object.getPrototypeOf(this);
    while (prototype && prototype !== AudioEventTargetElement.prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (descriptor) return descriptor;
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  #deferSubclassValue(type, propertyName, value) {
    this.#pendingSubclassHandlers.set(type, value);
    queueMicrotask(() => {
      if (
        !this.#pendingSubclassHandlers.has(type) ||
        this.#pendingSubclassHandlers.get(type) !== value
      ) {
        return;
      }
      this.#pendingSubclassHandlers.delete(type);
      this[propertyName] = value;
    });
  }

  #clearNativeInlineHandler(propertyName) {
    const descriptor = this.#findNativeHandlerDescriptor(propertyName);
    if (typeof descriptor?.set === "function") {
      descriptor.set.call(this, null);
    }
  }

  #takeNativeInlineHandler(propertyName) {
    const descriptor = this.#findNativeHandlerDescriptor(propertyName);
    if (typeof descriptor?.get !== "function" || typeof descriptor.set !== "function") {
      return null;
    }
    const handler = descriptor.get.call(this);
    descriptor.set.call(this, null);
    return handler;
  }

  #findNativeHandlerDescriptor(propertyName) {
    let prototype = Object.getPrototypeOf(AudioEventTargetElement.prototype);
    while (prototype) {
      const descriptor = Object.getOwnPropertyDescriptor(prototype, propertyName);
      if (typeof descriptor?.set === "function") return descriptor;
      prototype = Object.getPrototypeOf(prototype);
    }
    return null;
  }

  #canAssign(descriptor) {
    return !descriptor || descriptor.writable || typeof descriptor.set === "function";
  }
}
