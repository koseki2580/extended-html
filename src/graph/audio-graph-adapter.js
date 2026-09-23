import { buildAudioGraphPlan } from "../audio/audio-graph-plan.js";

const NODE_DEFINITIONS = new Map([
  [
    "audio-input-mic",
    {
      kind: "source",
      label: "Microphone",
      properties: ["device-id"],
      events: ["open", "close", "devicechange", "error"],
    },
  ],
  [
    "audio-input-file",
    {
      kind: "source",
      label: "Audio file",
      properties: ["src", "loop", "muted", "preload", "crossorigin"],
      events: ["play", "pause", "ended", "error"],
    },
  ],
  [
    "audio-biquad-filter",
    {
      kind: "processor",
      label: "Biquad filter",
      properties: ["type", "frequency", "detune", "q", "gain"],
      events: [],
    },
  ],
  [
    "audio-output",
    { kind: "output", label: "Speaker", properties: [], events: [] },
  ],
  [
    "audio-stream-output",
    { kind: "output", label: "Media stream", properties: [], events: [] },
  ],
  [
    "media-recorder",
    {
      kind: "consumer",
      label: "Media recorder",
      properties: ["mime-type", "audio-bits-per-second", "timeslice"],
      events: ["start", "dataavailable", "pause", "resume", "stop", "error"],
    },
  ],
]);

const SOURCE_TYPES = new Set(["audio-input-mic", "audio-input-file"]);

const syntaxError = (message) => new DOMException(message, "SyntaxError");

const requireRoot = (root) => {
  if (root?.localName !== "audio-context") {
    throw new TypeError("Audio graph adapter requires an <audio-context> root");
  }
};

const requireNode = (root, element) => {
  if (!(element instanceof Element) || !root.contains(element)) {
    throw new DOMException("Audio graph node is outside this root", "NotFoundError");
  }
  if (!NODE_DEFINITIONS.has(element.localName)) {
    throw new TypeError(`Unsupported audio graph node <${element.localName}>`);
  }
};

const nextId = (root, localName) => {
  let index = 1;
  let candidate = `${localName}-${index}`;
  while ([...root.querySelectorAll("[id]")].some((element) => element.id === candidate)) {
    index += 1;
    candidate = `${localName}-${index}`;
  }
  return candidate;
};

const positionFor = (element) => {
  const x = Number(element.dataset.graphX);
  const y = Number(element.dataset.graphY);
  return {
    x: Number.isFinite(x) ? x : null,
    y: Number.isFinite(y) ? y : null,
  };
};

const descriptorFor = (element, role) => {
  const definition = NODE_DEFINITIONS.get(element.localName);
  return {
    element,
    id: element.id,
    nodeName: element.localName,
    kind: role ?? definition.kind,
    label: definition.label,
    properties: definition.properties.map((name) => ({
      name,
      value: element.getAttribute(name),
    })),
    events: [...definition.events],
    position: positionFor(element),
  };
};

const restoreAttribute = (element, name, hadAttribute, value) => {
  if (hadAttribute) element.setAttribute(name, value);
  else element.removeAttribute(name);
};

const validate = (root) => buildAudioGraphPlan(root);

const validateNodeAddition = (root, localName, parent) => {
  requireRoot(root);
  if (!NODE_DEFINITIONS.has(localName) || localName === "media-recorder") {
    throw new TypeError(`Unsupported audio graph node type <${localName}>`);
  }
  if (SOURCE_TYPES.has(localName)) {
    if (parent !== null) throw syntaxError(`<${localName}> must be a root source`);
    return;
  }
  if (parent === null) {
    throw syntaxError(`Select a source or processor before adding <${localName}>`);
  }
  requireNode(root, parent);
  if (["audio-output", "audio-stream-output", "media-recorder"].includes(parent.localName)) {
    throw syntaxError(`<${parent.localName}> cannot contain <${localName}>`);
  }
};

