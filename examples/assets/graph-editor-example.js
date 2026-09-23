const editor = document.querySelector("#editor");
const audio = document.querySelector("#audio");
const recorder = document.querySelector("#recorder");
const start = document.querySelector("#start");
const requestData = document.querySelector("#request-data");
const close = document.querySelector("#close");
const state = document.querySelector('[data-testid="graph-audio-state"]');
const operation = document.querySelector('[data-testid="last-operation"]');
const actionCount = document.querySelector('[data-testid="action-count"]');
const actionLog = document.querySelector('[data-testid="action-log"]');
const markup = document.querySelector('[data-testid="serialized-markup"]');
const errorOutput = document.querySelector("#graph-error");
let handledChunks = 0;

const updateMarkup = () => {
  markup.textContent = editor.serialize();
};

const showError = (error) => {
  errorOutput.textContent = `${error.name}: ${error.message}`;
};

globalThis.SaveChunk = (event) => {
  handledChunks += 1;
  actionCount.textContent = String(handledChunks);
  const item = document.createElement("li");
  const label = document.createElement("span");
  label.textContent = event.detail.metadata.sourceEvent;
  const value = document.createElement("code");
  value.textContent = `${event.detail.data.size} byte Blob`;
  item.append(label, value);
  actionLog.prepend(item);
};

editor.addEventListener("ready", () => {
  errorOutput.textContent = "";
  updateMarkup();
});
editor.addEventListener("change", (event) => {
  // Ignore native controls crossing the shadow boundary; editor mutations target the host.
  if (event.target !== editor || !event.detail?.metadata) return;
  errorOutput.textContent = "";
  operation.textContent = event.detail.metadata.operation;
  updateMarkup();
});
editor.addEventListener("error", (event) => showError(event.detail.data));

// The custom element may upgrade before this module runs, so initialize independently of `ready`.
updateMarkup();

start.addEventListener("click", async () => {
  try {
    errorOutput.textContent = "";
    await audio.resume();
    state.textContent = "Running";
    start.disabled = true;
    requestData.disabled = false;
  } catch (error) {
    showError(error);
  }
});

requestData.addEventListener("click", () => {
  try {
    recorder.requestData();
  } catch (error) {
    showError(error);
  }
});

close.addEventListener("click", async () => {
  try {
    await audio.close();
  } catch (error) {
    showError(error);
  } finally {
    state.textContent = "Closed";
    start.disabled = true;
    requestData.disabled = true;
    close.disabled = true;
  }
});
