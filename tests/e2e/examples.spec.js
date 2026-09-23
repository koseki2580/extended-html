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
  "graph-editor",
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
    await expect(audioGuide.locator('a[href="../../examples/audio-context/webrtc.html"]')).toHaveCount(1);
    const graphGuide = page.locator("#graph-editor");
    await expect(graphGuide).toContainText("graph-editor");
    await expect(graphGuide).toContainText("graph-event");
    await expect(graphGuide).toContainText("graph-action");
    await expect(graphGuide).toContainText("event.detail.data");
    await expect(graphGuide.locator('a[href="../../examples/graph-editor/"]')).toHaveCount(1);
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

test("WebRTC sample sends Audio graph output to a local receiving peer", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/webrtc.html`);

  await page.getByRole("button", { name: "Start WebRTC audio" }).click();
  await expect(page.getByTestId("sender-state")).toHaveText("connected", {
    timeout: 10000,
  });
  await expect(page.getByTestId("receiver-state")).toHaveText("connected", {
    timeout: 10000,
  });
  await expect(page.getByTestId("remote-track-state")).toHaveText("live audio track");
  expect(
    await page.locator("#remote-audio").evaluate((element) => ({
      hasStream: element.srcObject instanceof MediaStream,
      audioTracks: element.srcObject?.getAudioTracks().length ?? 0,
      muted: element.muted,
    })),
  ).toEqual({ hasStream: true, audioTracks: 1, muted: true });

  await page.getByRole("button", { name: "Close WebRTC audio" }).click();
  await expect(page.getByTestId("sender-state")).toHaveText("closed");
  await expect(page.getByTestId("receiver-state")).toHaveText("closed");
  await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  expect(errors).toEqual([]);
});

test("Graph editor sample keeps visual edits and declarative HTML synchronized", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/graph-editor/`);

  await expect(page.locator("body")).toHaveAttribute("data-page", "graph-editor");
  await expect(page.getByRole("heading", { name: "Edit HTML as a graph." })).toBeVisible();
  const editor = page.locator("graph-editor#editor");
  await expect(editor.locator('[data-node-id="mic"]')).toBeVisible();
  await expect(editor.locator('[data-node-id="chunk-ready"]')).toBeVisible();
  await expect(editor.locator('[data-node-id="save-chunk"]')).toBeVisible();
  await expect(page.getByTestId("serialized-markup")).toContainText("<audio-context");

  await editor.locator('[data-node-id="filter"] .node-select').click();
  const frequency = editor.locator('[data-property="frequency"]');
  await frequency.fill("880");
  await frequency.press("Tab");
  await expect(editor.locator("audio-biquad-filter#filter")).toHaveAttribute(
    "frequency",
    "880",
  );
  await expect(page.getByTestId("serialized-markup")).toContainText('frequency="880"');

  await editor.getByRole("button", { name: "Add Audio file" }).click();
  await expect(editor.locator("audio-context > audio-input-file")).toHaveCount(1);
  await expect(page.getByTestId("last-operation")).toHaveText("add");
  const fileId = await editor.locator("audio-context > audio-input-file").getAttribute("id");
  const outputPort = editor.locator(`[data-node-id="${fileId}"] [data-port="output"]`);
  const inputPort = editor.locator('[data-node-id="filter"] [data-port="input"]');
  await expect(outputPort).toBeInViewport();
  const fromBox = await outputPort.boundingBox();
  const toBox = await inputPort.boundingBox();
  await page.mouse.move(fromBox.x + fromBox.width / 2, fromBox.y + fromBox.height / 2);
  await page.mouse.down();
  await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
  await page.mouse.up();
  await expect(editor.locator(`audio-input-file#${fileId}`)).toHaveAttribute("to", "filter");

  await editor.locator("[data-connect-from]").selectOption(fileId);
  await editor.locator("[data-connect-to]").selectOption("filter");
  await editor.getByRole("button", { name: "Disconnect" }).click();
  await expect(editor.locator(`audio-input-file#${fileId}`)).not.toHaveAttribute("to");
  await expect(page.getByTestId("last-operation")).toHaveText("disconnect");
  expect(errors).toEqual([]);
});

