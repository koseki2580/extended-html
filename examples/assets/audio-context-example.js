const context = document.querySelector("audio-context");
const mic = document.querySelector("audio-input-mic");
const music = document.querySelector("audio-input-file");
const state = document.querySelector("[data-testid='audio-state']");
const errorMessage = document.querySelector("#audio-error");
const actions = document.querySelector("[data-audio-actions]");
const startButton = document.querySelector("#start");
const suspendButton = document.querySelector("#suspend");
const resumeButton = document.querySelector("#resume");
const closeButton = document.querySelector("#close");
const eventLog = document.querySelector("[data-testid='event-log']");

let started = false;
let closed = false;
let busy = false;
let toneUrl = null;

const createToneUrl = () => {
  // Generate a self-contained PCM tone so the public example needs no media asset.
  const sampleRate = 44100;
  const seconds = 1;
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

const releaseToneUrl = () => {
  if (toneUrl === null) return;
  URL.revokeObjectURL(toneUrl);
  toneUrl = null;
};

const describeData = (data) => {
  if (data instanceof Error) return { name: data.name, message: data.message };
  if (data instanceof MediaStream) {
    return {
      kind: "MediaStream",
      tracks: data.getTracks().map(({ enabled, readyState }) => ({
        enabled,
        readyState,
      })),
    };
  }
  if (data instanceof Event) return { type: data.type };
  return data ?? null;
};

const logEvent = (event) => {
  const entry = document.createElement("li");
  const label = event.detail.metadata.nodeId ?? event.detail.metadata.nodeName;
  const envelope = {
    data: describeData(event.detail.data),
    metadata: event.detail.metadata,
  };
  entry.innerHTML = `<span></span><code></code>`;
  entry.querySelector("span").textContent = `${label} · ${event.type}`;
  entry.querySelector("code").textContent = JSON.stringify(envelope);
  eventLog.prepend(entry);
};

const displayState = (value) => {
  state.textContent = `${value[0].toUpperCase()}${value.slice(1)}`;
  state.dataset.state = value;
};

const updateControls = () => {
  actions.setAttribute("aria-busy", String(busy));
  startButton.disabled = busy || started || closed;
  suspendButton.disabled = busy || closed || context.state !== "running";
  resumeButton.disabled = busy || closed || !started || context.state !== "suspended";
  closeButton.disabled = busy || closed;
};

const runAction = async (action) => {
  // Serialize user gestures at the page boundary while the context owns source order.
  if (busy || closed) return;
  busy = true;
  errorMessage.textContent = "";
  updateControls();
  try {
    await action();
    displayState(context.state);
  } catch (error) {
    displayState("error");
    errorMessage.textContent = `${error.name}: ${error.message}`;
  } finally {
    busy = false;
    updateControls();
  }
};

for (const type of ["statechange", "error"]) {
  context.addEventListener(type, (event) => {
    logEvent(event);
    if (type === "error") {
      errorMessage.textContent = `${event.detail.data.name}: ${event.detail.data.message}`;
    }
  });
}
for (const type of ["open", "close", "error"]) {
  mic.addEventListener(type, logEvent);
}
for (const type of ["play", "playing", "pause", "ended", "error"]) {
  music.addEventListener(type, logEvent);
}

startButton.addEventListener("click", () => {
  started = true;
  runAction(() => context.resume());
});
suspendButton.addEventListener("click", () => runAction(() => context.suspend()));
resumeButton.addEventListener("click", () => runAction(() => context.resume()));
closeButton.addEventListener("click", () =>
  runAction(async () => {
    await context.close();
    closed = true;
    releaseToneUrl();
  }),
);

toneUrl = createToneUrl();
music.src = toneUrl;
window.addEventListener("beforeunload", releaseToneUrl, { once: true });
updateControls();
