import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { startTestServer } from "./support/test-server.js";

test("serves repository modules and exposes observable WebSocket traffic", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.httpUrl}/src/index.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain('import "./web-socket/web-socket.js"');

    const client = new WebSocket(server.wsUrl);
    await new Promise((resolve) => client.once("open", resolve));
    const connection = await server.waitForConnection();
    client.send("from client");
    await expect(server.waitForMessage(connection)).resolves.toEqual({
      data: "from client",
      isBinary: false,
    });

    const received = new Promise((resolve) => client.once("message", resolve));
    server.send(connection, "from server");
    await expect(received).resolves.toEqual(Buffer.from("from server"));
    client.close();
    await server.waitForClose(connection);
  } finally {
    await server.stop();
  }
});
