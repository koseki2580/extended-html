import { test, expect } from "@playwright/test";
import WebSocket from "ws";
import { startTestServer } from "./support/test-server.js";

test("serves repository modules and exposes observable WebSocket traffic", async () => {
  const server = await startTestServer();
  try {
    const response = await fetch(`${server.httpUrl}/src/index.js`);
    expect(response.status).toBe(200);
    const aggregateSource = await response.text();
    expect(aggregateSource).toContain('import "./web-socket/web-socket.js"');
    expect(aggregateSource).toContain('import "./audio/index.js"');

    const audioEntry = await fetch(`${server.httpUrl}/src/audio/index.js`);
    expect(audioEntry.status).toBe(200);
    const audioEntrySource = await audioEntry.text();
    expect(audioEntrySource).toContain(
      'import { AudioContextElement } from "./audio-context.js"',
    );
    expect(audioEntrySource).toContain('["audio-context", AudioContextElement]');

    for (const moduleName of [
      "audio-context.js",
      "audio-event.js",
      "audio-graph-plan.js",
      "audio-graph-runtime.js",
      "audio-input-mic.js",
      "audio-input-file.js",
      "audio-biquad-filter.js",
      "audio-node-element.js",
      "audio-output.js",
    ]) {
      const moduleResponse = await fetch(
        `${server.httpUrl}/src/audio/${moduleName}`,
      );
      expect(moduleResponse.status, `${moduleName} is served`).toBe(200);
    }

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