export const audioGraphAdapter = {
  nodeTypes: [...NODE_DEFINITIONS.entries()]
    .filter(([localName]) => localName !== "media-recorder")
    .map(([localName, definition]) => ({
      localName,
      kind: definition.kind,
      label: definition.label,
    })),

  canAdd(root, localName, { parent = null } = {}) {
    try {
      validateNodeAddition(root, localName, parent);
      return { allowed: true, reason: "" };
    } catch (error) {
      return { allowed: false, reason: error.message };
    }
  },

  read(root) {
    requireRoot(root);
    const plan = validate(root);
    const descriptors = new Map();
    const nodes = plan.nodes.map(({ element, role }) => {
      const descriptor = descriptorFor(element, role);
      descriptors.set(element, descriptor);
      return descriptor;
    });

    for (const { element } of plan.consumers) {
      const descriptor = descriptorFor(element, "consumer");
      descriptors.set(element, descriptor);
      nodes.push(descriptor);
    }

    const edges = plan.edges.map(({ from, to }) => ({
      from: descriptors.get(from),
      to: descriptors.get(to),
      kind: to.parentElement === from ? "nested" : "reference",
    }));
    for (const { element, output } of plan.consumers) {
      edges.push({
        from: descriptors.get(output),
        to: descriptors.get(element),
        kind: "consumer",
      });
    }

    return { root, nodes, edges };
  },

  addNode(root, localName, { parent = null } = {}) {
    validateNodeAddition(root, localName, parent);

    const element = document.createElement(localName);
    element.id = nextId(root, localName);
    if (localName === "audio-stream-output") {
      const recorder = document.createElement("media-recorder");
      recorder.id = nextId(root, "media-recorder");
      element.append(recorder);
    }

    (parent ?? root).append(element);
    try {
      validate(root);
    } catch (error) {
      element.remove();
      throw error;
    }
    return element;
  },

  connect(root, from, to) {
    requireRoot(root);
    requireNode(root, from);
    requireNode(root, to);
    if (!["audio-biquad-filter", "audio-output", "audio-stream-output"].includes(to.localName)) {
      throw syntaxError(`<${to.localName}> cannot receive an audio graph connection`);
    }
    const previousTargetId = to.id;
    if (!to.id) to.id = nextId(root, to.localName);

    const hadAttribute = from.hasAttribute("to");
    const previous = from.getAttribute("to");
    const targets = new Set(previous?.trim().split(/\s+/).filter(Boolean) ?? []);
    targets.add(to.id);
    from.setAttribute("to", [...targets].join(" "));
    try {
      validate(root);
    } catch (error) {
      restoreAttribute(from, "to", hadAttribute, previous);
      if (!previousTargetId) to.removeAttribute("id");
      throw error;
    }
  },

  disconnect(root, from, to) {
    requireRoot(root);
    requireNode(root, from);
    requireNode(root, to);
    const hadAttribute = from.hasAttribute("to");
    const previous = from.getAttribute("to");
    const targets = previous?.trim().split(/\s+/).filter(Boolean) ?? [];
    const remaining = targets.filter((id) => id !== to.id);
    if (remaining.length > 0) from.setAttribute("to", remaining.join(" "));
    else from.removeAttribute("to");
    try {
      validate(root);
    } catch (error) {
      restoreAttribute(from, "to", hadAttribute, previous);
      throw error;
    }
  },

  setProperty(root, element, name, value) {
    requireRoot(root);
    requireNode(root, element);
    const definition = NODE_DEFINITIONS.get(element.localName);
    if (!definition.properties.includes(name)) {
      throw new TypeError(`${name} is not editable on <${element.localName}>`);
    }

    const hadAttribute = element.hasAttribute(name);
    const previous = element.getAttribute(name);
    if (value === null || value === undefined) element.removeAttribute(name);
    else element.setAttribute(name, String(value));
    try {
      element._validateAudioConfiguration?.();
      validate(root);
    } catch (error) {
      restoreAttribute(element, name, hadAttribute, previous);
      throw error;
    }
  },

  removeNode(root, element) {
    requireRoot(root);
    requireNode(root, element);
    const parent = element.parentElement;
    const nextSibling = element.nextSibling;
    const removedIds = new Set(
      [element, ...element.querySelectorAll("[id]")]
        .map((candidate) => candidate.id)
        .filter(Boolean),
    );
    const references = [...root.querySelectorAll("[to]")].map((candidate) => ({
      element: candidate,
      value: candidate.getAttribute("to"),
    }));

    element.remove();
    for (const reference of references) {
      if (!reference.element.isConnected && !root.contains(reference.element)) continue;
      const remaining = reference.value
        .trim()
        .split(/\s+/)
        .filter((id) => !removedIds.has(id));
      if (remaining.length > 0) reference.element.setAttribute("to", remaining.join(" "));
      else reference.element.removeAttribute("to");
    }

    try {
      validate(root);
    } catch (error) {
      parent.insertBefore(element, nextSibling);
      for (const reference of references) reference.element.setAttribute("to", reference.value);
      throw error;
    }
  },

  setPosition(element, { x, y }) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new TypeError("Graph coordinates must be finite numbers");
    }
    element.dataset.graphX = String(x);
    element.dataset.graphY = String(y);
  },
};
