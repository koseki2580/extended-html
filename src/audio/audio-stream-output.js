import { AudioNodeElement } from "./audio-node-element.js";

export class AudioStreamOutputElement extends AudioNodeElement {
  get stream() {
    try {
      return this._getAudioNode().stream ?? null;
    } catch (error) {
      if (error.name === "InvalidStateError") return null;
      throw error;
    }
  }

  _createAudioNode(context) {
    return context.createMediaStreamDestination();
  }

  _configureAudioNode() {}

  async _activate() {}

  async _suspend() {}

  async _close() {}
}