test("Graph editor sample clears stale errors after a valid edit and root recovery", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/graph-editor/`);
  const editor = page.locator("graph-editor#editor");
  await editor.locator("[data-connect-from]").selectOption("mic");
  await editor.locator("[data-connect-to]").selectOption("filter");
  await editor.getByRole("button", { name: "Disconnect" }).click();
  await expect(page.locator("#graph-error")).toContainText("NotFoundError");
  await editor.getByRole("button", { name: "Add Audio file" }).click();
  await expect(page.locator("#graph-error")).toBeEmpty();

  const audioMarkup = await editor.locator("audio-context#audio").evaluate((element) => element.outerHTML);
  await editor.locator("audio-context#audio").evaluate((element) => element.remove());
  await expect(page.locator("#graph-error")).toContainText("recorder");
  await editor.evaluate((element, html) => element.insertAdjacentHTML("afterbegin", html), audioMarkup);
  await expect(editor.locator('[data-node-id="recorder"]')).toBeVisible();
  await expect(page.locator("#graph-error")).toBeEmpty();
});

test("Graph editor controls stay readable in a dark page and the default layout follows the DAG", async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.httpUrl}/examples/graph-editor/`);

  const audit = await page.locator("graph-editor#editor").evaluate((editor) => {
    const root = editor.shadowRoot;
    const parseColor = (value) => value.match(/[\d.]+/g).slice(0, 3).map(Number);
    const luminance = (value) => {
      const channels = parseColor(value).map((channel) => {
        const normalized = channel / 255;
        return normalized <= 0.04045
          ? normalized / 12.92
          : ((normalized + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2];
    };
    const contrast = (element) => {
      const style = getComputedStyle(element);
      const foreground = luminance(style.color);
      const background = luminance(style.backgroundColor);
      return (Math.max(foreground, background) + 0.05)
        / (Math.min(foreground, background) + 0.05);
    };
    const controls = [...root.querySelectorAll(
      ".palette button, .toolbar button, .toolbar select, .navigator-list button, .node-select, .drag-handle, .port, .inspector button",
    )].filter((control) => control.getClientRects().length > 0);
    const cards = new Map(
      [...root.querySelectorAll("[data-node-id]")].map((card) => [
        card.dataset.nodeId,
        card.getBoundingClientRect(),
      ]),
    );
    const cardEntries = [...cards.entries()];
    const overlaps = cardEntries.flatMap(([leftId, left], index) =>
      cardEntries.slice(index + 1).flatMap(([rightId, right]) => {
        const intersects = left.left < right.right && left.right > right.left
          && left.top < right.bottom && left.bottom > right.top;
        return intersects ? [`${leftId}:${rightId}`] : [];
      }),
    );
    const edgesMoveForward = [...root.querySelectorAll("path[data-edge-from]")].every(
      (path) => cards.get(path.dataset.edgeTo).left > cards.get(path.dataset.edgeFrom).left,
    );

    return {
      lowContrast: controls
        .filter((control) => contrast(control) < 4.5)
        .map((control) => control.getAttribute("aria-label") || control.textContent.trim()),
      undersized: controls
        .filter((control) => {
          const box = control.getBoundingClientRect();
          return box.width < 44 || box.height < 44;
        })
        .map((control) => control.getAttribute("aria-label") || control.textContent.trim()),
      edgesMoveForward,
      overlaps,
    };
  });

  expect(audit.lowContrast).toEqual([]);
  expect(audit.undersized).toEqual([]);
  expect(audit.edgesMoveForward).toBe(true);
  expect(audit.overlaps).toEqual([]);
});

test("Graph editor selection explains and navigates direct node relationships", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${server.httpUrl}/examples/graph-editor/`);
  const editor = page.locator("graph-editor#editor");
  const navigator = editor.getByRole("navigation", { name: "Graph node navigator" });

  await expect(navigator.locator('[data-graph-stats]')).toHaveText("7 nodes · 6 edges");
  await expect(navigator.locator('[data-navigate-node]')).toHaveCount(7);

  await editor.locator('[data-node-id="filter"] .node-select').click();
  await expect(editor.locator('[data-node-id="filter"]')).toHaveAttribute(
    "data-relation",
    "selected",
  );
  await expect(editor.locator('[data-node-id="mic"]')).toHaveAttribute(
    "data-relation",
    "connected",
  );
  await expect(editor.locator('[data-node-id="recorder"]')).toHaveAttribute(
    "data-relation",
    "unrelated",
  );
  await expect(editor.locator('[data-selection-status]')).toHaveText(
    "Biquad filter selected. 1 input, 2 outputs.",
  );
  await expect(editor.locator('path[data-relation="connected"]')).toHaveCount(3);

  const relatedOutput = editor.locator('[data-related-id="recording-output"]');
  await relatedOutput.focus();
  await relatedOutput.press("Enter");
  await expect(editor.locator('[data-node-id="recording-output"]')).toHaveAttribute(
    "data-relation",
    "selected",
  );
  await expect(editor.locator('[data-node-id="recording-output"] .node-select')).toBeFocused();

  await navigator.locator('[data-navigate-node="save-chunk"]').click();
  await expect(editor.locator('[data-node-id="save-chunk"]')).toHaveAttribute(
    "data-relation",
    "selected",
  );
  await expect(editor.locator('[data-node-id="save-chunk"] .node-select')).toBeFocused();
  expect(
    await editor.evaluate((element) => {
      const root = element.shadowRoot;
      const node = root.querySelector('[data-node-id="save-chunk"]').getBoundingClientRect();
      const canvas = root.querySelector(".canvas").getBoundingClientRect();
      return node.left >= canvas.left
        && node.right <= canvas.right
        && node.top >= canvas.top
        && node.bottom <= canvas.bottom;
    }),
  ).toBe(true);
  expect(errors).toEqual([]);
});

test("overview and sidebar expose WebRTC and Graph editor samples", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/`);
  const navigation = page.getByRole("navigation", { name: "Examples" });
  await expect(navigation.getByRole("link", { name: "Audio: WebRTC" })).toHaveAttribute(
    "href",
    /\/examples\/audio-context\/webrtc\.html$/,
  );
  await expect(navigation.getByRole("link", { name: "Graph editor" })).toHaveAttribute(
    "href",
    /\/examples\/graph-editor\/$/,
  );
  await expect(
    navigation.getByRole("link", { name: "Graph: Custom handler" }),
  ).toHaveAttribute("href", /\/examples\/graph-editor\/custom-handler\.html$/);
  await expect(page.locator('.example-card[href="./audio-context/webrtc.html"]')).toHaveCount(1);
  await expect(page.locator('.example-card[href="./graph-editor/"]')).toHaveCount(1);
  await expect(
    page.locator('.example-card[href="./graph-editor/custom-handler.html"]'),
  ).toHaveCount(1);
});

