import "../audio/index.js";
import { audioGraphAdapter } from "./audio-graph-adapter.js";
import { registerGraphAdapter } from "./graph-adapters.js";

registerGraphAdapter("audio-context", audioGraphAdapter);

export { audioGraphAdapter } from "./audio-graph-adapter.js";
export { registerGraphAdapter } from "./graph-adapters.js";
export { GraphActionElement } from "./graph-action.js";
export { GraphEditorElement } from "./graph-editor.js";
export { GraphEventElement } from "./graph-event.js";

import "./graph-event.js";
import "./graph-action.js";
import "./graph-editor.js";
