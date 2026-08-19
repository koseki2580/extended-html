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

test("root opens the examples overview with sidebar navigation", async ({ page }) => {
  const errors = watchPageErrors(page);
  await page.goto(server.httpUrl);

  await expect(page).toHaveURL(/\/examples\/$/);
  await expect(page.getByRole("navigation", { name: "Examples" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WebSocket: Main" })).toBeVisible();
  await expect(page.getByRole("link", { name: "WebSocket: Worker" })).toBeVisible();

  await page.getByRole("link", { name: "WebSocket: Main" }).click();
  await expect(page).toHaveURL(/\/examples\/web-socket\/$/);
  expect(errors).toEqual([]);
});

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
