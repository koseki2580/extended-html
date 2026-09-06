import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer } from "ws";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../..",
);

const MIME_TYPES = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"],
]);

const createToneWav = () => {
  const sampleRate = 44100;
  const durationSeconds = 1;
  const sampleCount = sampleRate * durationSeconds;
  const bytesPerSample = 2;
  const dataSize = sampleCount * bytesPerSample;
  const wav = Buffer.alloc(44 + dataSize);

  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * bytesPerSample, 28);
  wav.writeUInt16LE(bytesPerSample, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);

  for (let index = 0; index < sampleCount; index += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    wav.writeInt16LE(Math.round(sample * 0x1999), 44 + index * bytesPerSample);
  }
  return wav;
};

const TONE_WAV_PATH = "/tests/e2e/fixtures/tone.wav";
const TONE_WAV = createToneWav();

const isAllowedPath = (pathname) =>
  pathname === "/" ||
  pathname === "/index.html" ||
  pathname === "/favicon.ico" ||
  ["/src/", "/examples/", "/guide/", "/tests/e2e/fixtures/"].some((prefix) =>
    pathname.startsWith(prefix),
  );

const createQueue = () => {
  const values = [];
  const waiters = [];
  return {
    push(value) {
      const resolve = waiters.shift();
      if (resolve) resolve(value);
      else values.push(value);
    },
    next() {
      if (values.length > 0) return Promise.resolve(values.shift());
      return new Promise((resolve) => waiters.push(resolve));
    },
  };
};

export const startTestServer = async () => {
  const connections = new Set();
  const connectionQueue = createQueue();
  const messageQueues = new WeakMap();
  const closeQueues = new WeakMap();
  const eventSources = new Set();
  const eventSourceQueue = createQueue();
  const eventSourceCloseQueues = new WeakMap();

  const httpServer = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
      if (pathname === "/events") {
        response.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
        });
        response.flushHeaders();
        const eventSource = {
          request,
          response,
          lastEventId: request.headers["last-event-id"] ?? "",
        };
        const closes = createQueue();
        eventSources.add(eventSource);
        eventSourceCloseQueues.set(eventSource, closes);
        request.once("close", () => {
          eventSources.delete(eventSource);
          closes.push(undefined);
        });
        eventSourceQueue.push(eventSource);
        return;
      }
      if (!isAllowedPath(pathname)) {
        response.writeHead(404).end("Not found");
        return;
      }
      if (pathname === "/favicon.ico") {
        response.writeHead(204).end();
        return;
      }
      if (pathname === TONE_WAV_PATH) {
        response.writeHead(200, {
          "content-type": "audio/wav",
          "content-length": TONE_WAV.length,
          "cache-control": "no-store",
        });
        response.end(request.method === "HEAD" ? undefined : TONE_WAV);
        return;
      }

      let filePath = path.resolve(repositoryRoot, `.${pathname}`);
      if (
        filePath !== repositoryRoot &&
        !filePath.startsWith(`${repositoryRoot}${path.sep}`)
      ) {
        response.writeHead(403).end("Forbidden");
        return;
      }
      if ((await stat(filePath)).isDirectory()) filePath = path.join(filePath, "index.html");
      const body = await readFile(filePath);
      response.writeHead(200, {
        "content-type": MIME_TYPES.get(path.extname(filePath)) ?? "application/octet-stream",
        "cache-control": "no-store",
      });
      response.end(body);
    } catch (error) {
      const status = error?.code === "ENOENT" ? 404 : 500;
      response.writeHead(status).end(status === 404 ? "Not found" : "Server error");
    }
  });

  const webSocketServer = new WebSocketServer({ server: httpServer, path: "/socket" });
  webSocketServer.on("connection", (connection) => {
    connections.add(connection);
    const messages = createQueue();
    const closes = createQueue();
    messageQueues.set(connection, messages);
    closeQueues.set(connection, closes);
    connection.on("message", (data, isBinary) => {
      messages.push({
        data: isBinary ? Buffer.from(data) : data.toString(),
        isBinary,
      });
    });
    connection.on("close", (code, reason) => {
      connections.delete(connection);
      closes.push({ code, reason: reason.toString() });
    });
    connectionQueue.push(connection);
  });

  await new Promise((resolve, reject) => {
    httpServer.once("error", reject);
    httpServer.listen(0, "127.0.0.1", resolve);
  });
  const address = httpServer.address();
  const httpUrl = `http://127.0.0.1:${address.port}`;

  return {
    httpUrl,
    wsUrl: `ws://127.0.0.1:${address.port}/socket`,
    sseUrl: `${httpUrl}/events`,
    waitForConnection: () => connectionQueue.next(),
    waitForMessage(connection) {
      return messageQueues.get(connection).next();
    },
    waitForClose(connection) {
      return closeQueues.get(connection).next();
    },
    send(connection, data, options) {
      connection.send(data, options);
    },
    close(connection, code = 1000, reason = "server close") {
      connection.close(code, reason);
    },
    waitForEventSource: () => eventSourceQueue.next(),
    waitForEventSourceClose(eventSource) {
      return eventSourceCloseQueues.get(eventSource).next();
    },
    sendEvent(
      eventSource,
      { data, event = null, id = null, retry = null },
    ) {
      const lines = [];
      if (event !== null) lines.push(`event: ${event}`);
      if (id !== null) lines.push(`id: ${id}`);
      if (retry !== null) lines.push(`retry: ${retry}`);
      for (const line of String(data).split(/\r?\n/)) lines.push(`data: ${line}`);
      eventSource.response.write(`${lines.join("\n")}\n\n`);
    },
    closeEventSource(eventSource) {
      eventSource.response.end();
    },
    async stop() {
      for (const eventSource of eventSources) eventSource.response.end();
      for (const connection of connections) connection.terminate();
      await new Promise((resolve) => webSocketServer.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
};
