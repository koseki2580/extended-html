import { findGraphAdapter } from "./graph-adapters.js";
import { graphEditorStyles } from "./graph-editor.css.js";
import { findUniqueGraphElement, parseGraphHandler } from "./graph-handler.js";

const escapeHtml = (value) =>
  String(value)
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const orchestrationDescriptor = (element, kind, properties) => ({
  element,
  id: element.id,
  nodeName: element.localName,
  kind,
  label: kind === "event" ? "Event" : "Action",
  properties: properties.map((name) => ({ name, value: element.getAttribute(name) })),
  events: kind === "event" ? ["data"] : ["run"],
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

  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this.shadowRoot.addEventListener("click", this.#handleClick);
    this.shadowRoot.addEventListener("change", this.#handleChange);
    this.shadowRoot.addEventListener("pointerdown", this.#handlePointerDown);
    this.shadowRoot.addEventListener("pointerup", this.#handlePortPointerUp);
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

  addNode(localName, options = {}) {
    return this.#mutate("nodeadd", "add", () =>
      this.#adapter.addNode(this.#root, localName, options),
    );
  }

  removeNode(element) {
    return this.#mutate("noderemove", "remove", () => {
      this.#adapter.removeNode(this.#root, element);
      return element;
    });
  }

  connect(from, to) {
    return this.#mutate("edgeconnect", "connect", () => {
      this.#adapter.connect(this.#root, from, to);
      return { from, to };
    });
  }

  disconnect(from, to) {
    return this.#mutate("edgedisconnect", "disconnect", () => {
      this.#adapter.disconnect(this.#root, from, to);
      return { from, to };
    });
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

  addAction(eventElement, handler = "HandleGraphEvent(event)") {
    return this.#mutate("nodeadd", "add-action", () => {
      if (eventElement?.localName !== "graph-event" || !eventElement.id) {
        throw new TypeError("An action requires an identified <graph-event>");
      }
      parseGraphHandler(handler);
      const element = document.createElement("graph-action");
      element.id = this.#nextId("graph-action");
      element.setAttribute("from", eventElement.id);
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

    for (const element of this.querySelectorAll(":scope > graph-event")) {
      if (!element.id) element.id = this.#nextId("graph-event");
      const node = orchestrationDescriptor(element, "event", ["from", "type"]);
      nodes.push(node);
      byId.set(node.id, node);
      const source = byId.get(element.getAttribute("from"));
      if (source) edges.push({ from: source, to: node, kind: "event" });
    }
    for (const element of this.querySelectorAll(":scope > graph-action")) {
      if (!element.id) element.id = this.#nextId("graph-action");
      const node = orchestrationDescriptor(element, "action", ["from", "handler"]);
      nodes.push(node);
      byId.set(node.id, node);
      const source = byId.get(element.getAttribute("from"));
      if (source) edges.push({ from: source, to: node, kind: "action" });
    }
    return { ...model, nodes, edges };
  }

  #render() {
    try {
      this.#model = this.#readModel();
      if (this.#selectedId && !this.#model.nodes.some((node) => node.id === this.#selectedId)) {
        this.#selectedId = null;
      }
      const selected = this.#model.nodes.find((node) => node.id === this.#selectedId) ?? null;
      this.shadowRoot.innerHTML = `
        <style>${graphEditorStyles}</style>
        <div class="layout">
          <aside class="panel palette" aria-label="Graph node palette">
            <h2>Nodes</h2>
            <div class="palette-list">
              ${this.#adapter.nodeTypes.map((type) => `
                <button type="button" data-add-node="${escapeHtml(type.localName)}"
                  data-node-kind="${escapeHtml(type.kind)}">Add ${escapeHtml(type.label)}</button>
              `).join("")}
              <button type="button" data-action="add-event" ${selected?.events.length ? "" : "disabled"}>Add Event</button>
              <button type="button" data-action="add-action" ${selected?.kind === "event" ? "" : "disabled"}>Add Action</button>
            </div>
          </aside>
          <section class="workspace" aria-label="Graph canvas">
            ${this.#toolbarMarkup()}
            <div class="canvas">
              <svg aria-hidden="true" preserveAspectRatio="none">
                ${this.#model.edges.map((edge, index) => `<path data-edge-index="${index}" data-edge-from="${escapeHtml(edge.from.id)}" data-edge-to="${escapeHtml(edge.to.id)}" data-kind="${escapeHtml(edge.kind)}" d=""></path>`).join("")}
              </svg>
              ${this.#model.nodes.map((node, index) => this.#nodeMarkup(node, index)).join("")}
            </div>
          </section>
          <aside class="panel inspector" aria-label="Graph node inspector">
            <h2>Inspector</h2>
            ${this.#inspectorMarkup(selected)}
          </aside>
        </div>
      `;
      this.#updateEdges();
      requestAnimationFrame(() => this.#updateEdges());
      this.dispatchEvent(new CustomEvent("ready", {
        detail: {
          data: this.#model,
          metadata: { nodeCount: this.#model.nodes.length, edgeCount: this.#model.edges.length },
        },
      }));
    } catch (error) {
      this.#reportError(error);
    }
  }

  #toolbarMarkup() {
    const nodes = this.#model.nodes.filter(
      (node) => !["event", "action", "consumer"].includes(node.kind),
    );
    const options = (selectedId) => nodes
      .map((node) => `<option value="${escapeHtml(node.id)}" ${node.id === selectedId ? "selected" : ""}>${escapeHtml(node.id || node.label)}</option>`)
      .join("");
    return `
      <div class="toolbar" aria-label="Keyboard edge controls">
        <label>From<select data-connect-from><option value="">Choose node</option>${options(this.#connectFromId)}</select></label>
        <label>To<select data-connect-to><option value="">Choose node</option>${options(this.#connectToId)}</select></label>
        <button type="button" data-action="connect">Connect</button>
        <button type="button" data-action="disconnect">Disconnect</button>
      </div>
    `;
  }

  #nodeMarkup(node, index) {
    const x = node.position.x ?? 24 + (index % 3) * 176;
    const y = node.position.y ?? 28 + Math.floor(index / 3) * 112;
    return `
      <div class="node" data-node-id="${escapeHtml(node.id)}"
        data-kind="${escapeHtml(node.kind)}" aria-pressed="${node.id === this.#selectedId}"
        style="--node-x:${x}px;--node-y:${y}px">
        <button class="drag-handle" type="button" data-drag-handle aria-label="Move ${escapeHtml(node.id)}">⠿</button>
        <button class="node-select" type="button">
          <strong>${escapeHtml(node.label)}</strong><small>${escapeHtml(node.id || node.nodeName)}</small>
        </button>
        <span class="ports">
          ${["source", "event"].includes(node.kind) ? "<span></span>" : `<button class="port" type="button" data-port="input" aria-label="Connect into ${escapeHtml(node.id)}">←</button>`}
          ${["output", "consumer", "action"].includes(node.kind) ? "<span></span>" : `<button class="port" type="button" data-port="output" aria-label="Connect from ${escapeHtml(node.id)}">→</button>`}
        </span>
      </div>
    `;
  }

  #inspectorMarkup(selected) {
    if (!selected) return '<p class="empty">Select a node to edit it.</p>';
    const fields = selected.properties.map((property) => `
      <label>${escapeHtml(property.name)}
        <input data-property="${escapeHtml(property.name)}" value="${escapeHtml(property.value ?? "")}">
      </label>
    `).join("");
    return `
      <p><strong>${escapeHtml(selected.label)}</strong><br><small>${escapeHtml(selected.id)}</small></p>
      <div class="fields">${fields || '<span class="empty">No editable properties.</span>'}</div>
      ${["event", "action"].includes(selected.kind) ? "" : '<button class="danger" type="button" data-action="remove">Remove node</button>'}
    `;
  }

  #handleClick = (event) => {
    const nodeButton = event.target.closest("[data-node-id]");
    if (nodeButton) {
      this.#selectedId = nodeButton.dataset.nodeId;
      this.#render();
      return;
    }

    const addButton = event.target.closest("[data-add-node]");
    if (addButton) {
      const selected = this.#selectedNode();
      const options = addButton.dataset.nodeKind === "source" ? {} : { parent: selected?.element };
      this.#run(() => {
        const element = this.addNode(addButton.dataset.addNode, options);
        this.#selectedId = element.id;
      });
      return;
    }

    const action = event.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    this.#run(() => this.#performAction(action));
  };

  #performAction(action) {
    if (action === "connect" || action === "disconnect") {
      const fromId = this.shadowRoot.querySelector("[data-connect-from]").value;
      const toId = this.shadowRoot.querySelector("[data-connect-to]").value;
      this.#connectFromId = fromId;
      this.#connectToId = toId;
      const from = this.#model.nodes.find((node) => node.id === fromId)?.element;
      const to = this.#model.nodes.find((node) => node.id === toId)?.element;
      if (!from || !to) throw new TypeError("Choose both edge endpoints");
      return this[action](from, to);
    }
    const selected = this.#selectedNode();
    if (action === "remove") return this.removeNode(selected.element);
    if (action === "add-event") {
      if (!selected?.events.length) throw new TypeError("Selected node exposes no events");
      return this.addEvent(selected.element, selected.events[0]);
    }
    if (action === "add-action") return this.addAction(selected.element);
  }

  #handleChange = (event) => {
    const input = event.target.closest("[data-property]");
    if (!input) return;
    const selected = this.#selectedNode();
    this.#run(() => this.setProperty(selected.element, input.dataset.property, input.value));
  };

  #handlePointerDown = (event) => {
    const outputPort = event.target.closest('[data-port="output"]');
    if (outputPort) {
      event.preventDefault();
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
    const inputPort = event.target.closest('[data-port="input"]');
    const source = this.#connectionSource;
    this.#cancelConnection();
    if (!inputPort || !source) return;
    const targetId = inputPort.closest("[data-node-id]")?.dataset.nodeId;
    const target = this.#model.nodes.find((candidate) => candidate.id === targetId)?.element;
    if (target) this.#run(() => this.connect(source, target));
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
  };

  #selectedNode() {
    return this.#model.nodes.find((node) => node.id === this.#selectedId) ?? null;
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
        if (!element.getAttribute("type")?.trim()) {
          throw new DOMException("<graph-event> requires a non-empty type", "SyntaxError");
        }
      } else {
        findUniqueGraphElement(this, element.getAttribute("from"), "graph-event");
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
    const canvas = this.shadowRoot.querySelector(".canvas");
    if (!canvas) return;
    const canvasRect = canvas.getBoundingClientRect();
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
      const fromX = fromRect.left - canvasRect.left + canvas.scrollLeft + fromRect.width / 2;
      const fromY = fromRect.top - canvasRect.top + canvas.scrollTop + fromRect.height / 2;
      const toX = toRect.left - canvasRect.left + canvas.scrollLeft + toRect.width / 2;
      const toY = toRect.top - canvasRect.top + canvas.scrollTop + toRect.height / 2;
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
    } catch {
      // Public mutation methods already emit a structured error event.
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
