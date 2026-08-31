import { AudioEventTargetElement, dispatchAudioEvent } from "./audio-event.js";

const syntaxError = (message) => new DOMException(message, "SyntaxError");

const unavailableError = () =>
  new DOMException("MediaRecorder API is not available", "NotSupportedError");

const inactiveError = () =>
  new DOMException("Media recorder is not active", "InvalidStateError");

const parseOptionalInteger = (element, name, { minimum, message }) => {
  if (!element.hasAttribute(name)) return null;
  const source = element.getAttribute(name)?.trim() ?? "";
  if (source === "") return null;
  if (!/^\d+$/.test(source)) throw syntaxError(message);
  const value = Number(source);
  if (!Number.isSafeInteger(value) || value < minimum) throw syntaxError(message);
  return value;
};

const RECORDER_EVENTS = [
  "start",
  "dataavailable",
  "pause",
  "resume",
  "stop",
  "error",
];

export class MediaRecorderElement extends AudioEventTargetElement {
  static audioEventTypes = RECORDER_EVENTS;
  static observedAttributes = RECORDER_EVENTS.map((type) => `on${type}`);

  #audioOwner = null;
  #recorder = null;
  #closePromise = null;
  #nativeListeners = new Map();

  get state() {
    return this.#recorder?.state ?? "inactive";
  }

  get mimeType() {
    return this.#recorder?.mimeType ?? this.getAttribute("mime-type") ?? "";
  }

  get stream() {
    return this.#recorder?.stream ?? null;
  }

  requestData() {
    if (this.#recorder === null || this.#recorder.state === "inactive") {
      throw inactiveError();
    }
    this.#recorder.requestData();
  }

  _setAudioOwner(owner) {
    if (owner === null || owner === undefined || owner === this.#audioOwner) return;
    if (this.#audioOwner !== null) {
      throw new DOMException(
        "Media recorder already belongs to a different audio context",
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

  _validateAudioConfiguration() {
    const Recorder = globalThis.MediaRecorder;
    if (typeof Recorder !== "function") throw unavailableError();

    const configuration = this.#configuration();
    if (
      configuration.mimeType &&
      typeof Recorder.isTypeSupported === "function" &&
      !Recorder.isTypeSupported(configuration.mimeType)
    ) {
      throw new DOMException(
        `MediaRecorder MIME type "${configuration.mimeType}" is not supported`,
        "NotSupportedError",
      );
    }
    return configuration;
  }

  async _activate(stream) {
    if (this.#closePromise !== null) await this.#closePromise;
    if (this.#recorder === null) this.#createRecorder(stream);
    if (this.#recorder.stream !== stream) {
      throw new DOMException(
        "Media recorder stream cannot change while it is active",
        "InvalidStateError",
      );
    }
    if (this.#recorder.state === "recording") return;
    if (this.#recorder.state === "paused") {
      this.#recorder.resume();
      return;
    }

    const { timeslice } = this.#configuration();
    if (timeslice === null) this.#recorder.start();
    else this.#recorder.start(timeslice);
  }

  async _suspend() {
    if (this.#recorder?.state === "recording") this.#recorder.pause();
  }

  _close() {
    if (this.#closePromise !== null) return this.#closePromise;
    const operation = this.#performClose();
    this.#closePromise = operation;
    operation.then(
      () => {
        if (this.#closePromise === operation) this.#closePromise = null;
      },
      () => {
        if (this.#closePromise === operation) this.#closePromise = null;
      },
    );
    return operation;
  }

  async _rollbackAudioCandidate() {
    await this._close();
  }

  #configuration() {
    const mimeType = this.getAttribute("mime-type")?.trim() ?? "";
    const audioBitsPerSecond = parseOptionalInteger(
      this,
      "audio-bits-per-second",
      {
        minimum: 1,
        message: "audio-bits-per-second must be a positive integer",
      },
    );
    const timeslice = parseOptionalInteger(this, "timeslice", {
      minimum: 0,
      message: "timeslice must be a non-negative integer",
    });
    return { mimeType, audioBitsPerSecond, timeslice };
  }

  #createRecorder(stream) {
    const Recorder = globalThis.MediaRecorder;
    const { mimeType, audioBitsPerSecond } = this._validateAudioConfiguration();
    const options = {};
    if (mimeType) options.mimeType = mimeType;
    if (audioBitsPerSecond !== null) {
      options.audioBitsPerSecond = audioBitsPerSecond;
    }
    this.#recorder = new Recorder(stream, options);
    for (const type of RECORDER_EVENTS) {
      const listener = (event) => this.#forwardNativeEvent(type, event);
      this.#nativeListeners.set(type, listener);
      this.#recorder.addEventListener(type, listener);
    }
  }

  #forwardNativeEvent(type, event) {
    if (type === "dataavailable") {
      dispatchAudioEvent(
        this,
        type,
        event.data,
        this.#audioOwner,
        { timecode: event.timecode ?? null },
      );
      return;
    }
    dispatchAudioEvent(this, type, event, this.#audioOwner);
  }

  async #performClose() {
    const recorder = this.#recorder;
    if (recorder === null) return;

    try {
      if (recorder.state !== "inactive") {
        const stopped = new Promise((resolve) => {
          recorder.addEventListener("stop", resolve, { once: true });
        });
        recorder.stop();
        await stopped;
      }
    } finally {
      for (const [type, listener] of this.#nativeListeners) {
        recorder.removeEventListener(type, listener);
      }
      this.#nativeListeners.clear();
      if (this.#recorder === recorder) this.#recorder = null;
    }
  }
}
