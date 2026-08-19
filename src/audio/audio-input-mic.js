import { dispatchAudioEvent } from "./audio-event.js";
import { AudioSourceElement } from "./audio-node-element.js";

const contextMismatchError = () =>
  new DOMException(
    "Microphone input already belongs to a different AudioContext",
    "InvalidStateError",
  );

const closedError = () =>
  new DOMException("Microphone input is closed", "InvalidStateError");

export class AudioInputMicElement extends AudioSourceElement {
  static audioEventTypes = ["open", "close", "error"];
  static observedAttributes = ["onopen", "onclose", "onerror"];

  #nativeContext = null;
  #stream = null;
  #sourceNode = null;
  #activationPromise = null;
  #closed = false;

  async _activate(context) {
    if (this.#closed) throw closedError();
    this.#bindContext(context);

    if (this.#activationPromise !== null) return this.#activationPromise;

    const liveTracks = this.#liveTracks();
    if (liveTracks.length > 0) {
      for (const track of liveTracks) track.enabled = true;
      return;
    }

    this.#releaseSource();
    this.#stream = null;
    const activation = this.#acquireStream(context);
    this.#activationPromise = activation;
    try {
      await activation;
    } finally {
      if (this.#activationPromise === activation) this.#activationPromise = null;
    }
  }

  async _suspend() {
    if (this.#activationPromise !== null) await this.#activationPromise;
    for (const track of this.#stream?.getTracks() ?? []) {
      track.enabled = false;
    }
  }

  async _close() {
    if (this.#closed) return;
    this.#closed = true;

    // Finish an in-flight permission request before releasing its resulting resources.
    if (this.#activationPromise !== null) {
      try {
        await this.#activationPromise;
      } catch {
        // Acquisition already reports its own error; close remains best-effort cleanup.
      }
    }

    const stream = this.#stream;
    if (stream === null) return;

    for (const track of stream.getTracks()) track.stop();
    this.#releaseSource();
    this.#stream = null;
    dispatchAudioEvent(this, "close", stream, this._getAudioOwner());
  }

  #bindContext(context) {
    if (this.#nativeContext === null) {
      this.#nativeContext = context;
      return;
    }
    if (this.#nativeContext !== context) throw contextMismatchError();
  }

  #liveTracks() {
    return (this.#stream?.getTracks() ?? []).filter(
      (track) => track.readyState === "live",
    );
  }

  async #acquireStream(context) {
    let stream = null;
    let sourceNode = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      sourceNode = context.createMediaStreamSource(stream);
      this.#stream = stream;
      this.#sourceNode = sourceNode;
      this._attachAudioNode(sourceNode);
      dispatchAudioEvent(this, "open", stream, this._getAudioOwner());
    } catch (error) {
      if (sourceNode !== null) sourceNode.disconnect();
      for (const track of stream?.getTracks() ?? []) track.stop();
      if (this.#sourceNode === sourceNode) this.#sourceNode = null;
      if (this.#stream === stream) this.#stream = null;
      this._detachAudioNode(sourceNode);
      dispatchAudioEvent(this, "error", error, this._getAudioOwner());
      throw error;
    }
  }

  #releaseSource() {
    if (this.#sourceNode === null) return;
    this.#sourceNode.disconnect();
    this._detachAudioNode(this.#sourceNode);
    this.#sourceNode = null;
  }
}
