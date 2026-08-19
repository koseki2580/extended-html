import { AudioNodeElement } from "./audio-node-element.js";

const FILTER_TYPES = new Set([
  "lowpass",
  "highpass",
  "bandpass",
  "lowshelf",
  "highshelf",
  "peaking",
  "notch",
  "allpass",
]);

const PARAMETER_ATTRIBUTES = new Map([
  ["frequency", "frequency"],
  ["detune", "detune"],
  ["q", "Q"],
  ["gain", "gain"],
]);

const DEFAULT_VALUES = new Map([
  ["frequency", 350],
  ["detune", 0],
  ["q", 1],
  ["gain", 0],
]);

const FINITE_NUMBER_PATTERN = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;

const syntaxError = (message) => new DOMException(message, "SyntaxError");

const parseFiniteNumber = (name, value) => {
  if (!FINITE_NUMBER_PATTERN.test(value.trim())) {
    throw syntaxError(`Biquad ${name} must be a finite number, received "${value}"`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw syntaxError(`Biquad ${name} must be a finite number, received "${value}"`);
  }
  return number;
};

const validateType = (value) => {
  if (!FILTER_TYPES.has(value)) {
    throw syntaxError(`Unsupported Biquad filter type "${value}"`);
  }
  return value;
};

export class AudioBiquadFilterElement extends AudioNodeElement {
  static observedAttributes = ["type", ...PARAMETER_ATTRIBUTES.keys()];

  #filterNode = null;

  attributeChangedCallback(name, oldValue, newValue) {
    super.attributeChangedCallback(name, oldValue, newValue);
    if (oldValue === newValue || this.#filterNode === null) return;

    if (name === "type") {
      this.#filterNode.type = newValue === null ? "lowpass" : validateType(newValue);
      return;
    }
    const parameterName = PARAMETER_ATTRIBUTES.get(name);
    if (parameterName) {
      this.#filterNode[parameterName].value =
        newValue === null ? DEFAULT_VALUES.get(name) : parseFiniteNumber(name, newValue);
    }
  }

  get type() {
    return this.#filterNode?.type ?? this.getAttribute("type") ?? "lowpass";
  }

  set type(value) {
    this.setAttribute("type", validateType(String(value)));
  }

  get frequency() {
    return this.#getParameter("frequency");
  }

  get detune() {
    return this.#getParameter("detune");
  }

  get Q() {
    return this.#getParameter("Q");
  }

  get gain() {
    return this.#getParameter("gain");
  }

  _createAudioNode(context) {
    if (this.#filterNode !== null) return this.#filterNode;

    const configuration = this.#readConfiguration();
    const filterNode = context.createBiquadFilter();
    this.#filterNode = filterNode;
    this._configureAudioNode(filterNode, configuration);
    return filterNode;
  }

  _configureAudioNode(node = this.#filterNode, configuration = this.#readConfiguration()) {
    if (node === null) return;
    node.type = configuration.type;
    for (const [name, value] of configuration.parameters) {
      node[PARAMETER_ATTRIBUTES.get(name)].value = value;
    }
  }

  #readConfiguration() {
    const typeValue = this.getAttribute("type");
    const type = typeValue === null ? "lowpass" : validateType(typeValue);
    const parameters = [];
    for (const name of PARAMETER_ATTRIBUTES.keys()) {
      const value = this.getAttribute(name);
      if (value !== null) parameters.push([name, parseFiniteNumber(name, value)]);
    }
    return { type, parameters };
  }

  #getParameter(name) {
    if (this.#filterNode === null) {
      throw new DOMException("Biquad filter is not created", "InvalidStateError");
    }
    return this.#filterNode[name];
  }
}
