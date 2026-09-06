const source = document.querySelector("event-source");
const endpoint = document.querySelector("#endpoint");
const state = document.querySelector("[data-testid='connection-state']");
const transport = document.querySelector("[data-testid='transport']");
const eventLog = document.querySelector("[data-testid='event-log']");

const queryEndpoint = new URLSearchParams(location.search).get("endpoint");
if (queryEndpoint) {
  endpoint.value = queryEndpoint;
  source.setAttribute("url", queryEndpoint);
}

const formatData = (data) => {
  if (data instanceof Error) return `${data.name}: ${data.message}`;
  if (typeof data === "string") return data;
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
};

const logEvent = (event) => {
  transport.textContent = event.detail.metadata.transport;
  const metadata = event.detail.metadata;
  const suffix = metadata.lastEventId ? ` · id ${metadata.lastEventId}` : "";
  const entry = document.createElement("li");
  entry.innerHTML = `<span>${event.type}${suffix}</span><code></code>`;
  entry.querySelector("code").textContent = formatData(event.detail.data);
  eventLog.prepend(entry);
};

// These globals are called by the declarative onopen and onmessage attributes.
globalThis.OnEventSourceOpen = (event) => {
  state.textContent = "Open";
  state.dataset.state = "open";
  logEvent(event);
};
globalThis.OnEventSourceMessage = logEvent;
source.addEventListener("error", (event) => {
  state.textContent = source.readyState === source.CONNECTING ? "Reconnecting" : "Error";
  state.dataset.state = "error";
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
  source.setAttribute("url", endpoint.value.trim());
  state.textContent = "Connecting";
  state.dataset.state = "connecting";
  try {
    source.open();
  } catch (error) {
    reportCaughtError(error);
  }
});

document.querySelector("#close").addEventListener("click", () => {
  source.close();
  state.textContent = "Closed";
  state.dataset.state = "closed";
});

document.querySelector("#remove").addEventListener("click", () => {
  source.remove();
  state.textContent = "Removed";
  state.dataset.state = "removed";
  for (const button of document.querySelectorAll(".socket-actions button")) {
    button.disabled = true;
  }
});
