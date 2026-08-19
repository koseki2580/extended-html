import { WorkerBridge } from "../../src/core/worker-bridge.js";

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const assertEqual = (actual, expected, message) => {
  assert(
    Object.is(actual, expected),
    `${message}: expected ${String(expected)}, received ${String(actual)}`,
  );
};

class FakeWorker extends EventTarget {
  messages = [];
  terminateCalls = 0;

  postMessage(message) {
    this.messages.push(message);
  }

  terminate() {
    this.terminateCalls += 1;
  }

  emitMessage(data) {
    this.dispatchEvent(new MessageEvent("message", { data }));
  }

  emitError() {
    this.dispatchEvent(new ErrorEvent("error", { message: "worker failed" }));
  }
}

describe("WorkerBridge", () => {
  it("loads a real module Worker and flushes messages queued before ready", async () => {
    const received = new Promise((resolve, reject) => {
      const bridge = new WorkerBridge(
        new URL("../fixtures/echo.worker.js", import.meta.url),
        {
          onMessage(message) {
            bridge.dispose();
            resolve(message);
          },
          onFailure(error) {
            bridge.dispose();
            reject(error);
          },
        },
      );
      bridge.postMessage({ greeting: "hello" });
    });

    const message = await received;
    assertEqual(message.type, "echo", "worker response is forwarded");
    assertEqual(message.data.greeting, "hello", "queued command reaches worker");
  });

  it("reports whether a Worker failure happened before or after ready", () => {
    const phases = [];
    const workers = [];
    const WorkerImpl = class {
      constructor() {
        const worker = new FakeWorker();
        workers.push(worker);
        return worker;
      }
    };

    new WorkerBridge("worker.js", {
      WorkerImpl,
      onFailure: (_error, phase) => phases.push(phase),
    });
    workers[0].emitError();

    new WorkerBridge("worker.js", {
      WorkerImpl,
      onFailure: (_error, phase) => phases.push(phase),
    });
    workers[1].emitMessage({ type: "ready" });
    workers[1].emitError();

    assertEqual(phases[0], "initialization", "pre-ready failure is identified");
    assertEqual(phases[1], "runtime", "post-ready failure is identified");
    assertEqual(workers[0].terminateCalls, 1, "failed worker is terminated");
    assertEqual(workers[1].terminateCalls, 1, "runtime failure is terminated");
  });
});
