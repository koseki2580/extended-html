const editor = document.querySelector("#handler-editor");
const audio = document.querySelector("#handler-audio");
const tone = document.querySelector("#tone");
const recorder = document.querySelector("#recorder");
const start = document.querySelector("#start-handler");
const requestData = document.querySelector("#request-handler-data");
const close = document.querySelector("#close-handler");
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

const appendResult = (handler, event) => {
  const data = event.detail.data;
  const item = document.createElement("li");
  const label = document.createElement("span");
  const detail = document.createElement("code");
  label.textContent = `${handler} handler`;
  detail.textContent = JSON.stringify({
    data: {
      kind: data instanceof Blob ? "Blob" : typeof data,
      size: data instanceof Blob ? data.size : null,
      type: data instanceof Blob ? data.type : null,
    },
    metadata: event.detail.metadata,
  });
  item.append(label, detail);
  results.prepend(item);
};

// Application code is reviewed and loaded as a module; the graph stores only these paths.
globalThis.CustomHandlers = Object.freeze({
  Measure(event) {
    measured += 1;
    measureCount.textContent = String(measured);
    appendResult("Measure", event);
  },
  Audit(event) {
    audited += 1;
    auditCount.textContent = String(audited);
    appendResult("Audit", event);
  },
});

// Newly added actions use this valid placeholder until the Inspector changes their handler.
globalThis.HandleGraphEvent = (event) => appendResult("Default", event);

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
  if (event.target === editor && event.detail?.metadata) updateMarkup();
});
editor.addEventListener("error", (event) => showError(event.detail.data));

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
    releaseTone();
  }
});

toneUrl = createToneUrl();
tone.src = toneUrl;
updateMarkup();
window.addEventListener("beforeunload", releaseTone, { once: true });
