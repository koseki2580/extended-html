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
];

for (const guide of [
  {
    language: "English",
    path: "guide/en/",
    lang: "en",
    heading: "Use WebSocket from HTML",
    translation: "日本語で読む",
    translationPath: "../ja/",
    examples: "Interactive examples",
  },
  {
    language: "Japanese",
    path: "guide/ja/",
    lang: "ja",
    heading: "WebSocketをHTMLで使う",
    translation: "Read in English",
    translationPath: "../en/",
    examples: "動作するサンプル",
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
    await expect(audioGuide).toContainText("AudioWorklet");
    await expect(audioGuide).toContainText("OfflineAudioContext");
    await expect(audioGuide.getByRole("link", { name: /Audio/ })).toHaveAttribute(
      "href",
      "../../examples/audio-context/",
    );
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

test("examples overview and sidebar navigate to the Audio example", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/`);

  const audioCard = page.locator(".example-card").filter({ hasText: "Audio graph" });
  await expect(audioCard).toHaveAttribute("href", "./audio-context/");
  await audioCard.click();

  await expect(page).toHaveURL(/\/examples\/audio-context\/$/);
  await expect(page.getByRole("heading", { name: "Build one audio graph." })).toBeVisible();
  const navigation = page.getByRole("navigation", { name: "Examples" });
  await expect(navigation.getByRole("link", { name: "Audio graph" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(errors).toEqual([]);
});

test("Audio example starts and controls every source through its context", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);

  const context = page.locator("audio-context#audio");
  const mic = context.locator(":scope > audio-input-mic#mic");
  const filter = mic.locator(":scope > audio-biquad-filter#mix");
  await expect(filter.locator(":scope > audio-output")).toHaveCount(1);
  await expect(context.locator(":scope > audio-input-file#music")).toHaveAttribute(
    "to",
    "mix",
  );
  await expect(context).not.toHaveAttribute("auto", "");
  await expect(context.locator("audio-input-file")).not.toHaveAttribute(
    "autoplay",
    "",
  );

  const sourceCode = await page.evaluate(async () =>
    fetch("../assets/audio-context-example.js").then((response) => response.text()),
  );
  expect(sourceCode).not.toMatch(/\b(?:mic|music|file)\.(?:open|play|close)\s*\(/);

  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByRole("button", { name: "Start audio" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close audio" })).toBeEnabled();

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

  await page.getByRole("button", { name: "Suspend audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Suspended");
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeEnabled();

  await page.getByRole("button", { name: "Resume audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Running");
  await expect.poll(() => page.evaluate(() => globalThis.exampleResumeCalls)).toBe(2);

  await page.getByRole("button", { name: "Close audio" }).click();
  await expect(page.getByTestId("audio-state")).toHaveText("Closed");
  await expect(page.getByTestId("event-log")).toContainText("mic · close");
  await expect(page.getByRole("button", { name: "Start audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Suspend audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Resume audio" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Close audio" })).toBeDisabled();
  expect(errors).toEqual([]);
});

test("Audio example exposes a failed start and keeps recovery controls available", async ({
  page,
}) => {
  const errors = watchPageErrors(page);
  await page.goto(`${server.httpUrl}/examples/audio-context/`);
  await page.evaluate(() => {
    document.querySelector("audio-context").resume = async () => {
      throw new DOMException(
        "Microphone permission denied by test",
        "NotAllowedError",
      );
    };
  });

  await page.getByRole("button", { name: "Start audio" }).click();

  await expect(page.getByTestId("audio-state")).toHaveText("Error");
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
