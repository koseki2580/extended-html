import { AudioContextElement } from "./audio-context.js";
import { AudioInputMicElement } from "./audio-input-mic.js";
import { AudioInputFileElement } from "./audio-input-file.js";
import { AudioBiquadFilterElement } from "./audio-biquad-filter.js";
import { AudioOutputElement } from "./audio-output.js";

const AUDIO_ELEMENTS = [
  ["audio-context", AudioContextElement],
  ["audio-input-mic", AudioInputMicElement],
  ["audio-input-file", AudioInputFileElement],
  ["audio-biquad-filter", AudioBiquadFilterElement],
  ["audio-output", AudioOutputElement],
];

for (const [name, constructor] of AUDIO_ELEMENTS) {
  // Guard each definition so aggregate and subpath imports can safely coexist.
  if (!customElements.get(name)) customElements.define(name, constructor);
}
