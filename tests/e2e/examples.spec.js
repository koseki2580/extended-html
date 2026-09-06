import { test, expect } from "@playwright/test";
import { startTestServer } from "./support/test-server.js";

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.stop();
});

const watchPageErrors = (page) => {
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
};

test("root offers both user guides and the interactive examples", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(server.httpUrl);

  await expect(page).toHaveURL(/\/$/);
  await expect(
    page.getByRole("heading", { name: "Choose your guide" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "English User Guide" })).toHaveAttribute(
    "href",
    "./guide/en/",
  );
  await expect(page.getByRole("link", { name: "日本語ユーザーガイド" })).toHaveAttribute(
    "href",
    "./guide/ja/",
  );
  await expect(page.getByRole("link", { name: "Interactive examples" })).toHaveAttribute(
    "href",
    "./examples/",
  );
  expect(errors).toEqual([]);
});

const guideSections = [
  "getting-started",
  "connection",
  "events",
  "methods",
  "worker",
  "fallback",
  "reconnect",
  "api",
  "examples",
  "audio-context",
  "event-source",
];

for (const guide of [
  {
    language: "English",
    path: "guide/en/",
    lang: "en",
    heading: "Use browser APIs from HTML",
    translation: "日本語で読む",
    translationPath: "../ja/",
    examples: "Interactive examples",
    recipeLabel: "copyable recipes",
  },
  {
    language: "Japanese",
    path: "guide/ja/",
    lang: "ja",
    heading: "ブラウザAPIをHTMLで使う",
    translation: "Read in English",
    translationPath: "../en/",
    examples: "動作するサンプル",
    recipeLabel: "コピーできるレシピ",
  },
]) {
  test(`${guide.language} guide exposes the complete localized user journey`, async ({
    page,
  }) => {
    const errors = watchPageErrors(page);
    await page.goto(`${server.httpUrl}/${guide.path}`);

    await expect(page.locator("html")).toHaveAttribute("lang", guide.lang);
    await expect(page.getByRole("heading", { name: guide.heading })).toBeVisible();
    await expect(page.getByRole("link", { name: guide.translation })).toHaveAttribute(
      "href",
      guide.translationPath,
    );
    await expect(
      page
        .getByRole("navigation", {
          name: guide.lang === "en" ? "User Guide" : "ユーザーガイド",
        })
        .getByRole("link", { name: guide.examples }),
    ).toHaveAttribute("href", "../../examples/");
    for (const section of guideSections) {
      await expect(page.locator(`#${section}`)).toBeVisible();
    }
    const audioGuide = page.locator("#audio-context");
    await expect(audioGuide).toContainText("audio-context");
    await expect(audioGuide).toContainText("event.detail.data");
    await expect(audioGuide).toContainText("resume()");
    await expect(audioGuide).toContainText("suspend()");
    await expect(audioGuide).toContainText("close()");
    await expect(audioGuide).toContainText("device-id");
    await expect(audioGuide).toContainText("sink-id");
    await expect(audioGuide).toContainText("setDeviceId()");
    await expect(audioGuide).toContainText("setSinkId()");
    await expect(audioGuide).toContainText("devicechange");
    await expect(audioGuide).toContainText("sinkchange");
    await expect(audioGuide).toContainText("audio-stream-output");
    await expect(audioGuide).toContainText("media-recorder");
    await expect(audioGuide).toContainText("dataavailable");
    await expect(audioGuide).toContainText("requestData()");
    await expect(audioGuide).toContainText("timecode");
    await expect(audioGuide).toContainText(guide.recipeLabel);
    await expect(audioGuide).toContainText("MediaStream");
    await expect(audioGuide).toContainText("getAudioTracks()");
    await expect(audioGuide).toContainText("AudioWorklet");
    await expect(audioGuide).toContainText("OfflineAudioContext");
    await expect(audioGuide.getByRole("link", { name: /Audio/ })).toHaveAttribute(
      "href",
      "../../examples/audio-context/",
    );
    for (const path of [
      "microphone.html",
      "file-filter.html",
      "media-stream.html",
    ]) {
      await expect(
        audioGuide.locator(`a[href="../../examples/audio-context/${path}"]`),
      ).toHaveCount(1);
    }
    const eventSourceGuide = page.locator("#event-source");
    await expect(eventSourceGuide).toContainText("event-source");
    await expect(eventSourceGuide).toContainText("event.detail.data");
    await expect(eventSourceGuide).toContainText("Last-Event-ID");
    await expect(eventSourceGuide).toContainText("background");
    await expect(eventSourceGuide).toContainText("fallback");
    const apiReference = await page.locator("#api").innerText();
    for (const apiName of [
      "open()",
      "send(data)",
      "close()",
      "onopen",
      "onmessage",
      "onerror",
      "onclose",
    ]) {
      expect(apiReference).toContain(apiName);
    }
    expect(errors).toEqual([]);
  });
}

