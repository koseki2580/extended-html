const socket = document.querySelector("web-socket");
const endpoint = document.querySelector("#endpoint");
const message = document.querySelector("#message");
const state = document.querySelector("[data-testid='connection-state']");
const transport = document.querySelector("[data-testid='transport']");
const eventLog = document.querySelector("[data-testid='event-log']");

const queryEndpoint = new URLSearchParams(location.search).get("endpoint");
if (queryEndpoint) {
  endpoint.value = queryEndpoint;
  socket.setAttribute("url", queryEndpoint);
}

const formatData = (data) => {
  if (data instanceof Event) return data.type;
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

const logEvent = (event) => {
  transport.textContent = event.detail.metadata.transport;
  const entry = document.createElement("li");
  entry.innerHTML = `<span>${event.type}</span><code></code>`;
  entry.querySelector("code").textContent = formatData(event.detail.data);
  eventLog.prepend(entry);
};

// These globals are called by the declarative onopen and onmessage attributes.
globalThis.OnOpen = (event) => {
  state.textContent = "Open";
  state.dataset.state = "open";
  logEvent(event);
};
globalThis.OnMessage = logEvent;
socket.addEventListener("error", (event) => {
  state.textContent = "Error";
  state.dataset.state = "error";
  logEvent(event);
});
socket.addEventListener("close", (event) => {
  state.textContent = "Closed";
  state.dataset.state = "closed";
  logEvent(event);
});

const reportCaughtError = (error) => {
  state.textContent = "Error";
  state.dataset.state = "error";
  const entry = document.createElement("li");
  entry.innerHTML = `<span>caught</span><code></code>`;
  entry.querySelector("code").textContent = `${error.name}: ${error.message}`;
  eventLog.prepend(entry);
};

document.querySelector("#open").addEventListener("click", () => {
  socket.setAttribute("url", endpoint.value.trim());
  state.textContent = "Connecting";
  state.dataset.state = "connecting";
  try {
    socket.open();
  } catch (error) {
    reportCaughtError(error);
  }
});

document.querySelector("#send").addEventListener("click", () => {
  try {
    socket.send(message.value);
  } catch (error) {
    reportCaughtError(error);
  }
});

document.querySelector("#close").addEventListener("click", () => {
  socket.close();
});

document.querySelector("#remove").addEventListener("click", () => {
  socket.remove();
  state.textContent = "Removed";
  state.dataset.state = "removed";
  for (const button of document.querySelectorAll(".socket-actions button")) {
    button.disabled = true;
  }
});
