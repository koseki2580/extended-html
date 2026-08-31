const context = document.querySelector("audio-context");
const mic = document.querySelector("audio-input-mic");
const music = document.querySelector("audio-input-file");
const recorder = document.querySelector("media-recorder");
const state = document.querySelector("[data-testid='audio-state']");
const recordingState = document.querySelector("[data-testid='recording-state']");
const downloadRecording = document.querySelector("#download-recording");
const errorMessage = document.querySelector("#audio-error");
const actions = document.querySelector("[data-audio-actions]");
const startButton = document.querySelector("#start");
const suspendButton = document.querySelector("#suspend");
const resumeButton = document.querySelector("#resume");
const closeButton = document.querySelector("#close");
const eventLog = document.querySelector("[data-testid='event-log']");
const inputDevice = document.querySelector("#input-device");
const outputDevice = document.querySelector("#output-device");
const inputDeviceStatus = document.querySelector("#input-device-status");
const outputDeviceStatus = document.querySelector("#output-device-status");
const micFilter = document.querySelector("#mic-filter");
const fileFilter = document.querySelector("#file-filter");
const micFilterType = document.querySelector("#mic-filter-type");
const fileFilterType = document.querySelector("#file-filter-type");
const micFilterFrequency = document.querySelector("#mic-filter-frequency");
const fileFilterFrequency = document.querySelector("#file-filter-frequency");
const micFilterValue = document.querySelector("#mic-filter-value");
const fileFilterValue = document.querySelector("#file-filter-value");

const CHOOSE_OUTPUT = "__choose__";
const mediaDevices = navigator.mediaDevices;
const NativeAudioContext = globalThis.AudioContext ?? globalThis.webkitAudioContext;
const canEnumerateDevices = typeof mediaDevices?.enumerateDevices === "function";
const canSelectOutput =
  typeof mediaDevices?.selectAudioOutput === "function" &&
  typeof NativeAudioContext?.prototype?.setSinkId === "function";

let started = false;
let terminal = false;
let busy = false;
let toneUrl = null;
let recordingUrl = null;
let recordedChunks = [];

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

