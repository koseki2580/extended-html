import { AudioInputFileElement } from "../../src/audio/audio-input-file.js";

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

if (!customElements.get("test-audio-input-file")) {
  customElements.define("test-audio-input-file", AudioInputFileElement);
}

const createElement = () => document.createElement("test-audio-input-file");

describe("AudioInputFileElement", () => {
  it("reflects supported media attributes without exposing autoplay or controls", () => {
    const element = createElement();

    element.src = "/track.wav";
    element.loop = true;
    element.muted = true;
    element.preload = "metadata";
    element.crossOrigin = "anonymous";

    assertEqual(element.getAttribute("src"), "/track.wav", "src attribute");
    assertEqual(element.loop, true, "loop property");
    assertEqual(element.muted, true, "muted property");
    assertEqual(element.preload, "metadata", "preload property");
    assertEqual(element.getAttribute("crossorigin"), "anonymous", "crossorigin attribute");
    assertEqual(element.crossOrigin, "anonymous", "crossOrigin property");
    assertEqual("autoplay" in element, false, "autoplay is not exposed");
    assertEqual("controls" in element, false, "controls are not exposed");

    element.loop = false;
    element.muted = false;
    element.crossOrigin = null;
    assertEqual(element.hasAttribute("loop"), false, "false loop removes attribute");
    assertEqual(element.hasAttribute("muted"), false, "false muted removes attribute");
    assertEqual(element.hasAttribute("crossorigin"), false, "null crossorigin removes attribute");
  });

  it("proxies writable and read-only media properties", () => {
    const element = createElement();
    const media = element._getMediaElement();

    element.volume = 0.25;
    element.currentTime = 3;
    element.playbackRate = 1.5;

    assertEqual(media.volume, 0.25, "volume reaches owned media");
    assertEqual(element.volume, 0.25, "volume reads from owned media");
    assertEqual(media.currentTime, 3, "currentTime reaches owned media");
    assertEqual(element.currentTime, 3, "currentTime reads from owned media");
    assertEqual(media.playbackRate, 1.5, "playbackRate reaches owned media");
    assertEqual(element.playbackRate, 1.5, "playbackRate reads from owned media");
    assertEqual(element.duration, media.duration, "duration is proxied");
    assertEqual(element.paused, media.paused, "paused is proxied");
    assertEqual(element.ended, media.ended, "ended is proxied");
    assertEqual(element.readyState, media.readyState, "readyState is proxied");
  });

  it("delegates play, pause, and load to the owned media element", async () => {
    const element = createElement();
    const media = element._getMediaElement();
    const calls = [];
    const playResult = Promise.resolve("playing");
    media.play = () => {
      calls.push("play");
      return playResult;
    };
    media.pause = () => calls.push("pause");
    media.load = () => calls.push("load");

    assertEqual(element.play(), playResult, "play returns the native promise");
    element.pause();
    element.load();
    await playResult;

    assertEqual(calls.join(","), "play,pause,load", "method order");
  });

  it("uses the owned media methods for source lifecycle hooks", async () => {
    const element = createElement();
    const media = element._getMediaElement();
    const calls = [];
    media.play = async () => calls.push("play");
    media.pause = () => calls.push("pause");

    await element._activate();
    await element._suspend();
    await element._close();

    assertEqual(calls.join(","), "play,pause,pause", "source lifecycle order");
  });

  it("redispatches media events with the audio event envelope", () => {
    const element = createElement();
    element.id = "music";
    element._setAudioOwner({ id: "audio" });
    const nativeEvent = new Event("play");
    let received;
    element.addEventListener("play", (event) => {
      received = event;
    });

    element._getMediaElement().dispatchEvent(nativeEvent);

    assertEqual(received.detail.data, nativeEvent, "native event is wrapped as data");
    assertEqual(received.detail.metadata.contextId, "audio", "context metadata");
    assertEqual(received.detail.metadata.nodeId, "music", "node metadata");
    assertEqual(received.detail.metadata.nodeName, "test-audio-input-file", "tag metadata");
  });

  it("creates at most one media source for each native context", () => {
    const element = createElement();
    let creations = 0;
    const source = {};
    const context = {
      createMediaElementSource(media) {
        creations += 1;
        assertEqual(media, element._getMediaElement(), "owned media is connected");
        return source;
      },
    };

    assertEqual(element._createAudioNode(context), source, "first source");
    assertEqual(element._createAudioNode(context), source, "cached source");
    assertEqual(creations, 1, "native source is created once");
  });

  it("rejects reuse with a different native context", () => {
    const element = createElement();
    const firstSource = {};
    const firstContext = { createMediaElementSource: () => firstSource };
    let secondCreations = 0;
    const secondContext = {
      createMediaElementSource() {
        secondCreations += 1;
        return {};
      },
    };

    assertEqual(element._createAudioNode(firstContext), firstSource, "first context source");
    assertThrows(
      () => element._createAudioNode(secondContext),
      "InvalidStateError",
      "File input already belongs to a different AudioContext",
    );
    assertEqual(secondCreations, 0, "second context never receives the media element");
  });

  it("guards the native one-media-source constraint across real AudioContexts", async () => {
    const element = createElement();
    const firstContext = new AudioContext();
    const secondContext = new AudioContext();

    try {
      const source = element._createAudioNode(firstContext);
      assertEqual(element._createAudioNode(firstContext), source, "native source is reused");
      assertThrows(
        () => element._createAudioNode(secondContext),
        "InvalidStateError",
        "File input already belongs to a different AudioContext",
      );
    } finally {
      await Promise.all([firstContext.close(), secondContext.close()]);
    }
  });
});