test("Custom handler sample runs an editor-scoped function through the graph", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);

  await expect(page.locator("body")).toHaveAttribute("data-page", "graph-custom-handler");
  await expect(page.getByRole("heading", { name: "Connect application logic." })).toBeVisible();
  await expect(page.getByTestId("handler-source")).toContainText(
    'editor.registerFunction("CustomHandlers.Measure"',
  );
  await expect(page.getByRole("link", { name: "Open the editable JavaScript module" })).toHaveAttribute(
    "href", "../assets/graph-handler-example.js",
  );
  expect(await page.evaluate(() => "CustomHandlers" in globalThis)).toBe(false);
  const editor = page.locator("graph-editor#handler-editor");
  await expect(editor.locator("graph-action#measure-chunk")).toHaveAttribute(
    "handler",
    "CustomHandlers.Measure(event)",
  );
  await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute("from", "measure-chunk");
  await expect(editor.locator('[data-node-id="measure-chunk"] [data-port="output"]')).toBeVisible();
  await expect(editor.locator('path[data-edge-from="measure-chunk"][data-edge-to="audit-chunk"]')).toHaveCount(1);
  await editor.locator('[data-node-id="measure-chunk"] .node-select').click();
  await expect(editor.locator('[data-selection-status]')).toContainText("1 input, 1 output");
  await expect(editor.locator('[data-related-id="audit-chunk"]')).toBeVisible();
  await expect(page.getByTestId("serialized-handler-markup")).not.toContainText('src="blob:');

  await page.getByRole("button", { name: "Start handler graph" }).click();
  await expect(page.getByTestId("handler-audio-state")).toHaveText("Running");
  await page.getByRole("button", { name: "Request handler data" }).click();
  await expect(page.getByTestId("measure-count")).not.toHaveText("0");
  await expect(page.getByTestId("audit-count")).not.toHaveText("0");
  await expect(page.getByTestId("handler-results")).toContainText("Blob");
  await expect(page.getByTestId("handler-results")).toContainText('"producerId":"measure-chunk"');
  await expect(page.getByTestId("handler-results")).toContainText("dataavailable");
  expect(errors).toEqual([]);
});

