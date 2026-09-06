import { test, expect } from "@playwright/test";
import { startTestServer } from "./support/test-server.js";

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.stop();
});

const openFixture = async (page) => {
  await page.goto(`${server.httpUrl}/tests/e2e/fixtures/event-source.html`);
  await page.waitForFunction(() => globalThis.customElementsReady === true);
};

const createEventSource = async (page, transport) => {
  await page.evaluate(
    ({ url, transport }) => {
      globalThis.testEvents = [];
      const source = document.createElement("event-source");
      source.id = "source";
      source.setAttribute("url", url);
      source.setAttribute("auto", "");
      if (transport === "worker") source.setAttribute("background", "");
      for (const type of ["open", "message", "error"]) {
        source.addEventListener(type, (event) => {
          globalThis.testEvents.push({
            type,
            data: event.detail.data,
            metadata: event.detail.metadata,
          });
        });
      }
      document.querySelector("#host").append(source);
    },
    { url: server.sseUrl, transport },
  );
};

const waitForEventCount = (page, type, count) =>
  page.waitForFunction(
    ({ type, count }) =>
      globalThis.testEvents.filter((event) => event.type === type).length >= count,
    { type, count },
  );

for (const transport of ["main", "worker"]) {
  test(`${transport} transport receives SSE data and metadata`, async ({ page }) => {
    await openFixture(page);
    const connectionPromise = server.waitForEventSource();
    await createEventSource(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);

    server.sendEvent(connection, {
      data: "hello\nfrom server",
      id: "event-7",
    });
    await waitForEventCount(page, "message", 1);
    const message = await page.evaluate(() =>
      globalThis.testEvents.find((event) => event.type === "message"),
    );

    expect(message.data).toBe("hello\nfrom server");
    expect(message.metadata.lastEventId).toBe("event-7");
    expect(message.metadata.origin).toBe(server.httpUrl);
    expect(message.metadata.transport).toBe(transport);
  });

  test(`${transport} transport reconnects natively with Last-Event-ID`, async ({
    page,
  }) => {
    await openFixture(page);
    const firstPromise = server.waitForEventSource();
    await createEventSource(page, transport);
    const first = await firstPromise;
    await waitForEventCount(page, "open", 1);
    server.sendEvent(first, { data: "first", id: "resume-12", retry: 10 });
    await waitForEventCount(page, "message", 1);
    const secondPromise = server.waitForEventSource();

    server.closeEventSource(first);
    const second = await secondPromise;

    expect(second.lastEventId).toBe("resume-12");
    await waitForEventCount(page, "open", 2);
  });

  test(`${transport} transport closes when removed from the DOM`, async ({ page }) => {
    await openFixture(page);
    const connectionPromise = server.waitForEventSource();
    await createEventSource(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);
    const closePromise = server.waitForEventSourceClose(connection);

    await page.locator("#source").evaluate((source) => source.remove());

    await closePromise;
    expect(await page.locator("#source").count()).toBe(0);
  });

  test(`${transport} transport close() is observed by the server`, async ({ page }) => {
    await openFixture(page);
    const connectionPromise = server.waitForEventSource();
    await createEventSource(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);
    const closePromise = server.waitForEventSourceClose(connection);

    await page.locator("#source").evaluate((source) => source.close());

    await closePromise;
    expect(
      await page.locator("#source").evaluate((source) => source.readyState),
    ).toBe(2);
  });
}
