import {
  EventSourceSession,
  EVENT_SOURCE_CLOSED,
} from "./event-source-session.js";

const serializeError = (value) => ({
  name: typeof value?.name === "string" ? value.name : "Error",
  message:
    typeof value?.message === "string" && value.message
      ? value.message
      : "EventSource error",
});

export const createEventSourceWorkerRuntime = (
  scope,
  { Session = EventSourceSession } = {},
) => {
  const session = new Session({
    emit(type, data) {
      if (type === "state") {
        scope.postMessage({ type: "state", data });
        return;
      }
      scope.postMessage({
        type: "event",
        name: type,
        data: type === "error" && data instanceof Error ? serializeError(data) : data,
      });
    },
  });

  const handleMessage = (event) => {
    const command = event.data;
    try {
      switch (command?.type) {
        case "open":
          session.open(command.data);
          break;
        case "close":
          session.close();
          break;
        case "dispose":
          session.dispose();
          scope.removeEventListener("message", handleMessage);
          break;
        default:
          throw new TypeError(`Unknown EventSource Worker command: ${command?.type}`);
      }
    } catch (error) {
      scope.postMessage({
        type: "event",
        name: "error",
        data: serializeError(error),
      });
      scope.postMessage({
        type: "state",
        data: { readyState: EVENT_SOURCE_CLOSED },
      });
    }
  };

  scope.addEventListener("message", handleMessage);
  // Readiness guarantees that queued commands cannot beat runtime initialization.
  scope.postMessage({ type: "ready" });
  return session;
};

const isDedicatedWorker =
  typeof WorkerGlobalScope !== "undefined" &&
  globalThis instanceof WorkerGlobalScope;

if (isDedicatedWorker) createEventSourceWorkerRuntime(globalThis);
