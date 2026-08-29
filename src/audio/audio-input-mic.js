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
  static audioEventTypes = ["open", "close", "devicechange", "error"];
  static observedAttributes = [
    "device-id",
    "onopen",
    "onclose",
    "ondevicechange",
    "onerror",
  ];

  #nativeContext = null;
  #stream = null;
  #sourceNode = null;
  #activationPromise = null;
  #closePromise = null;
  #openDispatched = false;
  #closed = false;
  #committedDeviceId = "";
  #deviceChangePromise = Promise.resolve();
  #reflectingDeviceId = false;

  get deviceId() {
    return this.getAttribute("device-id") ?? "";
  }

  set deviceId(value) {
    this.setAttribute("device-id", String(value ?? ""));
  }

  setDeviceId(value) {
    if (this.#closed) return Promise.reject(closedError());
    this.deviceId = value;
    return this.#deviceChangePromise;
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (
      name !== "device-id" ||
      oldValue === newValue ||
      this.#reflectingDeviceId
    ) {
      return;
    }

    const owner = this._getAudioOwner();
    if (typeof owner?._setMicrophoneDevice !== "function") {
      this.#deviceChangePromise = Promise.resolve();
      return;
    }

    const requestedDeviceId = newValue ?? "";
    const operation = owner._setMicrophoneDevice(this, requestedDeviceId);
    this.#deviceChangePromise = operation;
    operation.catch(() => {
      // Do not let an older failed request overwrite a newer requested value.
      if (this.deviceId !== requestedDeviceId) return;
      this.#reflectDeviceId(this.#committedDeviceId);
    });
  }

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

  _hasActiveAudioDevice() {
    return this.#stream !== null && this.#sourceNode !== null;
  }

  async _createDeviceCandidate(context, deviceId) {
    let stream = null;
    let sourceNode = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: deviceId ? { deviceId: { exact: deviceId } } : true,
      });
      if (this.#closed) throw closedError();
      sourceNode = context.createMediaStreamSource(stream);
    } catch (error) {
      if (sourceNode !== null) sourceNode.disconnect();
      for (const track of stream?.getTracks() ?? []) track.stop();
      dispatchAudioEvent(this, "error", error, this._getAudioOwner());
      throw error;
    }

    const candidate = { deviceId, node: sourceNode, stream };
    return {
      node: sourceNode,
      setActive: (active) => {
        for (const track of candidate.stream.getTracks()) track.enabled = active;
      },
      commit: () => {
        const previous = {
          deviceId: this.#committedDeviceId,
          node: this.#sourceNode,
          stream: this.#stream,
        };
        this._detachAudioNode(this.#sourceNode);
        this._attachAudioNode(candidate.node);
        this.#sourceNode = candidate.node;
        this.#stream = candidate.stream;
        this.#committedDeviceId = candidate.deviceId;
        this.#openDispatched = true;
        return previous;
      },
      connected: (previous) => {
        dispatchAudioEvent(this, "open", candidate.stream, this._getAudioOwner());
        dispatchAudioEvent(
          this,
          "devicechange",
          {
            previousDeviceId: previous.deviceId,
            deviceId: candidate.deviceId,
            stream: candidate.stream,
          },
          this._getAudioOwner(),
        );
      },
      releasePrevious: (previous) => {
        for (const track of previous.stream?.getTracks() ?? []) track.stop();
        try {
          previous.node?.disconnect();
        } catch {
          // Runtime edge bookkeeping has already detached the previous node.
        }
      },
      rollback: () => {
        for (const track of candidate.stream.getTracks()) track.stop();
        try {
          candidate.node.disconnect();
        } catch {
          // Candidate rollback is best-effort after a failed native connection.
        }
      },
    };
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
    const deviceId = this.deviceId;
    let stream;
    try {
      const audio = deviceId ? { deviceId: { exact: deviceId } } : true;
      stream = await navigator.mediaDevices.getUserMedia({ audio });
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
      this.#committedDeviceId = deviceId;
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

  #reflectDeviceId(deviceId) {
    this.#reflectingDeviceId = true;
    try {
      this.setAttribute("device-id", deviceId);
    } finally {
      this.#reflectingDeviceId = false;
    }
  }
}
