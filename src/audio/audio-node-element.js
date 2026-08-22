import { AudioEventTargetElement } from "./audio-event.js";

export class AudioNodeElement extends AudioEventTargetElement {
  #audioOwner = null;
  #audioNode = null;

  get to() {
    return this.getAttribute("to");
  }

  set to(value) {
    if (value === null) {
      this.removeAttribute("to");
      return;
    }
    this.setAttribute("to", String(value));
  }

  _setAudioOwner(owner) {
    if (owner === null || owner === undefined) return;
    if (owner === this.#audioOwner) return;
    if (this.#audioOwner !== null) {
      throw new DOMException(
        "Audio node already belongs to a different audio context",
        "InvalidStateError",
      );
    }
    this.#audioOwner = owner;
  }

  _clearAudioOwner(owner) {
    if (owner === this.#audioOwner) this.#audioOwner = null;
  }

  _getAudioOwner() {
    return this.#audioOwner;
  }

  _attachAudioNode(node) {
    if (node === null || node === undefined) {
      throw new TypeError("Audio node must not be null or undefined");
    }
    if (node === this.#audioNode) return node;
    if (this.#audioNode !== null) {
      throw new DOMException(
        "Audio node already has a different native node attached",
        "InvalidStateError",
      );
    }
    this.#audioNode = node;
    return node;
  }

  _getAudioNode() {
    if (this.#audioNode === null) {
      throw new DOMException("Audio node is not attached", "InvalidStateError");
    }
    return this.#audioNode;
  }

  _detachAudioNode(node) {
    if (node !== this.#audioNode) return null;
    this.#audioNode = null;
    return node;
  }

  _createAudioNode() {
    throw new DOMException("Audio node creation is not supported", "NotSupportedError");
  }

  _configureAudioNode() {}

  _validateAudioConfiguration() {}
}

export class AudioSourceElement extends AudioNodeElement {
  async _activate() {}

  async _connected() {}

  async _suspend() {}

  async _close() {}
}
