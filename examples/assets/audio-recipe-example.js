const context = document.querySelector("audio-context#audio");
const fileInput = context?.querySelector("audio-input-file");
const filter = context?.querySelector("audio-biquad-filter");
const streamOutput = context?.querySelector("audio-stream-output");
const recorder = context?.querySelector("media-recorder");
const preview = document.querySelector("audio#preview");
const state = document.querySelector("[data-testid='audio-state']");
const streamState = document.querySelector("[data-testid='stream-state']");
const recordingState = document.querySelector("[data-testid='recording-state']");
const chunkCount = document.querySelector("[data-testid='chunk-count']");
const errorMessage = document.querySelector("[role='alert']");
const startButton = document.querySelector("#start");
const suspendButton = document.querySelector("#suspend");
const resumeButton = document.querySelector("#resume");
const closeButton = document.querySelector("#close");
const requestButton = document.querySelector("#request-data");
const download = document.querySelector("#download-recording");
const frequency = document.querySelector("#frequency");
const frequencyValue = document.querySelector("#frequency-value");

let started = false;
let closed = false;
let busy = false;
let toneUrl = null;
let recordingUrl = null;
let chunks = [];

const createToneUrl = () => {
  // Generate a local PCM tone so this sample has no network or media dependency.
  const sampleRate = 44100;
  const samples = sampleRate * 2;
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

const labelState = (value) => `${value[0].toUpperCase()}${value.slice(1)}`;

const render = () => {
  state.textContent = labelState(context.state);
  if (recordingState) recordingState.textContent = labelState(recorder.state);
  startButton.disabled = busy || started || closed;
  suspendButton.disabled = busy || closed || context.state !== "running";
  resumeButton.disabled =
    busy || closed || !started || context.state !== "suspended";
  closeButton.disabled = busy || closed;
  if (requestButton) {
    requestButton.disabled = busy || recorder.state !== "recording";
  }
};

const run = async (operation) => {
  if (busy || closed) return;
  busy = true;
  errorMessage.textContent = "";
  render();
  try {
    await operation();
  } catch (error) {
    errorMessage.textContent = `${error.name}: ${error.message}`;
  } finally {
    busy = false;
    render();
  }
};

const exposeStream = () => {
  if (!streamOutput) return;
  const stream = streamOutput.stream;
  const audioTracks = stream.getAudioTracks();
  const suffix = audioTracks.length === 1 ? "" : "s";
  streamState.textContent =
    `MediaStream · ${audioTracks.length} audio track${suffix}`;
  if (preview) {
    // A muted native media element demonstrates that no adapter is required.
    preview.muted = true;
    preview.srcObject = stream;
  }
};

const releaseUrls = () => {
  if (toneUrl) URL.revokeObjectURL(toneUrl);
  if (recordingUrl) URL.revokeObjectURL(recordingUrl);
  toneUrl = null;
  recordingUrl = null;
};

if (fileInput) {
  toneUrl = createToneUrl();
  fileInput.src = toneUrl;
}

if (frequency) {
  frequency.addEventListener("input", () => {
    filter.setAttribute("frequency", frequency.value);
    frequencyValue.value = `${frequency.value} Hz`;
  });
}

if (recorder) {
  for (const type of ["start", "pause", "resume", "stop"]) {
    recorder.addEventListener(type, render);
  }
  recorder.addEventListener("start", () => {
    chunks = [];
    chunkCount.textContent = "0";
    download.hidden = true;
  });
  recorder.addEventListener("dataavailable", (event) => {
    chunks.push(event.detail.data);
    chunkCount.textContent = String(chunks.length);
  });
  recorder.addEventListener("stop", () => {
    if (chunks.length === 0) return;
    recordingUrl = URL.createObjectURL(
      new Blob(chunks, { type: recorder.mimeType || chunks[0].type }),
    );
    download.href = recordingUrl;
    download.hidden = false;
  });
}

startButton.addEventListener("click", () => {
  started = true;
  run(async () => {
    await context.resume();
    exposeStream();
  });
});
suspendButton.addEventListener("click", () => run(() => context.suspend()));
resumeButton.addEventListener("click", () =>
  run(async () => {
    await context.resume();
    exposeStream();
  }),
);
closeButton.addEventListener("click", () =>
  run(async () => {
    try {
      await context.close();
    } finally {
      closed = true;
      if (preview) preview.srcObject = null;
      if (toneUrl) {
        URL.revokeObjectURL(toneUrl);
        toneUrl = null;
      }
    }
  }),
);
requestButton?.addEventListener("click", () => recorder.requestData());
window.addEventListener("beforeunload", releaseUrls, { once: true });
render();
