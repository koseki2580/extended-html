import { WebSocketSession } from "./web-socket-session.js";

const CLOSED_READY_STATE = 3;

const serializeError = (value) => ({
  name: typeof value?.name === "string" ? value.name : "Error",
  message:
    typeof value?.message === "string" && value.message
      ? value.message
      : "WebSocket error",
});

export const createWebSocketWorkerRuntime = (
  scope,
  { Session = WebSocketSession } = {},
) => {
  const session = new Session({
    emit(type, data) {
      if (type === "state") {
        scope.postMessage({ type: "state", data: { readyState: data } });
        return;
      }
      scope.postMessage({
        type: "event",
        name: type,
        data: type === "error" ? serializeError(data) : data,
      });
    },
  });

  const handleMessage = (event) => {
    const command = event.data;
    try {
      switch (command?.type) {
        case "configure":
          session.configure(command.data);
          break;
        case "open":
          session.configure(command.data);
          session.open();
          break;
        case "send":
          session.send(command.data);
          break;
        case "close":
          session.close();
          break;
        case "dispose":
          session.dispose();
          scope.removeEventListener("message", handleMessage);
          break;
        default:
          throw new TypeError(`Unknown WebSocket Worker command: ${command?.type}`);
      }
    } catch (error) {
      scope.postMessage({
        type: "event",
        name: "error",
        data: serializeError(error),
      });
      scope.postMessage({
        type: "state",
        data: { readyState: CLOSED_READY_STATE },
      });
    }
  };

  scope.addEventListener("message", handleMessage);
  // Announce readiness only after the command listener and session exist.
  scope.postMessage({ type: "ready" });
  return session;
};

const isDedicatedWorker =
  typeof WorkerGlobalScope !== "undefined" &&
  globalThis instanceof WorkerGlobalScope;

if (isDedicatedWorker) createWebSocketWorkerRuntime(globalThis);
