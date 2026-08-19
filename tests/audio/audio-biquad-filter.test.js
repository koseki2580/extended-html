import { AudioBiquadFilterElement } from "../../src/audio/audio-biquad-filter.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertThrows = (callback, name, message) => {
  try {
    callback();
  } catch (error) {
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return;
  }
  throw new Error("expected an error");
};

if (!customElements.get("test-audio-biquad-filter")) {
  customElements.define("test-audio-biquad-filter", AudioBiquadFilterElement);
}

const createElement = () => document.createElement("test-audio-biquad-filter");
const createNativeFilter = () => ({
  type: "lowpass",
  frequency: { value: 350 },
  detune: { value: 0 },
  Q: { value: 1 },
  gain: { value: 0 },
});

describe("AudioBiquadFilterElement", () => {
  it("exposes the standard Biquad defaults before native creation", () => {
    const element = createElement();

    assertEqual(element.type, "lowpass", "default type");
    for (const property of ["frequency", "detune", "Q", "gain"]) {
      assertThrows(
        () => element[property],
        "InvalidStateError",
        "Biquad filter is not created",
      );
    }
  });

  it("applies attributes at creation and exposes native AudioParams", () => {
    const element = createElement();
    const native = createNativeFilter();
    element.setAttribute("type", "highpass");
    element.setAttribute("frequency", "1200");
    element.setAttribute("detune", "-12.5");
    element.setAttribute("q", "2");
    element.setAttribute("gain", "4.25");

    const created = element._createAudioNode({ createBiquadFilter: () => native });

    assertEqual(created, native, "native filter result");
    assertEqual(element.type, "highpass", "type applied");
    assertEqual(native.frequency.value, 1200, "frequency applied");
    assertEqual(native.detune.value, -12.5, "detune applied");
    assertEqual(native.Q.value, 2, "Q applied");
    assertEqual(native.gain.value, 4.25, "gain applied");
    assertEqual(element.frequency, native.frequency, "frequency AudioParam");
    assertEqual(element.detune, native.detune, "detune AudioParam");
    assertEqual(element.Q, native.Q, "Q AudioParam");
    assertEqual(element.gain, native.gain, "gain AudioParam");
  });

  it("updates an existing native node when observed attributes change", () => {
    const element = createElement();
    const native = createNativeFilter();
    element._createAudioNode({ createBiquadFilter: () => native });

    element.type = "bandpass";
    element.setAttribute("frequency", "800");
    element.setAttribute("detune", "5");
    element.setAttribute("q", "0.75");
    element.setAttribute("gain", "-3");

    assertEqual(native.type, "bandpass", "live type");
    assertEqual(native.frequency.value, 800, "live frequency");
    assertEqual(native.detune.value, 5, "live detune");
    assertEqual(native.Q.value, 0.75, "live Q");
    assertEqual(native.gain.value, -3, "live gain");
  });

  it("restores standard defaults when live configuration attributes are removed", () => {
    const element = createElement();
    const native = createNativeFilter();
    element.setAttribute("type", "highpass");
    element.setAttribute("frequency", "900");
    element.setAttribute("detune", "8");
    element.setAttribute("q", "3");
    element.setAttribute("gain", "2");
    element._createAudioNode({ createBiquadFilter: () => native });

    for (const name of ["type", "frequency", "detune", "q", "gain"]) {
      element.removeAttribute(name);
    }

    assertEqual(native.type, "lowpass", "default type restored");
    assertEqual(native.frequency.value, 350, "default frequency restored");
    assertEqual(native.detune.value, 0, "default detune restored");
    assertEqual(native.Q.value, 1, "default Q restored");
    assertEqual(native.gain.value, 0, "default gain restored");
  });

  it("rejects unsupported types and non-finite numeric configuration", () => {
    const element = createElement();
    const native = createNativeFilter();
    const context = { createBiquadFilter: () => native };

    element.setAttribute("type", "not-a-filter");
    assertThrows(
      () => element._createAudioNode(context),
      "SyntaxError",
      'Unsupported Biquad filter type "not-a-filter"',
    );

    const invalidNumbers = ["", " ", "Infinity", "NaN", "12px", "0x10"];
    for (const value of invalidNumbers) {
      const candidate = createElement();
      candidate.setAttribute("frequency", value);
      assertThrows(
        () => candidate._createAudioNode({ createBiquadFilter: createNativeFilter }),
        "SyntaxError",
        `Biquad frequency must be a finite number, received "${value}"`,
      );
    }
  });
});
