import { findGraphAdapter } from "./graph-adapters.js";
import { graphEditorStyles } from "./graph-editor.css.js";
import { listGraphFunctions, registerGraphFunction } from "./graph-functions.js";
import { assertGraphAcyclic, findGraphActionSource, findUniqueGraphElement, parseGraphHandler } from "./graph-handler.js";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const KIND_LABELS = {
  source: "Source",
  processor: "Processor",
  output: "Output",
  consumer: "Consumer",
  event: "Event",
  action: "Action",
};

const iconMarkup = (kind) => {
  const path = {
    source: '<path d="M4 12h3l2-5 4 10 2-5h5"/>',
    processor: '<path d="M4 7h8m4 0h4M4 17h3m4 0h9M12 4v6M7 14v6"/>',
    output: '<path d="M5 10v4h4l5 4V6L9 10H5Zm12-1c1 1 1.5 2 1.5 3S18 14 17 15"/>',
    consumer: '<path d="M5 5h14v14H5zM9 9h6v6H9z"/>',
    event: '<path d="m13 3-7 10h6l-1 8 7-11h-6l1-7Z"/>',
    action: '<path d="m8 5 11 7-11 7V5Z"/>',
  }[kind] ?? '<circle cx="12" cy="12" r="7"/>';
  return `<svg aria-hidden="true" viewBox="0 0 24 24">${path}</svg>`;
};

// Arrange only unsaved positions. Persisted coordinates always remain the source of truth.
const layoutGraph = (nodes, edges) => {
  const nodeIds = new Set(nodes.map((node) => node.id));
  const incoming = new Map(nodes.map((node) => [node.id, []]));
  const outgoing = new Map(nodes.map((node) => [node.id, []]));
  const indegree = new Map(nodes.map((node) => [node.id, 0]));

  for (const edge of edges) {
    if (!nodeIds.has(edge.from.id) || !nodeIds.has(edge.to.id)) continue;
    incoming.get(edge.to.id).push(edge.from.id);
    outgoing.get(edge.from.id).push(edge.to.id);
    indegree.set(edge.to.id, indegree.get(edge.to.id) + 1);
  }

  const levels = new Map(nodes.map((node) => [node.id, 0]));
  const queue = nodes.filter((node) => indegree.get(node.id) === 0).map((node) => node.id);
  const visited = new Set();
  while (queue.length > 0) {
    const id = queue.shift();
    visited.add(id);
    for (const targetId of outgoing.get(id)) {
      levels.set(targetId, Math.max(levels.get(targetId), levels.get(id) + 1));
      indegree.set(targetId, indegree.get(targetId) - 1);
      if (indegree.get(targetId) === 0) queue.push(targetId);
    }
  }

  // A registered adapter should expose a DAG. This fallback keeps malformed custom adapters visible.
  let fallbackLevel = Math.max(0, ...levels.values()) + 1;
  for (const node of nodes) {
    if (!visited.has(node.id)) levels.set(node.id, fallbackLevel++);
  }

  const lanes = new Map();
  const occupiedByLevel = new Map();
  for (const node of nodes) {
    const level = levels.get(node.id);
    const occupied = occupiedByLevel.get(level) ?? new Set();
    const predecessorLanes = incoming.get(node.id)
      .map((id) => lanes.get(id))
      .filter(Number.isFinite);
    let lane = predecessorLanes[0] ?? 0;
    while (occupied.has(lane)) lane += 1;
    lanes.set(node.id, lane);
    occupied.add(lane);
    occupiedByLevel.set(level, occupied);
  }

  const positions = new Map();
  for (const node of nodes) {
    positions.set(node.id, {
      x: node.position.x ?? 24 + levels.get(node.id) * 176,
      y: node.position.y ?? 24 + lanes.get(node.id) * 168,
    });
  }
  return positions;
};

const orchestrationDescriptor = (element, kind, properties, label = null) => ({
  element,
  id: element.id,
  nodeName: element.localName,
  kind,
  label: label ?? (kind === "event" ? "Event" : "Action"),
  properties: properties.map((name) => ({ name, value: element.getAttribute(name) })),
  events: kind === "event" ? ["data"] : ["run", "data"],
  position: {
    x: Number.isFinite(Number(element.dataset.graphX)) ? Number(element.dataset.graphX) : null,
    y: Number.isFinite(Number(element.dataset.graphY)) ? Number(element.dataset.graphY) : null,
  },
});

export class GraphEditorElement extends HTMLElement {
  #adapter = null;
  #root = null;
  #model = { nodes: [], edges: [] };
  #observer = null;
  #renderQueued = false;
  #selectedId = null;
  #connectFromId = "";
  #connectToId = "";
  #drag = null;
  #connectionSource = null;
  #armedSource = null;
  #suppressPortClick = false;
  #paletteQuery = "";
  #navigatorView = "nodes";
  #paletteStatus = "Choose a node to see available additions.";
  #statusTone = "info";
  #fieldErrors = new Map();
  #panelState = { palette: false, inspector: false };

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", this.#handleClick);
    this.shadowRoot.addEventListener("change", this.#handleChange);
    this.shadowRoot.addEventListener("input", this.#handleInput);
    this.shadowRoot.addEventListener("pointerdown", this.#handlePointerDown);
    this.shadowRoot.addEventListener("pointerup", this.#handlePortPointerUp);
    this.shadowRoot.addEventListener("keydown", this.#handleKeyDown);
    this.addEventListener("error", (event) => {
      if (event.target !== this || !event.detail?.data) return;
      const { data, metadata } = event.detail;
      this.#announce(`${metadata?.nodeId ? `#${metadata.nodeId}: ` : ""}${data.message ?? data}`, "error");
    });
  }

  connectedCallback() {
    this.#observer = new MutationObserver(() => this.#queueRender());
    this.#observer.observe(this, { childList: true, subtree: true, attributes: true });
    this.#queueRender();
  }

  disconnectedCallback() {
    this.#observer?.disconnect();
    this.#observer = null;
    this.#endDrag();
    this.#cancelConnection();
  }

  get graphRoot() {
    return this.#root;
  }

  serialize() {
    return this.innerHTML.trim();
  }

  registerFunction(name, fn, metadata = {}) {
    try {
      const unregister = registerGraphFunction(this, name, fn, metadata);
      let active = true;
      this.#queueRender();
      return () => {
        if (!active) return;
        active = false;
        unregister();
        this.#queueRender();
      };
    } catch (error) {
      this.#reportError(error);
      throw error;
    }
  }

  addNode(localName, options = {}) {
    return this.#mutate("nodeadd", "add", () =>
      this.#adapter.addNode(this.#root, localName, options),
    );
  }

  removeNode(element) {
    const removed = this.#mutate("noderemove", "remove", () => {
      const orchestration = ["graph-event", "graph-action"].includes(element?.localName);
      if (orchestration) {
        if (element.parentElement !== this) {
          throw new DOMException("Graph node is outside this editor", "NotFoundError");
        }
      }
      const reason = this.#removalBlockReason(element);
      if (reason) throw new DOMException(reason, "InvalidStateError");
      if (orchestration) element.remove();
      else this.#adapter.removeNode(this.#root, element);
      return element;
    });
    this.#announce(`${element.id || element.localName} removed`);
    return removed;
  }

  #dependentOrchestrationNodes(element) {
    return [...this.querySelectorAll(":scope > graph-event, :scope > graph-action")]
      .filter((node) => node !== element && node.getAttribute("from") === element.id);
  }

