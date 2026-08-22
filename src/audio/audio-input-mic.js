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
  #closePromise = null;
  #openDispatched = false;
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

  async _connected() {
    if (this.#closed) throw closedError();
    if (this.#stream === null || this.#sourceNode === null) {
      throw new DOMException("Microphone input is not ready", "InvalidStateError");
    }
    if (this.#openDispatched) return;

    this.#openDispatched = true;
    dispatchAudioEvent(this, "open", this.#stream, this._getAudioOwner());
  }

  async _suspend() {
    if (this.#activationPromise !== null) await this.#activationPromise;
    for (const track of this.#stream?.getTracks() ?? []) {
      track.enabled = false;
    }
  }

  async _rollbackAudioCandidate() {
    if (this.#activationPromise !== null) {
      try {
        await this.#activationPromise;
      } catch {
        // Acquisition failures have no provisional stream left to release.
      }
    }

    for (const track of this.#stream?.getTracks() ?? []) track.stop();
    this.#releaseSource();
    this.#stream = null;
    this.#openDispatched = false;
  }

  _close() {
    if (this.#closePromise === null) {
      this.#closed = true;
      // Deferring cleanup assigns the shared promise before close listeners can re-enter.
      this.#closePromise = Promise.resolve().then(() => this.#finishClose());
    }
    return this.#closePromise;
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
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (error) {
      dispatchAudioEvent(this, "error", error, this._getAudioOwner());
      throw error;
    }

    this.#stream = stream;
    this.#openDispatched = false;
    if (this.#closed) throw closedError();

    let sourceNode = null;
    try {
      sourceNode = context.createMediaStreamSource(stream);
      this.#sourceNode = sourceNode;
      this._attachAudioNode(sourceNode);
    } catch (error) {
      if (sourceNode !== null) sourceNode.disconnect();
      for (const track of stream.getTracks()) track.stop();
      if (this.#sourceNode === sourceNode) this.#sourceNode = null;
      if (this.#stream === stream) this.#stream = null;
      this._detachAudioNode(sourceNode);
      dispatchAudioEvent(this, "error", error, this._getAudioOwner());
      throw error;
    }
  }

  async #finishClose() {
    // A pending request may still produce a stream, which must be released here.
    if (this.#activationPromise !== null) {
      try {
        await this.#activationPromise;
      } catch {
        // Acquisition failures already report errors to their caller and event listeners.
      }
    }

    const stream = this.#stream;
    for (const track of stream?.getTracks() ?? []) track.stop();
    this.#releaseSource();
    this.#stream = null;
    dispatchAudioEvent(this, "close", stream, this._getAudioOwner());
  }

  #releaseSource() {
    if (this.#sourceNode === null) return;
    this.#sourceNode.disconnect();
    this._detachAudioNode(this.#sourceNode);
    this.#sourceNode = null;
  }
}