const releaseRecordingUrl = () => {
  if (recordingUrl === null) return;
  URL.revokeObjectURL(recordingUrl);
  recordingUrl = null;
  downloadRecording.removeAttribute("href");
  downloadRecording.hidden = true;
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
  if (data instanceof Blob) {
    return { kind: "Blob", size: data.size, type: data.type };
  }
  if (data instanceof Event) return { type: data.type };
  if (data && typeof data === "object" && "stream" in data) {
    return { ...data, stream: describeData(data.stream) };
  }
  if (data && typeof data === "object" && "event" in data) {
    return { ...data, event: describeData(data.event) };
  }
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

const renderState = () => {
  const value = context.state;
  state.textContent = `${value[0].toUpperCase()}${value.slice(1)}`;
  state.dataset.state = value;
};

const renderRecordingState = () => {
  const value = recorder.state;
  recordingState.textContent = `${value[0].toUpperCase()}${value.slice(1)}`;
  recordingState.dataset.state = value;
};

const prepareRecordingDownload = () => {
  if (recordedChunks.length === 0) return;
  releaseRecordingUrl();
  const type = recorder.mimeType || recordedChunks[0].type || "audio/webm";
  recordingUrl = URL.createObjectURL(new Blob(recordedChunks, { type }));
  downloadRecording.href = recordingUrl;
  downloadRecording.hidden = false;
};

const updateControls = () => {
  actions.setAttribute("aria-busy", String(busy));
  startButton.disabled = busy || started || terminal;
  suspendButton.disabled = busy || terminal || context.state !== "running";
  resumeButton.disabled =
    busy || terminal || !started || context.state !== "suspended";
  closeButton.disabled = busy || terminal;
  inputDevice.disabled = terminal || !canEnumerateDevices;
  outputDevice.disabled = terminal || !canSelectOutput;
};

const runAction = async (action, { recoveryFocus = null } = {}) => {
  // Serialize user gestures at the page boundary while the context owns source order.
  if (busy || terminal) return;
  busy = true;
  errorMessage.textContent = "";
  updateControls();
  let failed = false;
  try {
    await action();
  } catch (error) {
    failed = true;
    errorMessage.textContent = `${error.name}: ${error.message}`;
  } finally {
    busy = false;
    renderState();
    updateControls();
    if (failed && recoveryFocus !== null && !recoveryFocus.disabled) {
      recoveryFocus.focus();
    }
  }
};

const replaceDeviceOptions = (
  select,
  devices,
  { kind, selectedId, defaultLabel, fallbackLabel, includeChooser = false },
) => {
  const options = [new Option(defaultLabel, "")];
  const matching = devices.filter((device) => device.kind === kind);
  matching.forEach((device, index) => {
    options.push(
      new Option(device.label || `${fallbackLabel} ${index + 1}`, device.deviceId),
    );
  });
  if (selectedId && !matching.some((device) => device.deviceId === selectedId)) {
    options.push(new Option(`${fallbackLabel} unavailable`, selectedId));
  }
  if (includeChooser) {
    options.push(new Option("Choose another speaker…", CHOOSE_OUTPUT));
  }
  select.replaceChildren(...options);
  select.value = selectedId;
};

const refreshDevices = async () => {
  if (!canEnumerateDevices) {
    inputDevice.disabled = true;
    outputDevice.disabled = true;
    inputDeviceStatus.textContent = "Device enumeration is not supported here.";
    outputDeviceStatus.textContent = "Output selection is not supported here.";
    return;
  }

  try {
    const devices = await mediaDevices.enumerateDevices();
    replaceDeviceOptions(inputDevice, devices, {
      kind: "audioinput",
      selectedId: mic.deviceId,
      defaultLabel: "Default microphone",
      fallbackLabel: "Microphone",
    });
    inputDevice.disabled = terminal;
    inputDeviceStatus.textContent =
      "Labels may appear after microphone permission is granted.";

    if (canSelectOutput) {
      replaceDeviceOptions(outputDevice, devices, {
        kind: "audiooutput",
        selectedId: context.sinkId,
        defaultLabel: "Default speaker",
        fallbackLabel: "Speaker",
        includeChooser: true,
      });
      outputDevice.disabled = terminal;
      outputDeviceStatus.textContent = "Choose another speaker opens browser permission UI.";
    } else {
      outputDevice.disabled = true;
      outputDeviceStatus.textContent =
        "This browser does not support explicit output selection.";
    }
  } catch (error) {
    inputDevice.disabled = true;
    outputDevice.disabled = true;
    inputDeviceStatus.textContent = `${error.name}: ${error.message}`;
    outputDeviceStatus.textContent = "Device lists could not be refreshed.";
  }
};

const runDeviceSelection = async (control, operation) => {
  control.disabled = true;
  errorMessage.textContent = "";
  try {
    await operation();
  } catch (error) {
    errorMessage.textContent = `${error.name}: ${error.message}`;
  } finally {
    await refreshDevices();
  }
};

const bindFilterControls = (filter, typeControl, frequencyControl, value) => {
  typeControl.addEventListener("change", () => {
    filter.type = typeControl.value;
  });
  frequencyControl.addEventListener("input", () => {
    filter.setAttribute("frequency", frequencyControl.value);
    value.value = `${frequencyControl.value} Hz`;
  });
};

for (const type of ["statechange", "sinkchange", "error"]) {
  context.addEventListener(type, (event) => {
    logEvent(event);
    if (type === "statechange") {
      renderState();
      updateControls();
    }
    if (type === "error") {
      errorMessage.textContent = `${event.detail.data.name}: ${event.detail.data.message}`;
    }
  });
}
for (const type of ["open", "close", "devicechange", "error"]) {
  mic.addEventListener(type, logEvent);
}
for (const type of ["play", "playing", "pause", "ended", "error"]) {
  music.addEventListener(type, logEvent);
}
for (const type of ["start", "dataavailable", "pause", "resume", "stop", "error"]) {
  recorder.addEventListener(type, (event) => {
    // The page aggregates native chunks; the custom element keeps native semantics.
    if (type === "start") {
      releaseRecordingUrl();
      recordedChunks = [];
    } else if (type === "dataavailable" && event.detail.data.size > 0) {
      recordedChunks.push(event.detail.data);
    } else if (type === "stop") {
      prepareRecordingDownload();
    }
    renderRecordingState();
    logEvent(event);
  });
}

startButton.addEventListener("click", () => {
  started = true;
  runAction(
    async () => {
      await context.resume();
      await refreshDevices();
    },
    { recoveryFocus: resumeButton },
  );
});
suspendButton.addEventListener("click", () => runAction(() => context.suspend()));
resumeButton.addEventListener("click", () =>
  runAction(() => context.resume(), { recoveryFocus: resumeButton }),
);
closeButton.addEventListener("click", () =>
  runAction(async () => {
    try {
      await context.close();
    } finally {
      // A close request is terminal even when native cleanup reports a failure.
      terminal = true;
      releaseToneUrl();
    }
  }),
);

inputDevice.addEventListener("change", () => {
  runDeviceSelection(inputDevice, () => mic.setDeviceId(inputDevice.value));
});

outputDevice.addEventListener("change", () => {
  runDeviceSelection(outputDevice, async () => {
    let sinkId = outputDevice.value;
    if (sinkId === CHOOSE_OUTPUT) {
      const selected = await mediaDevices.selectAudioOutput();
      sinkId = selected.deviceId;
    }
    await context.setSinkId(sinkId);
  });
});

bindFilterControls(
  micFilter,
  micFilterType,
  micFilterFrequency,
  micFilterValue,
);
bindFilterControls(
  fileFilter,
  fileFilterType,
  fileFilterFrequency,
  fileFilterValue,
);
mediaDevices?.addEventListener?.("devicechange", refreshDevices);

toneUrl = createToneUrl();
music.src = toneUrl;
window.addEventListener(
  "beforeunload",
  () => {
    releaseToneUrl();
    releaseRecordingUrl();
  },
  { once: true },
);
renderState();
renderRecordingState();
updateControls();
refreshDevices();
