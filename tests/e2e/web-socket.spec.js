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
  await page.goto(`${server.httpUrl}/tests/e2e/fixtures/web-socket.html`);
  await page.waitForFunction(() => globalThis.customElementsReady === true);
};

const createSocket = async (
  page,
  transport,
  { reconnect = false, reconnectDelay = null } = {},
) => {
  await page.evaluate(
    ({ url, transport, reconnect, reconnectDelay }) => {
      globalThis.testEvents = [];
      const socket = document.createElement("web-socket");
      socket.id = "socket";
      socket.setAttribute("url", url);
      socket.setAttribute("auto", "");
      if (transport === "worker") socket.setAttribute("background", "");
      if (reconnect) socket.setAttribute("reconnect", "");
      if (reconnectDelay !== null) {
        socket.setAttribute("reconnect-delay", String(reconnectDelay));
      }
      for (const type of ["open", "message", "error", "close"]) {
        socket.addEventListener(type, async (event) => {
          let data = event.detail.data;
          if (data instanceof Blob) {
            data = {
              binary: [...new Uint8Array(await data.arrayBuffer())],
            };
          }
          globalThis.testEvents.push({
            type,
            data,
            transport: event.detail.metadata.transport,
          });
        });
      }
      document.querySelector("#host").append(socket);
    },
    { url: server.wsUrl, transport, reconnect, reconnectDelay },
  );
};

const waitForEventCount = async (page, type, count) => {
  await page.waitForFunction(
    ({ type, count }) =>
      globalThis.testEvents.filter((event) => event.type === type).length >= count,
    { type, count },
  );
};

for (const transport of ["main", "worker"]) {
  test(`${transport} transport exchanges text in both directions`, async ({
    page,
  }) => {
    await openFixture(page);
    const connectionPromise = server.waitForConnection();
    await createSocket(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);

    const clientMessage = server.waitForMessage(connection);
    await page.locator("#socket").evaluate((socket) => socket.send("from browser"));
    await expect(clientMessage).resolves.toEqual({
      data: "from browser",
      isBinary: false,
    });

    server.send(connection, "from server");
    await waitForEventCount(page, "message", 1);
    const events = await page.evaluate(() => globalThis.testEvents);
    expect(events.find((event) => event.type === "message")?.data).toBe(
      "from server",
    );
    expect(events.every((event) => event.transport === transport)).toBe(true);
  });

  test(`${transport} transport exchanges binary data`, async ({ page }) => {
    await openFixture(page);
    const connectionPromise = server.waitForConnection();
    await createSocket(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);

    const clientMessage = server.waitForMessage(connection);
    await page.locator("#socket").evaluate((socket) => {
      socket.send(new Uint8Array([1, 2, 3]));
    });
    const received = await clientMessage;
    expect(received.isBinary).toBe(true);
    expect([...received.data]).toEqual([1, 2, 3]);

    server.send(connection, Buffer.from([4, 5, 6]), { binary: true });
    await waitForEventCount(page, "message", 1);
    const message = await page.evaluate(() =>
      globalThis.testEvents.find((event) => event.type === "message"),
    );
    expect(message.data).toEqual({ binary: [4, 5, 6] });
    expect(message.transport).toBe(transport);
  });

  test(`${transport} transport close is observed by the server`, async ({
    page,
  }) => {
    await openFixture(page);
    const connectionPromise = server.waitForConnection();
    await createSocket(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);
    const closePromise = server.waitForClose(connection);

    await page.locator("#socket").evaluate((socket) => socket.close());

    await expect(closePromise).resolves.toMatchObject({ reason: "" });
  });

  test(`${transport} transport stops and ignores late data after DOM removal`, async ({
    page,
  }) => {
    await openFixture(page);
    const connectionPromise = server.waitForConnection();
    await createSocket(page, transport);
    const connection = await connectionPromise;
    await waitForEventCount(page, "open", 1);
    const closePromise = server.waitForClose(connection);

    await page.locator("#socket").evaluate((socket) => socket.remove());
    try {
      server.send(connection, "late message");
    } catch {
      // The close handshake can complete before the server attempts the late send.
    }
    await closePromise;
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
    );

    const messages = await page.evaluate(() =>
      globalThis.testEvents.filter((event) => event.type === "message"),
    );
    expect(messages).toEqual([]);
  });

  test(`${transport} transport reconnects after a server close`, async ({ page }) => {
    await openFixture(page);
    const firstConnectionPromise = server.waitForConnection();
    await createSocket(page, transport, { reconnect: true, reconnectDelay: 10 });
    const firstConnection = await firstConnectionPromise;
    await waitForEventCount(page, "open", 1);
    const secondConnectionPromise = server.waitForConnection();

    server.close(firstConnection, 1012, "restart");
    const secondConnection = await secondConnectionPromise;
    await waitForEventCount(page, "open", 2);

    const closePromise = server.waitForClose(secondConnection);
    await page.locator("#socket").evaluate((socket) => socket.remove());
    await closePromise;
  });
}
