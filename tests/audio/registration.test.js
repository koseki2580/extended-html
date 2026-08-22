const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

const AUDIO_TAGS = [
  "audio-context",
  "audio-input-mic",
  "audio-input-file",
  "audio-biquad-filter",
  "audio-output",
];

const loadEntryInIsolatedRealm = async (entry, importLabels) => {
  const frame = document.createElement("iframe");
  document.body.append(frame);
  const realm = frame.contentWindow;
  const definitions = [];
  const originalDefine = realm.customElements.define.bind(realm.customElements);
  realm.customElements.define = (name, constructor, options) => {
    definitions.push(name);
    return originalDefine(name, constructor, options);
  };

  try {
    const importModule = realm.Function("url", "return import(url)");
    for (const label of importLabels) {
      const url = new URL(entry, import.meta.url);
      url.searchParams.set("registration", label);
      await importModule(url.href);
    }
    return {
      definitions,
      registered: (name) => typeof realm.customElements.get(name) === "function",
    };
  } finally {
    frame.remove();
  }
};

describe("Audio custom element registration", () => {
  it("registers only the five Audio tags once from the Audio entry", async () => {
    const result = await loadEntryInIsolatedRealm("../../src/audio/index.js", [
      "audio-first",
      "audio-repeat",
    ]);

    assertEqual(result.registered("web-socket"), false, "web-socket is untouched");
    assertEqual(
      result.definitions.filter((name) => AUDIO_TAGS.includes(name)).join(","),
      AUDIO_TAGS.join(","),
      "every Audio tag is defined exactly once",
    );
    for (const name of AUDIO_TAGS) {
      assert(result.registered(name), `${name} is registered`);
    }
  });

  it("registers WebSocket and every Audio tag once from the aggregate entry", async () => {
    const result = await loadEntryInIsolatedRealm("../../src/index.js", [
      "aggregate-first",
      "aggregate-repeat",
    ]);

    for (const name of ["web-socket", ...AUDIO_TAGS]) {
      assert(result.registered(name), `${name} is registered`);
      assertEqual(
        result.definitions.filter((definedName) => definedName === name).length,
        1,
        `${name} is defined once`,
      );
    }
  });

  it("publishes the Audio-only package subpath without changing existing exports", async () => {
    const response = await fetch(new URL("../../package.json", import.meta.url));
    assert(response.ok, "package.json is available to the browser test");
    const packageJson = await response.json();

    assertEqual(packageJson.exports["."], "./src/index.js", "root export");
    assertEqual(
      packageJson.exports["./web-socket"],
      "./src/web-socket/web-socket.js",
      "web-socket export",
    );
    assertEqual(
      packageJson.exports["./audio-context"],
      "./src/audio/index.js",
      "audio-context export",
    );
  });
});
