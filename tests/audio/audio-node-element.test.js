import {
  AudioNodeElement,
  AudioSourceElement,
} from "../../src/audio/audio-node-element.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const assertThrows = (callback, ErrorType, name, message) => {
  try {
    callback();
  } catch (error) {
    assert(error instanceof ErrorType, `expected ${ErrorType.name}`);
    assertEqual(error.name, name, "error name");
    assertEqual(error.message, message, "error message");
    return;
  }
  throw new Error("expected an error");
};

class TestAudioNodeElement extends AudioNodeElement {}
class TestAudioSourceElement extends AudioSourceElement {}

if (!customElements.get("test-audio-node-contract")) {
  customElements.define("test-audio-node-contract", TestAudioNodeElement);
}
if (!customElements.get("test-audio-source-contract")) {
  customElements.define("test-audio-source-contract", TestAudioSourceElement);
}

const createNodeElement = () => document.createElement("test-audio-node-contract");
const createSourceElement = () => document.createElement("test-audio-source-contract");

describe("AudioNodeElement", () => {
  it("reflects the to attribute without parsing graph targets", () => {
    const element = createNodeElement();

    assertEqual(element.to, null, "missing to attribute");
    element.to = 42;
    assertEqual(element.getAttribute("to"), "42", "to setter stringifies values");
    assertEqual(element.to, "42", "to getter reflects attribute");
    element.to = null;

    assertEqual(element.hasAttribute("to"), false, "null removes the attribute");
  });

  it("assigns an owner once, permits idempotence, and clears only its owner", () => {
    const element = createNodeElement();
    const owner = { id: "context-a" };
    const otherOwner = { id: "context-b" };

    element._setAudioOwner(owner);
    element._setAudioOwner(owner);
    assertEqual(element._getAudioOwner(), owner, "owner is retained");
    assertThrows(
      () => element._setAudioOwner(otherOwner),
      DOMException,
      "InvalidStateError",
      "Audio node already belongs to a different audio context",
    );
    element._setAudioOwner(null);
    assertEqual(element._getAudioOwner(), owner, "null assignment does not clear the owner");
    element._setAudioOwner(undefined);
    assertEqual(element._getAudioOwner(), owner, "undefined assignment does not change the owner");
    element._clearAudioOwner(otherOwner);
    assertEqual(element._getAudioOwner(), owner, "other owner cannot clear it");
    element._clearAudioOwner(owner);

    assertEqual(element._getAudioOwner(), null, "matching owner clears it");
  });

  it("requires an attached native node and protects it from replacement", () => {
    const element = createNodeElement();
    const node = {};
    const replacement = {};

    assertThrows(
      () => element._getAudioNode(),
      DOMException,
      "InvalidStateError",
      "Audio node is not attached",
    );
    assertThrows(
      () => element._attachAudioNode(null),
      TypeError,
      "TypeError",
      "Audio node must not be null or undefined",
    );
    assertThrows(
      () => element._attachAudioNode(undefined),
      TypeError,
      "TypeError",
      "Audio node must not be null or undefined",
    );
    element._attachAudioNode(node);
    element._attachAudioNode(node);
    assertEqual(element._getAudioNode(), node, "same native node is idempotent");
    assertThrows(
      () => element._attachAudioNode(replacement),
      DOMException,
      "InvalidStateError",
      "Audio node already has a different native node attached",
    );
    assertEqual(element._detachAudioNode(replacement), null, "other node cannot detach it");
    assertEqual(element._detachAudioNode(node), node, "matching node detaches");
    assertThrows(
      () => element._getAudioNode(),
      DOMException,
      "InvalidStateError",
      "Audio node is not attached",
    );
  });

  it("provides default node lifecycle hooks without creating native resources", async () => {
    const element = createNodeElement();

    assertThrows(
      () => element._createAudioNode(),
      DOMException,
      "NotSupportedError",
      "Audio node creation is not supported",
    );
    assertEqual(element._configureAudioNode(), undefined, "default configuration is a no-op");
    assertEqual(element._getAudioOwner(), null, "default hooks do not create an owner");
  });
});

describe("AudioSourceElement", () => {
  it("provides async no-op source lifecycle hooks", async () => {
    const element = createSourceElement();

    assertEqual(await element._activate(), undefined, "activate is a no-op");
    assertEqual(await element._connected(), undefined, "connection hook is a no-op");
    assertEqual(await element._suspend(), undefined, "suspend is a no-op");
    assertEqual(await element._close(), undefined, "close is a no-op");
  });
});