  #removalBlockReason(element) {
    if (["graph-event", "graph-action"].includes(element?.localName)) {
      return this.#dependentOrchestrationNodes(element).length > 0
        ? "Disconnect dependent events and actions before removing this node" : "";
    }
    if (!(element instanceof Element) || !this.#root?.contains(element)) return "";
    const children = this.#adapter.read(this.#root).nodes
      .filter((node) => node.element !== element && element.contains(node.element));
    if (children.length > 0) return `Remove ${children.length} child graph ${children.length === 1 ? "node" : "nodes"} before removing this node`;
    if (this.#dependentOrchestrationNodes(element).length > 0) {
      return "Disconnect dependent events and actions before removing this node";
    }
    return "";
  }

  connect(from, to) {
    return this.#mutate("edgeconnect", "connect", () => {
      if (to?.localName === "graph-action") {
        this.#connectAction(from, to);
      } else {
        this.#adapter.connect(this.#root, from, to);
      }
      return { from, to };
    });
  }

  disconnect(from, to) {
    return this.#mutate("edgedisconnect", "disconnect", () => {
      if (to?.localName === "graph-action") {
        if (to.parentElement !== this || to.getAttribute("from") !== from?.id) {
          throw new DOMException("Graph action is not connected to this source", "NotFoundError");
        }
        this.#preserveNodePosition(to);
        to.setAttribute("from", "");
      } else {
        this.#adapter.disconnect(this.#root, from, to);
      }
      return { from, to };
    });
  }

  #connectAction(from, to) {
    if (to.parentElement !== this || from?.parentElement !== this || !from.id) {
      throw new DOMException("Graph action endpoints must belong to this editor", "NotFoundError");
    }
    findGraphActionSource(this, to, from.id);
    to.setAttribute("from", from.id);
  }

  #preserveNodePosition(element) {
    const card = this.shadowRoot.querySelector(`[data-node-id="${CSS.escape(element.id)}"]`);
    if (!card) return;
    element.dataset.graphX = String(card.offsetLeft);
    element.dataset.graphY = String(card.offsetTop);
  }

  setProperty(element, name, value) {
    return this.#mutate("nodechange", "property", () => {
      if (["graph-event", "graph-action"].includes(element?.localName)) {
        this.#setOrchestrationProperty(element, name, value);
      } else {
        this.#adapter.setProperty(this.#root, element, name, value);
      }
      return element;
    }, { property: name });
  }

  addEvent(source, type) {
    return this.#mutate("nodeadd", "add-event", () => {
      if (!source?.id || !type?.trim()) throw new TypeError("Event source and type are required");
      const element = document.createElement("graph-event");
      element.id = this.#nextId("graph-event");
      element.setAttribute("from", source.id);
      element.setAttribute("type", type.trim());
      this.append(element);
      return element;
    });
  }

  addAction(sourceElement, handler = "HandleGraphEvent(event)") {
    return this.#mutate("nodeadd", "add-action", () => {
      if (!["graph-event", "graph-action"].includes(sourceElement?.localName) ||
          !sourceElement.id || sourceElement.parentElement !== this) {
        throw new TypeError("An action requires an identified <graph-event> or <graph-action> in this editor");
      }
      parseGraphHandler(handler);
      const element = document.createElement("graph-action");
      element.id = this.#nextId("graph-action");
      element.setAttribute("from", sourceElement.id);
      element.setAttribute("handler", handler);
      this.append(element);
      return element;
    });
  }

  #queueRender() {
    if (this.#renderQueued) return;
    this.#renderQueued = true;
    queueMicrotask(() => {
      this.#renderQueued = false;
      if (this.isConnected) this.#render();
    });
  }

  #readModel() {
    const located = findGraphAdapter(this);
    this.#root = located.root;
    this.#adapter = located.adapter;
    let model = this.#adapter.read(this.#root);
    const unnamedNodes = model.nodes.filter((node) => !node.id);
    for (const node of unnamedNodes) node.element.id = this.#nextId(node.nodeName);
    if (unnamedNodes.length > 0) model = this.#adapter.read(this.#root);
    const nodes = [...model.nodes];
    const edges = [...model.edges];
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const orchestrationNodes = [];

    for (const element of this.querySelectorAll(":scope > graph-event")) {
      if (!element.id) element.id = this.#nextId("graph-event");
      const node = orchestrationDescriptor(element, "event", ["from", "type"]);
      nodes.push(node);
      orchestrationNodes.push(node);
      byId.set(node.id, node);
    }
    for (const element of this.querySelectorAll(":scope > graph-action")) {
      if (!element.id) element.id = this.#nextId("graph-action");
      const handler = element.getAttribute("handler");
      const registered = listGraphFunctions(this).find(
        (candidate) => candidate.handler === handler,
      );
      let label = registered?.label ?? "Action";
      if (!registered) {
        try {
          label = parseGraphHandler(handler).at(-1);
        } catch {
          // Invalid light-DOM markup remains visible as a generic action until corrected.
        }
      }
      const node = orchestrationDescriptor(element, "action", ["from", "handler"], label);
      nodes.push(node);
      orchestrationNodes.push(node);
      byId.set(node.id, node);
    }
    for (const node of orchestrationNodes) {
      const source = byId.get(node.element.getAttribute("from"));
      if (source && (node.kind === "event" || ["event", "action"].includes(source.kind))) {
        edges.push({ from: source, to: node, kind: node.kind });
      }
    }
    return { ...model, nodes, edges };
  }

  #render() {
    try {
      const focused = this.shadowRoot.activeElement;
      const scrollPositions = [".palette", ".inspector", ".canvas", ".navigator-list"]
        .map((selector) => {
          const element = this.shadowRoot.querySelector(selector);
          return [selector, element?.scrollLeft ?? 0, element?.scrollTop ?? 0];
        });
      this.#model = this.#readModel();
      if (this.#selectedId && !this.#model.nodes.some((node) => node.id === this.#selectedId)) {
        this.#selectedId = null;
      }
      const selected = this.#model.nodes.find((node) => node.id === this.#selectedId) ?? null;
      const relationships = this.#relationships(selected);
      const relatedIds = new Set([
        ...relationships.incoming.map((node) => node.id),
        ...relationships.outgoing.map((node) => node.id),
      ]);
      const positions = layoutGraph(this.#model.nodes, this.#model.edges);
      if (this.#model.nodes.length <= 12) this.#navigatorView = "nodes";
      const canvasWidth = Math.max(
        720,
        ...[...positions.values()].map(({ x }) => x + 184),
      );
      const canvasHeight = Math.max(
        460,
        ...[...positions.values()].map(({ y }) => y + 168),
      );
      this.shadowRoot.innerHTML = `
        <style>${graphEditorStyles}</style>
        <div class="layout">
          ${this.#paletteMarkup(selected)}
          <section class="workspace" aria-label="Graph canvas">
            ${this.#toolbarMarkup()}
            ${this.#navigatorMarkup(selected, relatedIds, positions, canvasWidth, canvasHeight)}
            <div class="canvas" tabindex="0" aria-label="Scrollable graph drawing area">
              <div class="canvas-surface" style="--canvas-width:${canvasWidth}px;--canvas-height:${canvasHeight}px">
                <svg aria-hidden="true" preserveAspectRatio="none">
                  ${this.#model.edges.map((edge, index) => `<path data-edge-index="${index}" data-edge-from="${escapeHtml(edge.from.id)}" data-edge-to="${escapeHtml(edge.to.id)}" data-kind="${escapeHtml(edge.kind)}" data-relation="${selected && (edge.from.id === selected.id || edge.to.id === selected.id) ? "connected" : selected ? "unrelated" : "none"}" d=""></path>`).join("")}
                </svg>
                ${this.#model.nodes.map((node) => this.#nodeMarkup(
                  node,
                  positions.get(node.id),
                  node.id === selected?.id ? "selected" : relatedIds.has(node.id) ? "connected" : selected ? "unrelated" : "none",
                )).join("")}
              </div>
            </div>
          </section>
          <aside class="panel inspector" aria-label="Graph node inspector">
            <button class="mobile-panel-toggle" type="button" data-toggle-panel="inspector"
              aria-expanded="${this.#panelState.inspector}" aria-controls="graph-inspector-content">
              <span>Inspector</span><small>Configure selected node</small>
            </button>
            <div id="graph-inspector-content" data-panel-content>
              <div class="panel-heading">
                <h2>Inspector</h2>
                <p>Configure selection</p>
              </div>
              ${this.#inspectorMarkup(selected, relationships)}
            </div>
          </aside>
        </div>
        <p class="palette-status" data-editor-status data-tone="${this.#statusTone}" role="status">${escapeHtml(this.#paletteStatus)}</p>
      `;
      for (const [selector, left, top] of scrollPositions) {
        const element = this.shadowRoot.querySelector(selector);
        if (element) {
          element.scrollLeft = left;
          element.scrollTop = top;
        }
      }
      this.#restoreFocus(focused);
      this.#updateEdges();
      requestAnimationFrame(() => this.#updateEdges());
      this.dispatchEvent(new CustomEvent("ready", {
        detail: {
          data: this.#model,
          metadata: { nodeCount: this.#model.nodes.length, edgeCount: this.#model.edges.length },
        },
      }));
    } catch (error) {
      this.shadowRoot.innerHTML = `
        <style>${graphEditorStyles}</style>
        <div class="render-error" role="alert">
          <strong>Graph unavailable</strong>
          <p>${escapeHtml(error.message)}</p>
          <p>Add one direct child with a registered graph adapter, or correct the graph markup. The editor will retry when it changes.</p>
        </div>
      `;
      this.#reportError(error);
    }
  }

  #restoreFocus(focused) {
    if (!focused) return;
    const nodeId = focused.closest("[data-node-id]")?.dataset.nodeId;
    const key = ["action", "property", "connectFrom", "connectTo", "navigateNode", "navigatorView", "port"]
      .find((name) => focused.dataset[name] !== undefined);
    let replacement = null;
    if (nodeId && focused.matches(".node-select, [data-port], [data-drag-handle]")) {
      const child = focused.matches(".node-select") ? ".node-select"
        : focused.dataset.port ? `[data-port="${CSS.escape(focused.dataset.port)}"]` : "[data-drag-handle]";
      replacement = this.shadowRoot.querySelector(`[data-node-id="${CSS.escape(nodeId)}"] ${child}`);
    } else if (key) {
      replacement = this.shadowRoot.querySelector(
        `[data-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}="${CSS.escape(focused.dataset[key])}"]`,
      );
    } else if (focused.matches("[data-palette-search]")) {
      replacement = this.shadowRoot.querySelector("[data-palette-search]");
    }
    const fallback = this.#navigatorView === "overview"
      ? this.shadowRoot.querySelector('[data-navigator-view="overview"]')
      : this.shadowRoot.querySelector("[data-navigate-node]");
    (replacement ?? fallback)?.focus({ preventScroll: true });
  }

  #paletteMarkup(selected) {
    const query = this.#paletteQuery.trim().toLowerCase();
    const matches = (values) => !query || values.some(
      (value) => String(value ?? "").toLowerCase().includes(query),
    );
    const nodeItems = this.#adapter.nodeTypes.map((type) => {
      const parent = type.kind === "source" ? null : selected?.element ?? null;
      const capability = this.#adapter.canAdd?.(this.#root, type.localName, { parent })
        ?? {
          allowed: true,
          reason: "",
        };
      return {
        group: type.kind === "source" ? "inputs" : "processing",
        kind: type.kind,
        label: type.label,
        detail: capability.allowed
          ? KIND_LABELS[type.kind] ?? type.kind
          : capability.reason,
        allowed: capability.allowed,
        reason: capability.reason,
        attribute: `data-add-node="${escapeHtml(type.localName)}" data-node-kind="${escapeHtml(type.kind)}"`,
        search: [type.label, type.localName, type.kind, capability.reason],
      };
    });
    const eventItems = (selected?.events ?? []).map((type) => ({
      group: "events",
      kind: "event",
      label: type,
      detail: `From #${selected.id}`,
      allowed: true,
      reason: "",
      attribute: `data-add-event="${escapeHtml(type)}"`,
      search: ["event", type, selected.label, selected.id],
    }));
    const registeredFunctions = listGraphFunctions(this);
    const functionItems = registeredFunctions.map((descriptor) => {
      const allowed = ["event", "action"].includes(selected?.kind);
      const reason = allowed ? "" : "Select an event or action before adding a function";
      return {
        group: "functions",
        kind: "action",
        label: descriptor.label,
        detail: allowed ? descriptor.description || descriptor.name : reason,
        allowed,
        reason,
        attribute: `data-add-function="${escapeHtml(descriptor.name)}"`,
        search: [descriptor.label, descriptor.name, descriptor.description, "function", "action"],
      };
    });
    const legacyAction = {
      group: "functions", kind: "action", label: "Action",
      detail: "Advanced: enter a registered or global function reference",
      allowed: ["event", "action"].includes(selected?.kind),
      reason: "Select an event or action before adding an action",
      attribute: 'data-action="add-action"',
      search: ["action", "legacy", "handler", "function"],
    };
    const items = [...nodeItems, ...eventItems, ...functionItems, legacyAction].map((item) => ({
      ...item,
      visible: matches(item.search),
    }));
    const renderItems = (group) => items
      .filter((item) => item.group === group)
      .map((item) => `
        <button type="button" ${item.attribute}
          aria-label="Add ${escapeHtml(item.label)}"
          aria-disabled="${!item.allowed}"
          data-disabled-reason="${escapeHtml(item.reason)}" data-option-ready="${item.allowed}"
          data-search-text="${escapeHtml(item.search.join(" "))}"
          ${item.visible ? "" : "hidden"}>
          <span class="palette-icon">${iconMarkup(item.kind)}</span>
          <span><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></span>
        </button>
      `).join("");
    const renderGroup = (id, label, empty) => {
      const groupItems = items.filter((item) => item.group === id);
      const visible = groupItems.some((item) => item.visible) || (!query && groupItems.length === 0);
      return `
        <section class="palette-group" data-palette-group="${id}" ${visible ? "" : "hidden"}>
          <h3>${label}<span>${groupItems.length}</span></h3>
          <div class="palette-list">${renderItems(id)}</div>
          ${groupItems.length === 0 || (id === "functions" && registeredFunctions.length === 0)
            ? `<p class="palette-empty">${escapeHtml(empty)}</p>` : ""}
        </section>
      `;
    };
    const resultCount = items.filter((item) => item.visible).length;
    const readyCount = items.filter((item) => item.visible && item.allowed).length;
    const context = selected
      ? `Selected ${selected.label} #${selected.id}`
      : "Select a node to add connected items";
    return `
      <aside class="panel palette" aria-label="Graph node palette">
        <button class="mobile-panel-toggle" type="button" data-toggle-panel="palette"
          aria-expanded="${this.#panelState.palette}" aria-controls="graph-palette-content">
          <span>Add nodes</span><small data-palette-toggle-count>${readyCount} ready · ${resultCount} shown</small>
        </button>
        <div id="graph-palette-content" data-panel-content>
          <div class="panel-heading">
            <h2>Add nodes</h2>
            <p id="palette-context">${escapeHtml(context)}</p>
          </div>
          <label class="palette-search" for="graph-palette-search">Find a node or function</label>
          <input id="graph-palette-search" type="search" data-palette-search
            value="${escapeHtml(this.#paletteQuery)}" aria-describedby="palette-context palette-results"
            placeholder="Search nodes, events, functions">
          <p id="palette-results" class="palette-results" data-palette-result-count>${readyCount} ready · ${resultCount} shown</p>
          <p class="palette-status" data-palette-status data-tone="${this.#statusTone}">${escapeHtml(this.#paletteStatus)}</p>
          <div class="palette-empty" data-search-empty ${resultCount ? "hidden" : ""}>
            <p>No matching nodes or functions. Try another name.</p>
            <button type="button" data-action="clear-search">Clear search</button>
          </div>
          ${renderGroup("inputs", "Inputs", "No input nodes are registered.")}
          ${renderGroup("processing", "Processing & outputs", "No processing nodes are registered.")}
          ${renderGroup("events", "Events", "Select a node that exposes events.")}
          ${renderGroup("functions", "Functions", "Register one with editor.registerFunction().")}
        </div>
      </aside>
    `;
  }

  #toolbarMarkup() {
    const options = (selectedId, kinds) => this.#model.nodes.filter((node) => kinds.includes(node.kind))
      .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${escapeHtml(node.id || node.label)}</option>`)
      .join("");
    return `
      <div class="toolbar" aria-label="Keyboard edge controls">
        <div class="toolbar-heading"><strong>Connect nodes</strong><small>Keyboard alternative to dragging ports</small></div>
        <label for="graph-connect-from">From</label>
        <select id="graph-connect-from" data-connect-from><option value="">Choose source</option>${options(this.#connectFromId, ["source", "processor", "event", "action"])}</select>
        <span class="toolbar-arrow" aria-hidden="true">→</span>
        <label for="graph-connect-to">To</label>
        <select id="graph-connect-to" data-connect-to><option value="">Choose target</option>${options(this.#connectToId, ["processor", "output", "consumer", "action"])}</select>
        <div class="toolbar-actions">
          <button type="button" data-action="connect">Connect</button>
          <button type="button" data-action="disconnect">Disconnect</button>
        </div>
      </div>
    `;
  }

  #navigatorMarkup(selected, relatedIds, positions, canvasWidth, canvasHeight) {
    const overview = this.#model.nodes.length > 12;
    const overviewEdges = this.#model.edges.map((edge) => {
      const from = positions.get(edge.from.id);
      const to = positions.get(edge.to.id);
      if (!from || !to) return "";
      return `<line data-overview-edge data-kind="${escapeHtml(edge.kind)}"
        x1="${from.x + 160}" y1="${from.y + 64}" x2="${to.x}" y2="${to.y + 64}"></line>`;
    }).join("");
    const overviewNodes = this.#model.nodes.map((node) => {
      const position = positions.get(node.id);
      return `<rect data-overview-node="${escapeHtml(node.id)}" data-kind="${escapeHtml(node.kind)}"
        data-selected="${node.id === selected?.id}" x="${position.x}" y="${position.y}"
        width="160" height="128" rx="12"><title>${escapeHtml(node.label)} #${escapeHtml(node.id)}</title></rect>`;
    }).join("");
    return `
      <nav class="navigator" aria-label="Graph node navigator">
        <div class="navigator-heading">
          <strong>Node navigator</strong>
          <small data-graph-stats>${this.#model.nodes.length} nodes · ${this.#model.edges.length} edges</small>
        </div>
        <p class="navigator-hint">Arrow keys or Home/End browse nodes. Escape returns here from the canvas.</p>
        ${overview ? `<div class="navigator-view-controls" role="group" aria-label="Navigator view">
          <button type="button" data-navigator-view="nodes" aria-pressed="${this.#navigatorView === "nodes"}">Nodes</button>
          <button type="button" data-navigator-view="overview" aria-pressed="${this.#navigatorView === "overview"}">Overview</button>
        </div>` : ""}
        <div class="navigator-list" ${this.#navigatorView === "overview" ? "hidden" : ""}>
          ${this.#model.nodes.map((node) => {
            const relation = node.id === selected?.id
              ? "selected"
              : relatedIds.has(node.id) ? "connected" : selected ? "unrelated" : "none";
            const relationLabel = relation === "selected"
              ? "Selected · "
              : relation === "connected" ? "Connected · " : "";
            const relationDescription = relation === "selected"
              ? " Selected node."
              : relation === "connected" ? " Connected to selected node." : "";
            return `
              <button type="button" data-navigate-node="${escapeHtml(node.id)}"
                data-relation="${relation}" aria-pressed="${node.id === selected?.id}"
                aria-label="Show ${escapeHtml(node.label)} ${escapeHtml(node.id)} in canvas.${relationDescription}">
                <span class="navigator-icon">${iconMarkup(node.kind)}</span>
                <span><strong>${escapeHtml(node.label)}</strong><small>${relationLabel}#${escapeHtml(node.id)}</small></span>
              </button>
            `;
          }).join("")}
        </div>
        ${overview ? `<svg class="overview-map" role="img" aria-label="Whole graph overview: ${this.#model.nodes.length} nodes and ${this.#model.edges.length} edges"
          viewBox="0 0 ${canvasWidth} ${canvasHeight}" preserveAspectRatio="xMidYMid meet"
          ${this.#navigatorView === "nodes" ? "hidden" : ""}>
          ${overviewEdges}${overviewNodes}
        </svg>` : ""}
      </nav>
    `;
  }

  #nodeMarkup(node, position, relation) {
    const relationLabel = relation === "selected"
      ? "Selected"
      : relation === "connected" ? "Connected" : "";
    return `
      <div class="node" data-node-id="${escapeHtml(node.id)}"
        data-kind="${escapeHtml(node.kind)}"
        data-relation="${relation}"
        style="--node-x:${position.x}px;--node-y:${position.y}px">
        <div class="node-header">
          <span class="kind-icon">${iconMarkup(node.kind)}</span>
          <span class="kind-label">${escapeHtml(KIND_LABELS[node.kind] ?? node.kind)}</span>
          <button class="drag-handle" type="button" data-drag-handle aria-label="Move ${escapeHtml(node.id)} with arrow keys" aria-keyshortcuts="ArrowUp ArrowDown ArrowLeft ArrowRight">
            <svg aria-hidden="true" viewBox="0 0 24 24"><circle cx="8" cy="7" r="1"/><circle cx="16" cy="7" r="1"/><circle cx="8" cy="12" r="1"/><circle cx="16" cy="12" r="1"/><circle cx="8" cy="17" r="1"/><circle cx="16" cy="17" r="1"/></svg>
          </button>
        </div>
        <button class="node-select" type="button" aria-pressed="${node.id === this.#selectedId}">
          <strong>${escapeHtml(node.label)}</strong><small>#${escapeHtml(node.id || node.nodeName)}</small>
        </button>
        ${relationLabel ? `<span class="relation-badge">${relationLabel}</span>` : ""}
        ${node.kind === "action" ? '<span class="port-labels"><span>Input</span><span>Output</span></span>' : ""}
        <span class="ports">
          ${["source", "event"].includes(node.kind) ? "<span></span>" : `<button class="port" type="button" data-port="input" aria-label="Connect into ${escapeHtml(node.id)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m13 8-4 4 4 4"/></svg></button>`}
          ${["output", "consumer"].includes(node.kind) ? "<span></span>" : `<button class="port" type="button" data-port="output" aria-pressed="${this.#armedSource?.id === node.id}" aria-label="Connect from ${escapeHtml(node.id)}"><svg aria-hidden="true" viewBox="0 0 24 24"><path d="m11 8 4 4-4 4"/></svg></button>`}
        </span>
      </div>
    `;
  }

  #inspectorMarkup(selected, relationships) {
    if (!selected) return '<p class="empty">Select a node to edit it.</p>';
    const removalBlockReason = this.#removalBlockReason(selected.element);
    const functions = listGraphFunctions(this);
    const functionListId = "graph-function-suggestions";
    const fields = selected.properties.map((property, index) => {
      const key = `${selected.id}:${property.name}`;
      const issue = this.#fieldErrors.get(key);
      const inputId = `graph-property-${index}`;
      const errorId = `${inputId}-error`;
      const isHandler = selected.kind === "action" && property.name === "handler";
      return `
        <div class="field ${issue ? "field-invalid" : ""}">
          <label for="${inputId}">${isHandler ? "Advanced handler reference" : escapeHtml(property.name)}</label>
          ${isHandler ? '<span class="field-hint">Choose a registered function from Add nodes, or enter a legacy global reference.</span>' : ""}
          <input id="${inputId}" data-property="${escapeHtml(property.name)}"
            value="${escapeHtml(issue?.value ?? property.value ?? "")}"
            ${isHandler && functions.length > 0 ? `list="${functionListId}"` : ""}
            aria-invalid="${Boolean(issue)}"
            ${issue ? `aria-errormessage="${errorId}"` : ""}>
          ${issue ? `<span class="field-error" id="${errorId}">${escapeHtml(issue.message)}</span>` : ""}
        </div>
      `;
    }).join("");
    const functionOptions = selected.kind === "action" && functions.length > 0
      ? `<datalist id="${functionListId}">${functions.map((descriptor) =>
        `<option value="${escapeHtml(descriptor.handler)}">${escapeHtml(descriptor.label)}</option>`
      ).join("")}</datalist>`
      : "";
    const relationshipGroup = (label, nodes) => `
      <section class="relationship-group" aria-labelledby="graph-${label.toLowerCase()}-heading">
        <h3 id="graph-${label.toLowerCase()}-heading">${label} <span>${nodes.length}</span></h3>
        ${nodes.length > 0 ? `<div class="relationship-list">${nodes.map((node) => `
          <button type="button" data-related-id="${escapeHtml(node.id)}">
            <strong>${escapeHtml(node.label)}</strong><small>#${escapeHtml(node.id)}</small>
          </button>
        `).join("")}</div>` : '<p class="empty">None</p>'}
      </section>
    `;
    const inputLabel = `${relationships.incoming.length} ${relationships.incoming.length === 1 ? "input" : "inputs"}`;
    const outputLabel = `${relationships.outgoing.length} ${relationships.outgoing.length === 1 ? "output" : "outputs"}`;
    return `
      <p><strong>${escapeHtml(selected.label)}</strong><br><small>${escapeHtml(selected.id)}</small></p>
      <p class="selection-status" data-selection-status aria-live="polite">${escapeHtml(selected.label)} selected. ${inputLabel}, ${outputLabel}.</p>
      <div class="relationships">
        ${relationshipGroup("Inputs", relationships.incoming)}
        ${relationshipGroup("Outputs", relationships.outgoing)}
      </div>
      <div class="fields">${fields || '<span class="empty">No editable properties.</span>'}${functionOptions}</div>
      ${removalBlockReason ? `<p class="field-hint">${escapeHtml(removalBlockReason)}</p>` : ""}
      <button class="danger" type="button" data-action="remove" ${removalBlockReason ? "disabled" : ""}>Remove node</button>
    `;
  }

  #handleClick = (event) => {
    const navigatorView = event.target.closest("[data-navigator-view]");
    if (navigatorView) {
      this.#setNavigatorView(navigatorView.dataset.navigatorView);
      return;
    }
    const port = event.target.closest("[data-port]");
    if (port) {
      if (this.#suppressPortClick) {
        this.#suppressPortClick = false;
        return;
      }
      const node = this.#model.nodes.find(
        (candidate) => candidate.id === port.closest("[data-node-id]")?.dataset.nodeId,
      );
      if (port.dataset.port === "output") this.#armSource(node?.element);
      else if (this.#armedSource && node) this.#connectPorts(this.#armedSource, node.element);
      else this.#announce("Choose an output port first");
      return;
    }
    if (event.target.closest("[data-drag-handle]")) return;
    const panelToggle = event.target.closest("[data-toggle-panel]");
    if (panelToggle) {
      const panel = panelToggle.dataset.togglePanel;
      this.#panelState[panel] = !this.#panelState[panel];
      panelToggle.setAttribute("aria-expanded", String(this.#panelState[panel]));
      return;
    }
    const paletteButton = event.target.closest(
      '[data-add-node], [data-add-event], [data-add-function], [data-action="add-action"]',
    );
    if (paletteButton?.getAttribute("aria-disabled") === "true") {
      this.#announce(paletteButton.dataset.disabledReason || "This item is unavailable");
      return;
    }
    const navigatorButton = event.target.closest("[data-navigate-node]");
    if (navigatorButton) {
      this.#selectNode(navigatorButton.dataset.navigateNode, true);
      return;
    }
    const relatedButton = event.target.closest("[data-related-id]");
    if (relatedButton) {
      this.#selectNode(relatedButton.dataset.relatedId, true);
      return;
    }
    const nodeButton = event.target.closest("[data-node-id]");
    if (nodeButton) {
      this.#selectNode(nodeButton.dataset.nodeId);
      return;
    }

    const addButton = event.target.closest("[data-add-node]");
    if (addButton) {
      const selected = this.#selectedNode();
      const options = addButton.dataset.nodeKind === "source" ? {} : { parent: selected?.element };
      this.#run(() => {
        const element = this.addNode(addButton.dataset.addNode, options);
        this.#completeAddition(element, `${element.localName} added`);
      });
      return;
    }

    const eventButton = event.target.closest("[data-add-event]");
    if (eventButton) {
      const selected = this.#selectedNode();
      this.#run(() => {
        const element = this.addEvent(selected?.element, eventButton.dataset.addEvent);
        this.#completeAddition(element, `${eventButton.dataset.addEvent} event added`);
      });
      return;
    }

    const functionButton = event.target.closest("[data-add-function]");
    if (functionButton) {
      const selected = this.#selectedNode();
      this.#run(() => {
        const descriptor = listGraphFunctions(this).find(
          (candidate) => candidate.name === functionButton.dataset.addFunction,
        );
        if (!descriptor) throw new ReferenceError("The selected function is no longer registered");
        const existing = [...this.querySelectorAll(":scope > graph-action")].find(
          (action) => action.getAttribute("from") === selected?.id
            && action.getAttribute("handler") === descriptor.handler,
        );
        if (existing) {
          this.#selectNode(existing.id, true);
          this.#announce(`${descriptor.label} is already connected to #${selected.id}; selected existing action`);
          return;
        }
        const element = this.addAction(selected?.element, descriptor.handler);
        this.#completeAddition(element, `${descriptor.label} action added`);
      });
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    this.#run(() => this.#performAction(action));
  };

  #setNavigatorView(view) {
    this.#navigatorView = view;
    for (const button of this.shadowRoot.querySelectorAll("[data-navigator-view]")) {
      button.setAttribute("aria-pressed", String(button.dataset.navigatorView === view));
    }
    this.shadowRoot.querySelector(".navigator-list").toggleAttribute("hidden", view === "overview");
    this.shadowRoot.querySelector(".overview-map").toggleAttribute("hidden", view === "nodes");
  }

  #performAction(action) {
    if (action === "clear-search") {
      const search = this.shadowRoot.querySelector("[data-palette-search]");
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.focus();
      return;
    }
    if (action === "connect" || action === "disconnect") {
      const fromId = this.shadowRoot.querySelector("[data-connect-from]").value;
      const toId = this.shadowRoot.querySelector("[data-connect-to]").value;
      this.#connectFromId = fromId;
      this.#connectToId = toId;
      const from = this.#model.nodes.find((node) => node.id === fromId)?.element;
      const to = this.#model.nodes.find((node) => node.id === toId)?.element;
      if (!from || !to) throw new TypeError("Choose both edge endpoints");
      const result = this[action](from, to);
      this.#announce(`${fromId} ${action === "connect" ? "connected to" : "disconnected from"} ${toId}`);
      return result;
    }
    const selected = this.#selectedNode();
    if (action === "remove") return this.removeNode(selected.element);
    if (action === "add-action") {
      const element = this.addAction(selected.element);
      this.#completeAddition(element, "Action added. Set its handler in the Inspector.");
      return element;
    }
  }

  #handleChange = (event) => {
    if (event.target.matches("[data-connect-from]")) {
      this.#connectFromId = event.target.value;
      return;
    }
    if (event.target.matches("[data-connect-to]")) {
      this.#connectToId = event.target.value;
      return;
    }
    const input = event.target.closest("[data-property]");
    if (!input) return;
    const selected = this.#selectedNode();
    const key = `${selected.id}:${input.dataset.property}`;
    try {
      this.setProperty(selected.element, input.dataset.property, input.value);
      this.#fieldErrors.delete(key);
      this.#announce(`${input.dataset.property} updated`);
    } catch (error) {
      this.#fieldErrors.set(key, { value: input.value, message: error.message });
      this.#render();
      const replacement = this.shadowRoot.querySelector(
        `[data-property="${CSS.escape(input.dataset.property)}"]`,
      );
      replacement?.focus();
    }
  };

  #handleInput = (event) => {
    const search = event.target.closest("[data-palette-search]");
    if (!search) return;
    this.#paletteQuery = search.value;
    const query = search.value.trim().toLowerCase();
    const groups = [...this.shadowRoot.querySelectorAll("[data-palette-group]")];
    let resultCount = 0;
    let readyCount = 0;
    for (const group of groups) {
      const buttons = [...group.querySelectorAll("[data-search-text]")];
      for (const button of buttons) {
        button.hidden = Boolean(query) && !button.dataset.searchText.toLowerCase().includes(query);
        if (!button.hidden) {
          resultCount += 1;
          if (button.dataset.optionReady === "true") readyCount += 1;
        }
      }
      group.hidden = Boolean(query) && !buttons.some((button) => !button.hidden);
    }
    this.shadowRoot.querySelector("[data-palette-result-count]").textContent =
      `${readyCount} ready · ${resultCount} shown`;
    this.shadowRoot.querySelector("[data-palette-toggle-count]").textContent =
      `${readyCount} ready · ${resultCount} shown`;
    this.shadowRoot.querySelector("[data-search-empty]").hidden = resultCount > 0;
  };

  #handlePointerDown = (event) => {
    const outputPort = event.target.closest('[data-port="output"]');
    if (outputPort) {
      event.preventDefault();
      this.#suppressPortClick = true;
      this.#connectionSource = this.#model.nodes.find(
        (candidate) => candidate.id === outputPort.closest("[data-node-id]")?.dataset.nodeId,
      )?.element ?? null;
      window.addEventListener("pointerup", this.#cancelConnection, { once: true });
      window.addEventListener("pointercancel", this.#cancelConnection, { once: true });
      return;
    }
    if (!event.target.closest("[data-drag-handle]")) return;
    const card = event.target.closest("[data-node-id]");
    if (!card || event.button > 0) return;
    const node = this.#model.nodes.find((candidate) => candidate.id === card.dataset.nodeId);
    if (!node) return;
    this.#drag = {
      card,
      element: node.element,
      startX: event.clientX,
      startY: event.clientY,
      originX: node.position.x ?? card.offsetLeft,
      originY: node.position.y ?? card.offsetTop,
    };
    window.addEventListener("pointermove", this.#handlePointerMove);
    window.addEventListener("pointerup", this.#handlePointerUp, { once: true });
  };

  #handlePortPointerUp = (event) => {
    if (!this.#connectionSource) return;
    // Touch pointer capture can retarget pointerup to the output even over an input.
    const hit = this.shadowRoot.elementFromPoint(event.clientX, event.clientY);
    const inputPort = hit?.closest('[data-port="input"]')
      ?? event.target.closest('[data-port="input"]');
    const source = this.#connectionSource;
    this.#cancelConnection();
    if (!inputPort) {
      this.#armSource(source);
      return;
    }
    const targetId = inputPort.closest("[data-node-id]")?.dataset.nodeId;
    const target = this.#model.nodes.find((candidate) => candidate.id === targetId)?.element;
    if (target) this.#connectPorts(source, target);
  };

  #armSource(source) {
    this.#setArmedSource(this.#armedSource === source ? null : source);
    this.#announce(this.#armedSource
      ? `From #${source.id}: choose an input port, or press Escape to cancel`
      : "Connection cancelled");
  }

  #setArmedSource(source) {
    this.#armedSource = source;
    for (const port of this.shadowRoot.querySelectorAll('[data-port="output"]')) {
      port.setAttribute("aria-pressed", String(port.closest("[data-node-id]")?.dataset.nodeId === this.#armedSource?.id));
    }
  }

  #connectPorts(source, target) {
    this.#setArmedSource(null);
    this.#run(() => {
      this.connect(source, target);
      this.#announce(`${source.id} connected to ${target.id}`);
    });
  }

  #handleKeyDown = (event) => {
    if (event.key === "Escape" && this.#armedSource) {
      this.#armSource(this.#armedSource);
      event.preventDefault();
      return;
    }
    const navigatorButton = event.target.closest("[data-navigate-node]");
    if (navigatorButton) {
      const buttons = [...this.shadowRoot.querySelectorAll("[data-navigate-node]")];
      const index = buttons.indexOf(navigatorButton);
      const list = navigatorButton.closest(".navigator-list");
      const columns = getComputedStyle(list).gridTemplateColumns.split(" ").length;
      const next = { ArrowRight: index + 1, ArrowDown: index + columns,
        ArrowLeft: index - 1, ArrowUp: index - columns, Home: 0, End: buttons.length - 1 }[event.key];
      if (next !== undefined) {
        buttons[Math.max(0, Math.min(buttons.length - 1, next))]?.focus();
        event.preventDefault();
      }
      return;
    }
    if (event.key === "Escape") {
      const nodeId = event.target.closest("[data-node-id]")?.dataset.nodeId;
      if (nodeId) {
        if (this.#navigatorView === "overview") this.#setNavigatorView("nodes");
        const button = this.shadowRoot.querySelector(`[data-navigate-node="${CSS.escape(nodeId)}"]`);
        button?.focus();
        button?.scrollIntoView({ block: "nearest" });
        event.preventDefault();
      }
      return;
    }
    if (!event.target.closest("[data-drag-handle]")) return;
    const direction = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }[event.key];
    if (!direction) return;
    const card = event.target.closest("[data-node-id]");
    const node = this.#model.nodes.find((candidate) => candidate.id === card?.dataset.nodeId);
    if (!node) return;
    event.preventDefault();
    const step = event.shiftKey ? 1 : 16;
    const x = card.offsetLeft + direction[0] * step;
    const y = card.offsetTop + direction[1] * step;
    this.#run(() => {
      this.#mutate("nodechange", "move", () => {
        this.#adapter.setPosition(node.element, { x, y });
        return node.element;
      }, { x, y });
      this.#announce(`${node.id} moved`);
    });
  };

  #handlePointerMove = (event) => {
    if (!this.#drag) return;
    const x = this.#drag.originX + event.clientX - this.#drag.startX;
    const y = this.#drag.originY + event.clientY - this.#drag.startY;
    this.#drag.card.style.setProperty("--node-x", `${x}px`);
    this.#drag.card.style.setProperty("--node-y", `${y}px`);
    this.#updateEdges();
  };

  #handlePointerUp = (event) => {
    if (!this.#drag) return;
    const drag = this.#drag;
    const x = drag.originX + event.clientX - drag.startX;
    const y = drag.originY + event.clientY - drag.startY;
    this.#endDrag();
    this.#run(() => this.#mutate("nodechange", "move", () => {
      this.#adapter.setPosition(drag.element, { x, y });
      return drag.element;
    }, { x, y }));
  };

  #endDrag() {
    window.removeEventListener("pointermove", this.#handlePointerMove);
    window.removeEventListener("pointerup", this.#handlePointerUp);
    this.#drag = null;
  }

  #cancelConnection = () => {
    window.removeEventListener("pointerup", this.#cancelConnection);
    window.removeEventListener("pointercancel", this.#cancelConnection);
    this.#connectionSource = null;
    if (this.#suppressPortClick) setTimeout(() => { this.#suppressPortClick = false; });
  };

  #selectedNode() {
    return this.#model.nodes.find((node) => node.id === this.#selectedId) ?? null;
  }

  #relationships(selected) {
    if (!selected) return { incoming: [], outgoing: [] };
    const incoming = new Map();
    const outgoing = new Map();
    for (const edge of this.#model.edges) {
      if (edge.to.id === selected.id) incoming.set(edge.from.id, edge.from);
      if (edge.from.id === selected.id) outgoing.set(edge.to.id, edge.to);
    }
    return { incoming: [...incoming.values()], outgoing: [...outgoing.values()] };
  }

  #completeAddition(element, message) {
    this.#selectedId = element.id;
    this.#announce(message);
    this.#queueRender();
    requestAnimationFrame(() => this.#revealNode(element.id));
  }

  #announce(message, tone = "info") {
    this.#paletteStatus = message;
    this.#statusTone = tone;
    for (const status of this.shadowRoot.querySelectorAll("[data-palette-status], [data-editor-status]")) {
      status.textContent = message;
      status.dataset.tone = tone;
    }
  }

  #selectNode(id, reveal = false) {
    this.#selectedId = id;
    this.#render();
    const card = [...this.shadowRoot.querySelectorAll("[data-node-id]")]
      .find((candidate) => candidate.dataset.nodeId === id);
    card?.querySelector(".node-select")?.focus();
    if (reveal) requestAnimationFrame(() => this.#revealNode(id));
  }

  #revealNode(id) {
    const card = [...this.shadowRoot.querySelectorAll("[data-node-id]")]
      .find((candidate) => candidate.dataset.nodeId === id);
    card?.querySelector(".node-select")?.focus();
    card?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  #setOrchestrationProperty(element, name, value) {
    if (element.parentElement !== this) {
      throw new DOMException("Graph orchestration node is outside this editor", "NotFoundError");
    }
    const allowed = element.localName === "graph-event"
      ? ["from", "type"]
      : ["from", "handler"];
    if (!allowed.includes(name)) {
      throw new TypeError(`${name} is not editable on <${element.localName}>`);
    }

    const hadAttribute = element.hasAttribute(name);
    const previous = element.getAttribute(name);
    element.setAttribute(name, String(value ?? ""));
    try {
      if (element.localName === "graph-event") {
        const source = findUniqueGraphElement(this, element.getAttribute("from"));
        if (source === element) throw new DOMException("<graph-event> cannot listen to itself", "SyntaxError");
        assertGraphAcyclic(this, element, source);
        if (!element.getAttribute("type")?.trim()) {
          throw new DOMException("<graph-event> requires a non-empty type", "SyntaxError");
        }
      } else {
        findGraphActionSource(this, element, element.getAttribute("from"));
        parseGraphHandler(element.getAttribute("handler"));
      }
    } catch (error) {
      if (hadAttribute) element.setAttribute(name, previous);
      else element.removeAttribute(name);
      throw error;
    }
  }

  #nextId(prefix) {
    let index = 1;
    while (this.querySelectorAll(`[id="${prefix}-${index}"]`).length > 0) index += 1;
    return `${prefix}-${index}`;
  }

  #updateEdges() {
    const surface = this.shadowRoot.querySelector(".canvas-surface");
    if (!surface) return;
    const surfaceRect = surface.getBoundingClientRect();
    const cards = new Map(
      [...this.shadowRoot.querySelectorAll("[data-node-id]")].map((card) => [
        card.dataset.nodeId,
        card,
      ]),
    );

    for (const [index, edge] of this.#model.edges.entries()) {
      const path = this.shadowRoot.querySelector(`[data-edge-index="${index}"]`);
      const fromCard = cards.get(edge.from.id);
      const toCard = cards.get(edge.to.id);
      if (!path || !fromCard || !toCard) continue;
      const fromTarget = fromCard.querySelector('[data-port="output"]') ?? fromCard;
      const toTarget = toCard.querySelector('[data-port="input"]') ?? toCard;
      const fromRect = fromTarget.getBoundingClientRect();
      const toRect = toTarget.getBoundingClientRect();
      const fromX = fromRect.left - surfaceRect.left + fromRect.width / 2;
      const fromY = fromRect.top - surfaceRect.top + fromRect.height / 2;
      const toX = toRect.left - surfaceRect.left + toRect.width / 2;
      const toY = toRect.top - surfaceRect.top + toRect.height / 2;
      const control = Math.max(36, Math.abs(toX - fromX) / 2);
      path.setAttribute(
        "d",
        `M ${fromX} ${fromY} C ${fromX + control} ${fromY}, ${toX - control} ${toY}, ${toX} ${toY}`,
      );
    }
  }

  #mutate(type, operation, mutation, metadata = {}) {
    if (!this.#adapter || !this.#root) {
      const located = findGraphAdapter(this);
      this.#adapter = located.adapter;
      this.#root = located.root;
    }
    try {
      const data = mutation();
      const detail = { data, metadata: { operation, ...metadata } };
      this.dispatchEvent(new CustomEvent(type, { detail }));
      this.dispatchEvent(new CustomEvent("change", { detail }));
      this.#queueRender();
      return data;
    } catch (error) {
      this.#reportError(error);
      throw error;
    }
  }

  #run(operation) {
    try {
      operation();
    } catch (error) {
      // Public mutation methods already emit a structured error event.
      this.#announce(error.message, "error");
    }
  }

  #reportError(error) {
    this.dispatchEvent(new CustomEvent("error", {
      detail: { data: error, metadata: { rootId: this.#root?.id || null } },
    }));
  }
}

if (!customElements.get("graph-editor")) {
  customElements.define("graph-editor", GraphEditorElement);
}
