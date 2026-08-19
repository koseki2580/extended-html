import { dispatchAudioEvent } from "./audio-event.js";
import { AudioSourceElement } from "./audio-node-element.js";

const MEDIA_ATTRIBUTES = ["src", "loop", "muted", "preload", "crossorigin"];
const MEDIA_EVENT_TYPES = [
  "abort",
  "canplay",
  "canplaythrough",
  "durationchange",
  "emptied",
  "ended",
  "error",
  "loadeddata",
  "loadedmetadata",
  "loadstart",
  "pause",
  "play",
  "playing",
  "progress",
  "ratechange",
  "seeked",
  "seeking",
  "stalled",
  "suspend",
  "timeupdate",
  "volumechange",
  "waiting",
];

const reflectBoolean = (element, name, value) => {
  if (value) element.setAttribute(name, "");
  else element.removeAttribute(name);
};

export class AudioInputFileElement extends AudioSourceElement {
  static audioEventTypes = MEDIA_EVENT_TYPES;
  static observedAttributes = [
    ...MEDIA_ATTRIBUTES,
    ...MEDIA_EVENT_TYPES.map((type) => `on${type}`),
  ];

  #mediaElement;
  #nativeContext = null;
  #sourceNode = null;

  constructor() {
    super();
    this.#mediaElement = new Audio();
    // Playback is always explicit and the media element remains an internal resource.
    this.#mediaElement.autoplay = false;
    this.#mediaElement.controls = false;
    for (const type of MEDIA_EVENT_TYPES) {
      this.#mediaElement.addEventListener(type, (event) => {
        dispatchAudioEvent(this, type, event, this._getAudioOwner());
      });
    }
  }

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (oldValue === newValue || name.startsWith("on")) return;

    if (name === "loop" || name === "muted") {
      this.#mediaElement[name] = newValue !== null;
      return;
    }
    if (name === "crossorigin") {
      this.#mediaElement.crossOrigin = newValue;
      return;
    }
    this.#mediaElement[name] = newValue ?? "";
  }

  get src() {
    return this.#mediaElement.src;
  }

  set src(value) {
    this.setAttribute("src", String(value));
  }

  get loop() {
    return this.hasAttribute("loop");
  }

  set loop(value) {
    reflectBoolean(this, "loop", value);
  }

  get muted() {
    return this.hasAttribute("muted");
  }

  set muted(value) {
    reflectBoolean(this, "muted", value);
  }

  get preload() {
    return this.#mediaElement.preload;
  }

  set preload(value) {
    this.setAttribute("preload", String(value));
  }

  get crossOrigin() {
    return this.#mediaElement.crossOrigin;
  }

  set crossOrigin(value) {
    if (value === null) this.removeAttribute("crossorigin");
    else this.setAttribute("crossorigin", String(value));
  }

  get volume() {
    return this.#mediaElement.volume;
  }

  set volume(value) {
    this.#mediaElement.volume = value;
  }

  get currentTime() {
    return this.#mediaElement.currentTime;
  }

  set currentTime(value) {
    this.#mediaElement.currentTime = value;
  }

  get playbackRate() {
    return this.#mediaElement.playbackRate;
  }

  set playbackRate(value) {
    this.#mediaElement.playbackRate = value;
  }

  get duration() {
    return this.#mediaElement.duration;
  }

  get paused() {
    return this.#mediaElement.paused;
  }

  get ended() {
    return this.#mediaElement.ended;
  }

  get readyState() {
    return this.#mediaElement.readyState;
  }

  play() {
    return this.#mediaElement.play();
  }

  pause() {
    return this.#mediaElement.pause();
  }

  load() {
    return this.#mediaElement.load();
  }

  _getMediaElement() {
    return this.#mediaElement;
  }

  _createAudioNode(context) {
    if (this.#sourceNode !== null) {
      if (context !== this.#nativeContext) {
        throw new DOMException(
          "File input already belongs to a different AudioContext",
          "InvalidStateError",
        );
      }
      return this.#sourceNode;
    }

    const sourceNode = context.createMediaElementSource(this.#mediaElement);
    this.#nativeContext = context;
    this.#sourceNode = sourceNode;
    return sourceNode;
  }

  async _activate() {
    await this.play();
  }

  async _suspend() {
    this.pause();
  }

  async _close() {
    this.pause();
  }
}