test("examples link back to both localized user guides", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/`);

  const navigation = page.getByRole("navigation", { name: "Examples" });
  await expect(
    navigation.getByRole("link", { name: "English User Guide" }),
  ).toHaveAttribute("href", /\/guide\/en\/$/);
  await expect(
    navigation.getByRole("link", { name: "日本語ユーザーガイド" }),
  ).toHaveAttribute("href", /\/guide\/ja\/$/);
});

const eventSourceExamples = [
  {
    label: "EventSource: Main",
    cardHeading: "EventSource / Main",
    path: "event-source/",
    pageId: "event-source-main",
    heading: "Stream events with one tag.",
  },
  {
    label: "EventSource: Worker",
    cardHeading: "EventSource / Worker",
    path: "event-source/background.html",
    pageId: "event-source-worker",
    heading: "Same events. Background stream.",
  },
];

test("overview and sidebar expose runnable EventSource samples", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/`);
  const navigation = page.getByRole("navigation", { name: "Examples" });

  for (const example of eventSourceExamples) {
    await expect(navigation.getByRole("link", { name: example.label })).toHaveAttribute(
      "href",
      new RegExp(`/examples/${example.path.replace(".", "\\.")}$`),
    );
    await expect(
      page.locator(".example-card").filter({ hasText: example.cardHeading }),
    ).toHaveAttribute("href", `./${example.path}`);
  }
});

for (const example of eventSourceExamples) {
  test(`${example.label} is independently runnable`, async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto(`${server.httpUrl}/examples/${example.path}`);

    await expect(page.locator("body")).toHaveAttribute("data-page", example.pageId);
    await expect(page.getByRole("heading", { name: example.heading })).toBeVisible();
    await expect(page.locator("event-source#source")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Open connection" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close connection" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Examples" }).getByRole("link", {
        name: example.label,
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });

  test(`${example.label} sample receives a real server event`, async ({ page }) => {
    const endpoint = encodeURIComponent(server.sseUrl);
    const connectionPromise = server.waitForEventSource();
    await page.goto(`${server.httpUrl}/examples/${example.path}?endpoint=${endpoint}`);
    await page.getByRole("button", { name: "Open connection" }).click();
    const connection = await connectionPromise;
    await expect(page.getByTestId("connection-state")).toHaveText("Open");

    server.sendEvent(connection, { data: "sample payload", id: "sample-1" });

    await expect(page.getByTestId("event-log").locator("li").first()).toContainText(
      "sample payload",
    );
    await expect(page.getByTestId("event-log").locator("li").first()).toContainText(
      "sample-1",
    );
  });
}

const focusedAudioExamples = [
  {
    label: "Audio: Microphone",
    path: "audio-context/microphone.html",
    pageId: "audio-microphone",
    heading: "Monitor a microphone.",
  },
  {
    label: "Audio: File filter",
    path: "audio-context/file-filter.html",
    pageId: "audio-file-filter",
    heading: "Filter a generated tone.",
  },
  {
    label: "Audio: MediaStream",
    path: "audio-context/media-stream.html",
    pageId: "audio-media-stream",
    heading: "Use the native MediaStream.",
  },
];