test("Custom handler sample rewires action data by pointer and keyboard", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");
  await editor.locator("[data-connect-from]").selectOption("measure-chunk");
  await editor.locator("[data-connect-to]").selectOption("audit-chunk");
  await editor.getByRole("button", { name: "Disconnect" }).click();
  await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute("from", "");

  const output = editor.locator('[data-node-id="measure-chunk"] [data-port="output"]');
  const input = editor.locator('[data-node-id="audit-chunk"] [data-port="input"]');
  await output.scrollIntoViewIfNeeded();
  await input.scrollIntoViewIfNeeded();
  const from = await output.boundingBox();
  const to = await input.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
  await page.mouse.up();
  await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute("from", "measure-chunk");
  expect(errors).toEqual([]);
});

for (const width of [375, 768]) {
  test(`Custom handler ports connect by touch drag at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({
      hasTouch: true, isMobile: true, viewport: { width, height: 900 }, deviceScaleFactor: 1,
    });
    try {
      const page = await context.newPage();
      const errors = watchPageErrors(page);
      await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
      const editor = page.locator("graph-editor#handler-editor");
      await editor.locator("[data-connect-from]").selectOption("measure-chunk");
      await editor.locator("[data-connect-to]").selectOption("audit-chunk");
      await editor.getByRole("button", { name: "Disconnect" }).click();
      await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute("from", "");
      await editor.evaluate((element) => {
        for (const [id, x] of [["measure-chunk", 24], ["audit-chunk", 220]]) {
          const node = element.querySelector(`#${id}`);
          node.dataset.graphX = String(x);
          node.dataset.graphY = "24";
        }
      });
      const output = editor.locator('[data-node-id="measure-chunk"] [data-port="output"]');
      const input = editor.locator('[data-node-id="audit-chunk"] [data-port="input"]');
      await output.scrollIntoViewIfNeeded();
      const from = await output.boundingBox();
      const to = await input.boundingBox();
      const session = await context.newCDPSession(page);
      await session.send("Input.dispatchTouchEvent", {
        type: "touchStart", touchPoints: [{ x: from.x + from.width / 2, y: from.y + from.height / 2 }],
      });
      await session.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: to.x + to.width / 2, y: to.y + to.height / 2 }],
      });
      await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute("from", "measure-chunk");
      expect(errors).toEqual([]);
    } finally {
      await context.close();
    }
  });
}

test("Mobile vertical swipe across the canvas scrolls the page", async ({ browser }) => {
  const context = await browser.newContext({
    hasTouch: true, isMobile: true, viewport: { width: 375, height: 900 }, deviceScaleFactor: 1,
  });
  try {
    const page = await context.newPage();
    await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
    const canvas = page.locator("graph-editor#handler-editor").locator(".canvas");
    await canvas.scrollIntoViewIfNeeded();
    const box = await canvas.boundingBox();
    const before = await page.evaluate(() => scrollY);
    const x = box.x + box.width / 2;
    const y = box.y + box.height - 55;
    const session = await context.newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x, y }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y: y - 160 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect.poll(() => page.evaluate(() => scrollY)).toBeGreaterThan(before + 20);
  } finally {
    await context.close();
  }
});

