import { AudioStreamOutputElement } from "../../src/audio/audio-stream-output.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

if (!customElements.get("test-audio-stream-output")) {
  customElements.define("test-audio-stream-output", AudioStreamOutputElement);
}

describe("AudioStreamOutputElement", () => {
  it("creates a media-stream destination and exposes its stream after attachment", () => {
    const element = document.createElement("test-audio-stream-output");
    const stream = {};
    const destination = { stream };
    let calls = 0;
    const context = {
      createMediaStreamDestination() {
        calls += 1;
        return destination;
      },
    };

    assertEqual(element.stream, null, "stream is absent before graph creation");
    assertEqual(element._createAudioNode(context), destination, "native destination");
    element._attachAudioNode(destination);

    assertEqual(calls, 1, "destination is created once by the caller");
    assertEqual(element.stream, stream, "attached destination stream");
  });

  it("has no independent lifecycle work", async () => {
    const element = document.createElement("test-audio-stream-output");

    assertEqual(element._configureAudioNode(), undefined, "configuration no-op");
    assertEqual(await element._activate(), undefined, "activation no-op");
    assertEqual(await element._suspend(), undefined, "suspension no-op");
    assertEqual(await element._close(), undefined, "close no-op");
  });
});