test("overview and sidebar expose focused runnable Audio samples", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/`);

  const navigation = page.getByRole("navigation", { name: "Examples" });
  for (const example of focusedAudioExamples) {
    await expect(navigation.getByRole("link", { name: example.label })).toHaveAttribute(
      "href",
      new RegExp(`/examples/${example.path.replace(".", "\\.")}$`),
    );
    await expect(
      page.locator(".example-card").filter({ hasText: example.label }),
    ).toHaveAttribute("href", `./${example.path}`);
  }
});

for (const example of focusedAudioExamples) {
  test(`${example.label} is an independently runnable graph`, async ({ page }) => {
    const errors = watchPageErrors(page);
    await page.goto(`${server.httpUrl}/examples/${example.path}`);

    await expect(page.locator("body")).toHaveAttribute("data-page", example.pageId);
    await expect(page.getByRole("heading", { name: example.heading })).toBeVisible();
    await expect(page.locator("audio-context#audio")).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Start audio" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close audio" })).toBeVisible();
    await expect(
      page.getByRole("navigation", { name: "Examples" }).getByRole("link", {
        name: example.label,
      }),
    ).toHaveAttribute("aria-current", "page");
    expect(errors).toEqual([]);
  });
}

test("focused MediaStream sample exposes tracks to a standard media element", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/media-stream.html`);

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await expect(page.getByTestId("stream-state")).toContainText("MediaStream");
  await expect(page.getByTestId("stream-state")).toContainText("audio track");
  expect(
    await page.locator("audio#preview").evaluate((element) => ({
      muted: element.muted,
      hasStream: element.srcObject instanceof MediaStream,
    })),
  ).toEqual({ muted: true, hasStream: true });

  await page.getByRole("button", { name: "Request data" }).click();
  await expect(page.getByTestId("chunk-count")).not.toHaveText("0");
  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(page.getByRole("link", { name: "Download recording" })).toBeVisible();
  expect(errors).toEqual([]);
});

test("focused microphone and file samples run through the context lifecycle", async ({
  page,
}) => {
  for (const path of ["microphone.html", "file-filter.html"]) {
    await page.goto(`${server.httpUrl}/examples/audio-context/${path}`);
    await page.getByRole("button", { name: "Start audio" }).click();
    await expect(page.getByTestId("audio-state")).toHaveText("Running");

    await page.locator("#frequency").fill("800");
    await expect(page.locator("audio-biquad-filter")).toHaveAttribute(
      "frequency",
      "800",
    );
    await page.getByRole("button", { name: "Suspend audio" }).click();
    await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
    await page.getByRole("button", { name: "Resume audio" }).click();
    await expect(page.getByTestId("audio-state")).toHaveText("Running");
    await page.getByRole("button", { name: "Close audio" }).click();
    await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  }
});

