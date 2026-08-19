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

const isAllowedPath = (pathname) =>
  pathname === "/" ||
  pathname === "/index.html" ||
  pathname === "/favicon.ico" ||
  ["/src/", "/examples/", "/tests/e2e/fixtures/"].some((prefix) =>
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

  const httpServer = createServer(async (request, response) => {
    try {
      const pathname = decodeURIComponent(
        new URL(request.url, "http://127.0.0.1").pathname,
      );
      if (!isAllowedPath(pathname)) {
        response.writeHead(404).end("Not found");
        return;
      }
      if (pathname === "/favicon.ico") {
        response.writeHead(204).end();
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
    async stop() {
      for (const connection of connections) connection.terminate();
      await new Promise((resolve) => webSocketServer.close(resolve));
      await new Promise((resolve) => httpServer.close(resolve));
    },
  };
};