test("Custom handler sample adds a registered function action without typing references", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");

  await editor.locator('[data-node-id="measure-chunk"] .node-select').click();
  const addFunction = editor.getByRole("button", { name: "Add Label summary" });
  await addFunction.focus();
  await addFunction.press("Enter");
  const addedAction = editor.locator(":scope > graph-action").last();
  await expect(addedAction).toHaveAttribute("from", "measure-chunk");
  await expect(addedAction).toHaveAttribute("handler", "CustomHandlers.Label(event)");
  const actionId = await addedAction.getAttribute("id");
  await expect(editor.locator(`[data-node-id="${actionId}"] .node-select`)).toBeFocused();
  await expect(page.getByTestId("serialized-handler-markup")).toContainText(
    'handler="CustomHandlers.Label(event)"',
  );

  await page.getByRole("button", { name: "Start handler graph" }).click();
  await page.getByRole("button", { name: "Request handler data" }).click();
  await expect(page.getByTestId("handler-results")).toContainText("Label handler");
  await expect(page.getByTestId("handler-results")).toContainText('"label":"Review"');
  await expect(editor.locator('graph-action[handler="CustomHandlers.Audit(event)"]')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test("Custom handler sample clears an error after a valid correction", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");
  await editor.locator('[data-node-id="audit-chunk"] .node-select').click();
  const handler = editor.locator('[data-property="handler"]');
  await handler.fill("alert('unsafe')");
  await handler.press("Tab");
  await expect(page.locator("#handler-error")).toContainText("SyntaxError");
  await handler.fill("CustomHandlers.Audit(event)");
  await handler.press("Tab");
  await expect(page.locator("#handler-error")).toBeEmpty();
  await expect(editor.locator("graph-action#audit-chunk")).toHaveAttribute(
    "handler", "CustomHandlers.Audit(event)",
  );
});

test("Custom handler sample shows the output of an arbitrary registered function", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");
  await editor.evaluate((element) => {
    element.registerFunction("User.DoubleSize", (event) => ({ doubled: event.detail.data.size * 2 }), {
      label: "Double size",
    });
  });
  await editor.locator('[data-node-id="measure-chunk"] .node-select').click();
  await editor.getByRole("button", { name: "Add Double size" }).click();
  await page.getByRole("button", { name: "Start handler graph" }).click();
  await page.getByRole("button", { name: "Request handler data" }).click();
  await expect(page.getByTestId("handler-results")).toContainText("DoubleSize handler");
  await expect(page.getByTestId("handler-results")).toContainText('"doubled":');
  await expect(page.getByTestId("handler-results")).toContainText("#graph-action-1");
});

test("Custom handler sample can restart after Close without losing graph edits", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");
  await expect(page.getByRole("button", { name: "Close handler graph" })).toBeDisabled();
  await editor.locator('[data-node-id="measure-chunk"] .node-select').click();
  await editor.getByRole("button", { name: "Add Label summary" }).click();
  await page.getByRole("button", { name: "Start handler graph" }).click();
  await page.getByRole("button", { name: "Close handler graph" }).click();
  const restart = page.getByRole("button", { name: "Restart handler graph" });
  await expect(restart).toBeVisible();
  await restart.click();
  await expect(page.getByRole("button", { name: "Start handler graph" })).toBeEnabled();
  await expect(editor.locator('graph-action[handler="CustomHandlers.Label(event)"]')).toHaveCount(1);
  await page.getByRole("button", { name: "Start handler graph" }).click();
  await page.getByRole("button", { name: "Request handler data" }).click();
  await expect(page.getByTestId("handler-results")).toContainText("Label handler");
});

test("Large graph offers a bounded overview without hiding the drawing area", async ({ page }) => {
  await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);
  const editor = page.locator("graph-editor#handler-editor");
  await editor.evaluate((element) => {
    for (let index = 0; index < 20; index += 1) {
      const action = document.createElement("graph-action");
      action.id = `branch-${index}`;
      action.setAttribute("from", "measure-chunk");
      action.setAttribute("handler", "CustomHandlers.Audit(event)");
      element.append(action);
    }
  });
  const overview = editor.locator('[data-navigator-view="overview"]');
  await expect(overview).toBeVisible();
  await overview.click();
  await expect(overview).toHaveAttribute("aria-pressed", "true");
  await expect(editor.locator(".overview-map")).toBeVisible();
  await expect(editor.locator(".overview-map [data-overview-edge]")).toHaveCount(25);
  expect(await editor.locator(".canvas").evaluate((element) => element.clientHeight)).toBeGreaterThan(240);
  await editor.locator('[data-navigator-view="nodes"]').click();
  await expect(editor.locator('[data-navigate-node="branch-19"]')).toBeVisible();
});

