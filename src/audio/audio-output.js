import { AudioNodeElement } from "./audio-node-element.js";

export class AudioOutputElement extends AudioNodeElement {
  _createAudioNode(context) {
    return context.destination;
  }

  _configureAudioNode() {}

  async _activate() {}

  async _suspend() {}

  async _close() {}
}
