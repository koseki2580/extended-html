const editor = document.querySelector("#handler-editor");
let audio = document.querySelector("#handler-audio");
let tone = document.querySelector("#tone");
let recorder = document.querySelector("#recorder");
const start = document.querySelector("#start-handler");
const requestData = document.querySelector("#request-handler-data");
const close = document.querySelector("#close-handler");
const restart = document.querySelector("#restart-handler");
const state = document.querySelector('[data-testid="handler-audio-state"]');
const measureCount = document.querySelector('[data-testid="measure-count"]');
const auditCount = document.querySelector('[data-testid="audit-count"]');
const results = document.querySelector('[data-testid="handler-results"]');
const markup = document.querySelector('[data-testid="serialized-handler-markup"]');
const errorOutput = document.querySelector("#handler-error");

let toneUrl = null;
let measured = 0;
let audited = 0;

const createToneUrl = () => {
  // Generate a local PCM tone so the example has no network or media dependency.
  const sampleRate = 44100;
  const seconds = 2;
  const samples = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + samples * 2);
  const view = new DataView(buffer);
  const writeText = (offset, text) => {
    for (let index = 0; index < text.length; index += 1) {
      view.setUint8(offset + index, text.charCodeAt(index));
    }
  };

  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples * 2, true);
  for (let index = 0; index < samples; index += 1) {
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate);
    view.setInt16(44 + index * 2, Math.round(sample * 0x1000), true);
  }
  return URL.createObjectURL(new Blob([buffer], { type: "audio/wav" }));
};

const appendResult = (action, phase, event) => {
  const data = event.detail.data;
  const item = document.createElement("li");
  const label = document.createElement("span");
  const detail = document.createElement("code");
  const name = action.getAttribute("handler")?.split("(")[0].trim().split(".").at(-1) ?? "Action";
  label.textContent = `${name} handler · #${action.id} · ${phase}`;
  const preview = {
    data: data instanceof Blob ? { kind: "Blob", size: data.size, type: data.type } : data,
    metadata: event.detail.metadata,
  };
  try {
    detail.textContent = JSON.stringify(preview);
  } catch {
    detail.textContent = String(data);
  }
  item.append(label, detail);
  results.prepend(item);
};

// Action events do not bubble, so watch each current and newly added action.
const watchedActions = new WeakSet();
const watchActions = () => {
  for (const action of editor.querySelectorAll(":scope > graph-action")) {
    if (watchedActions.has(action)) continue;
    watchedActions.add(action);
    action.addEventListener("run", (event) => appendResult(action, "input", event));
    action.addEventListener("data", (event) => appendResult(action, "output", event));
  }
};
new MutationObserver(watchActions).observe(editor, { childList: true });
watchActions();

// Application code stays in this reviewed module; only stable references enter the graph.
const CustomHandlers = Object.freeze({
  Measure(event) {
    measured += 1;
    measureCount.textContent = String(measured);
    // A returned value becomes this action's data output for connected actions.
    return { size: event.detail.data.size, type: event.detail.data.type };
  },
  Audit(event) {
    audited += 1;
    auditCount.textContent = String(audited);
  },
  Label(event) {
    const summary = { ...event.detail.data, label: "Review" };
    return summary;
  },
});

editor.registerFunction("CustomHandlers.Measure", CustomHandlers.Measure, {
  label: "Measure recording",
  description: "Returns the recorded Blob summary",
});
editor.registerFunction("CustomHandlers.Audit", CustomHandlers.Audit, {
  label: "Audit recording",
  description: "Records delivery metadata",
});
editor.registerFunction("CustomHandlers.Label", CustomHandlers.Label, {
  label: "Label summary",
  description: "Adds a visible label to the Measure summary",
});

const updateMarkup = () => {
  // Keep generated runtime resources out of the portable markup users copy.
  const template = document.createElement("template");
  template.innerHTML = editor.serialize();
  template.content.querySelector("#tone")?.removeAttribute("src");
  markup.textContent = template.innerHTML.trim();
};

const showError = (error) => {
  errorOutput.textContent = `${error.name}: ${error.message}`;
};

const releaseTone = () => {
  if (toneUrl === null) return;
  URL.revokeObjectURL(toneUrl);
  toneUrl = null;
};

editor.addEventListener("ready", updateMarkup);
editor.addEventListener("change", (event) => {
  if (event.target === editor && event.detail?.metadata) {
    errorOutput.textContent = "";
    updateMarkup();
  }
});
editor.addEventListener("error", (event) => showError(event.detail.data));

start.addEventListener("click", async () => {
  try {
    errorOutput.textContent = "";
    await audio.resume();
    state.textContent = "Running";
    start.disabled = true;
    requestData.disabled = false;
    close.disabled = false;
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
    restart.hidden = false;
    releaseTone();
  }
});

restart.addEventListener("click", () => {
  try {
    // A closed AudioContext cannot resume; replace only that subtree and keep Actions.
    const replacement = audio.cloneNode(true);
    replacement.querySelector("#tone")?.removeAttribute("src");
    audio.replaceWith(replacement);
    audio = replacement;
    tone = replacement.querySelector("#tone");
    recorder = replacement.querySelector("#recorder");
    toneUrl = createToneUrl();
    tone.src = toneUrl;
    state.textContent = "Suspended";
    start.disabled = false;
    requestData.disabled = true;
    close.disabled = true;
    restart.hidden = true;
    measured = 0;
    audited = 0;
    measureCount.textContent = "0";
    auditCount.textContent = "0";
    results.replaceChildren();
    errorOutput.textContent = "";
    updateMarkup();
  } catch (error) {
    showError(error);
  }
});

toneUrl = createToneUrl();
tone.src = toneUrl;
updateMarkup();
window.addEventListener("beforeunload", releaseTone, { once: true });
