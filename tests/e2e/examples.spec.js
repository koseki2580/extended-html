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