for (const width of [375, 768, 1024, 1440]) {
  test(`Custom handler sample remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${server.httpUrl}/examples/graph-editor/custom-handler.html`);

    await expect(page.getByRole("heading", { name: "Connect application logic." })).toBeVisible();
    const editor = page.locator("graph-editor#handler-editor");
    await expect(editor).toBeVisible();
    if (width === 375) {
      expect((await editor.boundingBox()).height).toBeLessThan(1400);
    }
    const addTray = editor.locator('[data-toggle-panel="palette"]');
    if (await addTray.isVisible()) await addTray.click();
    await expect(editor.locator("[data-palette-search]")).toBeVisible();
    await expect(editor.locator("[data-add-function]")).toHaveCount(3);
    expect(
      await editor.evaluate((element) => [...element.shadowRoot.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length > 0)
        .every((button) => {
          const box = button.getBoundingClientRect();
          return box.width >= 44 && box.height >= 44;
        })),
    ).toBe(true);
    if (width === 1440) {
      expect(
        await editor.evaluate((element) => {
          const root = element.shadowRoot;
          const canvas = root.querySelector(".canvas").getBoundingClientRect();
          const inspector = root.querySelector(".inspector").getBoundingClientRect();
          return inspector.left >= canvas.right && inspector.top < canvas.bottom;
        }),
      ).toBe(true);
    }
    const layout = await page.evaluate(() => ({
      pageOverflow: document.documentElement.scrollWidth - innerWidth,
      instructionOverlap: [...document.querySelectorAll(".handler-steps li")]
        .some((item) => {
          const number = item.querySelector("span").getBoundingClientRect();
          const instruction = item.querySelector("div").getBoundingClientRect();
          return instruction.left < number.right;
        }),
      undersized: [...document.querySelectorAll("button")]
        .filter((button) => button.getClientRects().length > 0)
        .filter((button) => button.getBoundingClientRect().height < 44)
        .map((button) => button.textContent.trim()),
    }));
    expect(layout.pageOverflow).toBe(0);
    expect(layout.instructionOverlap).toBe(false);
    expect(layout.undersized).toEqual([]);
  });
}

test("Graph editor sample routes recorder data through graph-event and graph-action", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/graph-editor/`);

  await page.getByRole("button", { name: "Start audio graph" }).click();
  await expect(page.getByTestId("graph-audio-state")).toHaveText("Running");
  await page.getByRole("button", { name: "Request recorder data" }).click();
  await expect(page.getByTestId("action-count")).not.toHaveText("0");
  await expect(page.getByTestId("action-log")).toContainText("dataavailable");
  await page.getByRole("button", { name: "Close audio graph" }).click();
  await expect(page.getByTestId("graph-audio-state")).toHaveText("Closed");
  expect(errors).toEqual([]);
});

for (const width of [375, 768, 1024, 1440]) {
  test(`Graph editor sample remains usable at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(`${server.httpUrl}/examples/graph-editor/`);

    const editor = page.locator("graph-editor#editor");
    const addTray = editor.locator('[data-toggle-panel="palette"]');
    if (await addTray.isVisible()) await addTray.click();
    await expect(editor.getByRole("button", { name: "Add Microphone" })).toBeVisible();
    await expect(editor.locator('[aria-label="Graph canvas"]')).toBeVisible();
    await expect(editor.locator('[aria-label="Graph node inspector"]')).toBeVisible();
    await expect(editor.getByRole("navigation", { name: "Graph node navigator" })).toBeVisible();
    await editor.locator('[data-navigate-node="save-chunk"]').click();
    await expect(editor.locator('[data-node-id="save-chunk"] .node-select')).toBeFocused();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    expect(
      await editor.evaluate((element) => {
        const root = element.shadowRoot;
        const canvas = root.querySelector(".canvas").getBoundingClientRect();
        const selected = root.querySelector('[data-node-id="save-chunk"]')
          .getBoundingClientRect();
        const selectedNodeIsVisible = selected.left >= canvas.left
          && selected.right <= canvas.right
          && selected.top >= canvas.top
          && selected.bottom <= canvas.bottom;
        const navigatorTargetsAreUsable = [...root.querySelectorAll("[data-navigate-node]")]
          .every((button) => {
            const box = button.getBoundingClientRect();
            return box.width >= 44 && box.height >= 44;
          });
        return selectedNodeIsVisible && navigatorTargetsAreUsable;
      }),
    ).toBe(true);
    if (width === 375) {
      expect(
        await editor.evaluate((element) => {
          const buttons = [...element.shadowRoot.querySelectorAll(".palette-list button")];
          return new Set(buttons.map((button) => Math.round(button.getBoundingClientRect().left)))
            .size;
        }),
      ).toBeGreaterThanOrEqual(2);
    }
  });
}

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

  const audioCard = page.locator(".example-card").filter({
    has: page.getByRole("heading", { name: "Audio graph", exact: true }),
  });
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