test("examples overview and sidebar navigate to the Audio example", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/`);

  const audioCard = page.locator(".example-card").filter({ hasText: "Audio graph" });
  await expect(audioCard).toHaveAttribute("href", "./audio-context/");
  await audioCard.click();

  await expect(page).toHaveURL(/\/examples\/audio-context\/$/);
  await expect(page.getByRole("heading", { name: "Build one audio graph." })).toBeVisible();
  await expect(
    page.getByRole("note").filter({ hasText: "Listening safety" }),
  ).toContainText("Use headphones or keep speaker volume low");
  const skipLink = page.getByRole("link", { name: "Skip to audio example" });
  await expect(skipLink).toHaveAttribute("href", "#main-content");
  await page.keyboard.press("Tab");
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/#main-content$/);
  await expect(page.locator("#main-content")).toBeFocused();
  const navigation = page.getByRole("navigation", { name: "Examples" });
  await expect(navigation.getByRole("link", { name: "Audio graph" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(errors).toEqual([]);
});

test("Audio recipe library covers graph, recording, and MediaStream patterns", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);

  const recipes = page.locator("[data-recipe]");
  await expect(recipes).toHaveCount(8);
  expect(await recipes.evaluateAll((nodes) => nodes.map((node) => node.dataset.recipe))).toEqual([
    "mic-monitor",
    "file-recording",
    "monitor-record",
    "mixed-recording",
    "declarative-events",
    "collect-download",
    "media-stream-access",
    "media-stream-webrtc",
  ]);

  const recipeText = await recipes.allInnerTexts();
  expect(recipeText.join("\n")).toContain('<audio-input-mic id="mic">');
  expect(recipeText.join("\n")).toContain('to="speaker recording-output"');
  expect(recipeText.join("\n")).toContain('ondataavailable="HandleChunk(event)"');
  expect(recipeText.join("\n")).toContain("event.detail.data");
  expect(recipeText.join("\n")).toContain("recorder.requestData()");
  expect(recipeText.join("\n")).toContain("new Blob(chunks");
  expect(recipeText.join("\n")).toContain("streamOutput.stream");
  expect(recipeText.join("\n")).toContain("stream.getAudioTracks()");
  expect(recipeText.join("\n")).toContain("peerConnection.addTrack(track, stream)");

  for (const recipe of recipeText.filter((text) =>
    text.includes("<audio-stream-output"),
  )) {
    expect(recipe).toContain("<media-recorder");
  }
  expect(errors).toEqual([]);
});

test("Audio example starts and controls every source through its context", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);

  const context = page.locator("audio-context#audio");
  const mic = context.locator(":scope > audio-input-mic#mic");
  const micFilter = mic.locator(":scope > audio-biquad-filter#mic-filter");
  await expect(micFilter).toHaveAttribute("type", "highpass");
  await expect(micFilter.locator(":scope > audio-output#speaker")).toHaveCount(1);
  const streamOutput = micFilter.locator(
    ":scope > audio-stream-output#recording-output",
  );
  await expect(streamOutput).toHaveCount(1);
  await expect(
    streamOutput.locator(":scope > media-recorder#recorder"),
  ).toHaveCount(1);
  const fileFilter = context.locator(
    ":scope > audio-input-file#music > audio-biquad-filter#file-filter",
  );
  await expect(fileFilter).toHaveAttribute("type", "lowpass");
  await expect(fileFilter).toHaveAttribute("to", "speaker recording-output");
  await expect(page.getByRole("combobox", { name: "Input microphone" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Output speaker" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "Microphone filter type" })).toBeVisible();
  await expect(page.getByRole("combobox", { name: "File filter type" })).toBeVisible();
  await expect(context).not.toHaveAttribute("auto", "");
  await expect(context.locator("audio-input-file")).not.toHaveAttribute(
    "autoplay",
    "",
  );

  const sourceCode = await page.evaluate(async () =>
    fetch("../assets/audio-context-example.js").then((response) => response.text()),
  );
  expect(sourceCode).not.toMatch(/\b(?:mic|music|file)\.(?:open|play|close)\s*\(/);
  expect(sourceCode).not.toMatch(
    /\brecorder\.(?:start|stop|pause|resume)\s*\(/,
  );

  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByRole("button", { name: "Start audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close audio" })).toBeEnabled();
  await expect(page.getByTestId("recording-state")).toHaveText("Inactive");
  await expect(page.getByRole("link", { name: "Download recording" })).toBeHidden();

  await page.evaluate(() => {
    const audio = document.querySelector("audio-context");
    const resume = audio.resume.bind(audio);
    globalThis.exampleResumeCalls = 0;
    globalThis.exampleResumeGate = new Promise((resolve) => {
      globalThis.releaseExampleResume = resolve;
    });
    audio.resume = (...args) => {
      globalThis.exampleResumeCalls += 1;
      const operation = resume(...args);
      return Promise.all([operation, globalThis.exampleResumeGate]);
    };
  });
  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByRole("group", { name: "Audio lifecycle" })).toHaveAttribute(
    "aria-busy",
    "true",
  );
  for (const name of ["Start audio", "Suspend audio", "Resume audio", "Close audio"]) {
    await expect(page.getByRole("button", { name })).toBeDisabled();
  }
  await page.evaluate(() => globalThis.releaseExampleResume());
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await expect.poll(() => page.evaluate(() => globalThis.exampleResumeCalls)).toBe(1);
  await expect(page.getByTestId("event-log")).toContainText("mic · open");
  await expect(page.getByTestId("event-log")).toContainText("music · play");
  await expect(page.getByTestId("event-log")).toContainText('"nodeName":"audio-input-mic"');
  await expect(page.getByTestId("event-log")).toContainText('"data"');
  await expect(page.getByTestId("event-log")).toContainText("recorder · start");
  await expect(page.getByTestId("recording-state")).toHaveText("Recording");

  await page.getByRole("button", { name: "Suspend audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByTestId("recording-state")).toHaveText("Paused");
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeEnabled();

  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await expect(page.getByTestId("recording-state")).toHaveText("Recording");
  await expect.poll(() => page.evaluate(() => globalThis.exampleResumeCalls)).toBe(2);

  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  await expect(page.getByTestId("event-log")).toContainText("mic · close");
  await expect(page.getByTestId("event-log")).toContainText("recorder · stop");
  await expect(page.getByTestId("recording-state")).toHaveText("Inactive");
  await expect(page.getByRole("link", { name: "Download recording" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Download recording" })).toHaveAttribute(
    "href",
    /^blob:/,
  );
  await expect(page.getByRole("button", { name: "Start audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close audio" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Audio example selects devices without automatic hot-plug fallback and edits each branch", async ({
  page,
}) => {
  await page.addInitScript(() => {
    globalThis.exampleDevices = [
      { kind: "audioinput", deviceId: "usb-mic", label: "USB microphone" },
      { kind: "audiooutput", deviceId: "desk-speaker", label: "Desk speaker" },
    ];
    Object.defineProperty(navigator.mediaDevices, "enumerateDevices", {
      configurable: true,
      value: async () => globalThis.exampleDevices.map((device) => ({ ...device })),
    });
    Object.defineProperty(navigator.mediaDevices, "selectAudioOutput", {
      configurable: true,
      value: async () => ({
        kind: "audiooutput",
        deviceId: "headphones",
        label: "Headphones",
      }),
    });
    const NativeContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
    if (typeof NativeContext.prototype.setSinkId !== "function") {
      Object.defineProperty(NativeContext.prototype, "setSinkId", {
        configurable: true,
        value: async () => {},
      });
    }
  });
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);
  await page.evaluate(() => {
    const context = document.querySelector("audio-context");
    const mic = document.querySelector("audio-input-mic");
    globalThis.exampleMicSelections = [];
    globalThis.exampleSinkSelections = [];
    mic.setDeviceId = async (deviceId) => {
      globalThis.exampleMicSelections.push(deviceId);
      mic.setAttribute("device-id", deviceId);
    };
    context.setSinkId = async (sinkId) => {
      globalThis.exampleSinkSelections.push(sinkId);
      context.setAttribute("sink-id", sinkId);
    };
  });

  const input = page.getByRole("combobox", { name: "Input microphone" });
  const output = page.getByRole("combobox", { name: "Output speaker" });
  await expect(input.getByRole("option", { name: "USB microphone" })).toHaveCount(1);
  await expect(output.getByRole("option", { name: "Desk speaker" })).toHaveCount(1);

  await input.selectOption("usb-mic");
  await expect.poll(() => page.evaluate(() => globalThis.exampleMicSelections)).toEqual([
    "usb-mic",
  ]);
  await output.selectOption("__choose__");
  await expect.poll(() => page.evaluate(() => globalThis.exampleSinkSelections)).toEqual([
    "headphones",
  ]);

  await page.evaluate(() => {
    globalThis.exampleDevices = [
      { kind: "audioinput", deviceId: "built-in", label: "Built-in microphone" },
      { kind: "audiooutput", deviceId: "desk-speaker", label: "Desk speaker" },
    ];
    navigator.mediaDevices.dispatchEvent(new Event("devicechange"));
  });
  await expect(input).toHaveValue("usb-mic");
  await expect(input.getByRole("option", { name: "Microphone unavailable" })).toHaveCount(1);
  expect(await page.evaluate(() => globalThis.exampleMicSelections)).toEqual(["usb-mic"]);

  await page.getByRole("combobox", { name: "Microphone filter type" }).selectOption(
    "lowpass",
  );
  await page.getByLabel("File cutoff").fill("2500");
  await expect(page.locator("#mic-filter")).toHaveAttribute("type", "lowpass");
  await expect(page.locator("#file-filter")).toHaveAttribute("frequency", "2500");
  expect(errors).toEqual([]);
});

test("Audio example exposes a failed start and keeps recovery controls available", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);
  await page.evaluate(() => {
    const audio = document.querySelector("audio-context");
    const resume = audio.resume.bind(audio);
    let attempts = 0;
    audio.resume = () => {
      attempts += 1;
      if (attempts === 1) {
        return Promise.reject(
          new DOMException(
            "Microphone permission denied by test",
            "NotAllowedError",
          ),
        );
      }
      return resume();
    };
  });

  await page.getByRole("button", { name: "Start audio" }).click();

  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByRole("alert")).toContainText(
    "NotAllowedError: Microphone permission denied by test",
  );
  await expect(page.getByRole("group", { name: "Audio lifecycle" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  await expect(page.getByRole("button", { name: "Start audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Close audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeFocused();

  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  expect(errors).toEqual([]);
});

test("Audio example follows public statechange events", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);
  await page.evaluate(() => {
    const audio = document.querySelector("audio-context");
    let publicState = "suspended";
    Object.defineProperty(audio, "state", {
      configurable: true,
      get: () => publicState,
    });
    audio.resume = async () => {
      publicState = "running";
    };
    globalThis.dispatchExampleState = (nextState) => {
      publicState = nextState;
      audio.dispatchEvent(
        new CustomEvent("statechange", {
          detail: {
            data: new Event("statechange"),
            metadata: {
              contextId: "audio",
              nodeId: "audio",
              nodeName: "audio-context",
            },
          },
        }),
      );
    };
  });

  await page.getByRole("button", { name: "Start audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await page.evaluate(() => globalThis.dispatchExampleState("suspended"));

  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeEnabled();
  expect(errors).toEqual([]);
});

test("Audio example remains terminal when close cleanup rejects", async ({ page }) => {
  await page.addInitScript(() => {
    const revokeObjectURL = URL.revokeObjectURL.bind(URL);
    globalThis.exampleRevokeCalls = 0;
    URL.revokeObjectURL = (url) => {
      globalThis.exampleRevokeCalls += 1;
      revokeObjectURL(url);
    };
  });
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);
  await page.evaluate(() => {
    const audio = document.querySelector("audio-context");
    const close = audio.close.bind(audio);
    globalThis.exampleCloseCalls = 0;
    audio.close = async () => {
      globalThis.exampleCloseCalls += 1;
      await close();
      throw new DOMException("Cleanup report failed by test", "OperationError");
    };
  });

  await page.getByRole("button", { name: "Close audio" }).click();

  await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  await expect(page.getByRole("alert")).toContainText(
    "OperationError: Cleanup report failed by test",
  );
  await expect(page.getByRole("group", { name: "Audio lifecycle" })).toHaveAttribute(
    "aria-busy",
    "false",
  );
  for (const name of ["Start audio", "Suspend audio", "Resume audio", "Close audio"]) {
    await expect(page.getByRole("button", { name })).toBeDisabled();
  }
  expect(
    await page.evaluate(() => document.querySelector("audio-context").state),
  ).toBe("closed");
  expect(await page.evaluate(() => globalThis.exampleRevokeCalls)).toBe(1);
  await page.evaluate(() => document.querySelector("#close").click());
  expect(await page.evaluate(() => globalThis.exampleCloseCalls)).toBe(1);
  expect(errors).toEqual([]);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`Audio example remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${server.httpUrl}/examples/audio-context/`);

    await expect(page.getByRole("navigation", { name: "Examples" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start audio" })).toBeVisible();
    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
      controlsAreLargeEnough: [...document.querySelectorAll("button")].every(
        (button) => button.getBoundingClientRect().height >= 44,
      ),
      mobileFontSize: Number.parseFloat(getComputedStyle(document.body).fontSize),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.controlsAreLargeEnough).toBe(true);
    expect(layout.mobileFontSize).toBeGreaterThanOrEqual(16);
  });
}

for (const example of focusedAudioExamples) {
  test(`${example.label} remains usable at 375px`, async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 800 });
    await page.goto(`${server.httpUrl}/examples/${example.path}`);

    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
      controlsAreLargeEnough: [...document.querySelectorAll("button")].every(
        (button) => button.getBoundingClientRect().height >= 44,
      ),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.controlsAreLargeEnough).toBe(true);
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`guide layout remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${server.httpUrl}/guide/en/`);

    await expect(page.getByRole("navigation", { name: "User Guide" })).toBeVisible();
    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
      undersizedLinks: [
        ...document.querySelectorAll(
          ".guide-navigation a, .language-link, .example-link",
        ),
      ]
        .filter((link) => link.getBoundingClientRect().height < 44)
        .map((link) => ({
          text: link.textContent.trim(),
          height: link.getBoundingClientRect().height,
        })),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.undersizedLinks).toEqual([]);
  });
}

for (const example of [
  { name: "main", path: "web-socket/", transport: "main" },
  { name: "worker", path: "web-socket/background.html", transport: "worker" },
]) {
  test(`${example.name} example performs a real round trip`, async ({ page }) => {
    const errors = watchPageErrors(page);
    const connectionPromise = server.waitForConnection();
    const endpoint = encodeURIComponent(server.wsUrl);
    await page.goto(`${server.httpUrl}/examples/${example.path}?endpoint=${endpoint}`);

    const socket = page.locator("web-socket");
    await expect(socket).toHaveAttribute("url", server.wsUrl);
    await expect(socket).toHaveAttribute("onopen", "OnOpen(event)");
    await expect(socket).toHaveAttribute("onmessage", "OnMessage(event)");
    if (example.transport === "worker") {
      await expect(socket).toHaveAttribute("background", "");
    } else {
      await expect(socket).not.toHaveAttribute("background", "");
    }

    await page.getByRole("button", { name: "Open connection" }).click();
    const connection = await connectionPromise;
    await expect(page.getByTestId("connection-state")).toHaveText("Open");
    await expect(page.getByTestId("transport")).toHaveText(example.transport);

    await page.getByLabel("Message").fill(`hello from ${example.name}`);
    const clientMessage = server.waitForMessage(connection);
    await page.getByRole("button", { name: "Send message" }).click();
    const received = await clientMessage;
    expect(received.data).toBe(`hello from ${example.name}`);
    server.send(connection, `echo: ${received.data}`);

    await expect(page.getByTestId("event-log")).toContainText(
      `echo: hello from ${example.name}`,
    );
    expect(errors).toEqual([]);
  });
}

for (const width of [375, 768, 1024, 1440]) {
  test(`example layout remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(`${server.httpUrl}/examples/web-socket/`);

    await expect(page.getByRole("navigation", { name: "Examples" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open connection" })).toBeVisible();
    const layout = await page.evaluate(() => ({
      body: document.body.scrollWidth,
      viewport: document.documentElement.clientWidth,
      controlsAreLargeEnough: [...document.querySelectorAll("button")].every(
        (button) => button.getBoundingClientRect().height >= 44,
      ),
    }));
    expect(layout.body).toBeLessThanOrEqual(layout.viewport);
    expect(layout.controlsAreLargeEnough).toBe(true);
  });
}
