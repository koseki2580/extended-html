import { AudioOutputElement } from "../../src/audio/audio-output.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

if (!customElements.get("test-audio-output")) {
  customElements.define("test-audio-output", AudioOutputElement);
}

describe("AudioOutputElement", () => {
  it("resolves the owning native context destination", () => {
    const element = document.createElement("test-audio-output");
    const destination = {};

    assertEqual(
      element._createAudioNode({ destination }),
      destination,
      "context destination",
    );
  });

  it("has no independent lifecycle work", async () => {
    const element = document.createElement("test-audio-output");

    assertEqual(element._configureAudioNode(), undefined, "configuration no-op");
    assertEqual(await element._activate(), undefined, "activation no-op");
    assertEqual(await element._suspend(), undefined, "suspension no-op");
    assertEqual(await element._close(), undefined, "close no-op");
  });
});
