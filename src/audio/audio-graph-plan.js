const ROLES = new Map([
  ["audio-input-mic", "source"],
  ["audio-input-file", "source"],
  ["audio-biquad-filter", "processor"],
  ["audio-output", "output"],
]);

const isAudioTag = (element) => element.localName.startsWith("audio-");

const scopedElements = (contextElement) => {
  const elements = [];
  const visit = (parent) => {
    for (const child of parent.children) {
      if (child.localName === "audio-context") continue;
      elements.push(child);
      visit(child);
    }
  };
  visit(contextElement);
  return elements;
};

const addEdge = (edges, edgeKeys, from, to) => {
  const key = `${from.nodeIndex}:${to.nodeIndex}`;
  if (edgeKeys.has(key)) return;
  edgeKeys.add(key);
  edges.push({ from: from.element, to: to.element });
};

const assertAcyclic = (nodes, edges) => {
  const outgoing = new Map(nodes.map((node) => [node.element, []]));
  for (const edge of edges) outgoing.get(edge.from).push(edge.to);

  const visiting = new Set();
  const visited = new Set();
  const visit = (element) => {
    if (visiting.has(element)) throw new TypeError("Audio graph contains a cycle");
    if (visited.has(element)) return;
    visiting.add(element);
    for (const target of outgoing.get(element)) visit(target);
    visiting.delete(element);
    visited.add(element);
  };
  for (const node of nodes) visit(node.element);
};

export const buildAudioGraphPlan = (contextElement) => {
  if (contextElement?.localName !== "audio-context") {
    throw new TypeError("buildAudioGraphPlan requires an <audio-context> element");
  }

  const elements = scopedElements(contextElement);
  const ids = new Map();
  const nodes = [];

  for (const element of elements) {
    if (element.id) {
      if (ids.has(element.id)) {
        throw new TypeError(
          `Duplicate audio graph id "${element.id}" in this <audio-context>`,
        );
      }
      ids.set(element.id, element);
    }
    if (!isAudioTag(element)) continue;
    const role = ROLES.get(element.localName);
    if (!role) {
      throw new TypeError(`Unknown audio graph element <${element.localName}>`);
    }
    nodes.push({ element, role, rootSource: null, nodeIndex: nodes.length });
  }

  const nodeFor = new Map(nodes.map((node) => [node.element, node]));
  for (const node of nodes) {
    const parentNode = nodeFor.get(node.element.parentElement);
    if (node.role === "source") {
      if (node.element.parentElement !== contextElement) {
        throw new TypeError(
          `<${node.element.localName}> must be a direct child of <audio-context>`,
        );
      }
      node.rootSource = node.element;
      continue;
    }
    if (!parentNode) {
      throw new TypeError(
        `<${node.element.localName}> must be nested directly under a recognized audio node`,
      );
    }
    node.rootSource = parentNode.rootSource;
  }

  const edges = [];
  const edgeKeys = new Set();
  for (const node of nodes) {
    const parentNode = nodeFor.get(node.element.parentElement);
    if (parentNode) addEdge(edges, edgeKeys, parentNode, node);
  }

  for (const node of nodes) {
    const targetIds = node.element.getAttribute("to")?.trim().split(/\s+/) ?? [];
    for (const targetId of targetIds) {
      if (!targetId) continue;
      const targetElement = ids.get(targetId);
      if (!targetElement) {
        throw new TypeError(
          `Audio graph target "${targetId}" was not found in this <audio-context>`,
        );
      }
      const target = nodeFor.get(targetElement);
      if (!target || !["processor", "output"].includes(target.role)) {
        throw new TypeError(
          `Audio graph target "${targetId}" must be an audio processor or output`,
        );
      }
      if (target.rootSource === node.rootSource) {
        throw new TypeError(
          `Audio graph target "${targetId}" must be in a different source tree`,
        );
      }
      addEdge(edges, edgeKeys, node, target);
    }
  }

  assertAcyclic(nodes, edges);
  const planNodes = nodes.map(({ element, role, rootSource }) => ({
    element,
    role,
    rootSource,
  }));
  return {
    nodes: planNodes,
    edges,
    sources: planNodes.filter((node) => node.role === "source"),
  };
};
