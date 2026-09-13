export const graphEditorStyles = `
  :host {
    color-scheme: dark;
    --graph-accent: #38bdf8;
    --graph-accent-strong: #7dd3fc;
    --graph-border: #3d4f68;
    --graph-border-strong: #64748b;
    --graph-panel: #101b2d;
    --graph-panel-raised: #17243a;
    --graph-canvas: #0b1424;
    --graph-text: #f8fafc;
    --graph-muted: #aebed2;
    --graph-danger: #fda4af;
    color: var(--graph-text);
    container-type: inline-size;
    display: block;
    font: 0.875rem/1.45 "IBM Plex Sans", Inter, ui-sans-serif, system-ui, sans-serif;
  }

  * { box-sizing: border-box; }
  button, input, select { color: var(--graph-text); font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .48; }
  button:focus-visible, input:focus-visible, select:focus-visible, .canvas:focus-visible {
    outline: 3px solid var(--graph-accent);
    outline-offset: 2px;
  }
  svg { display: block; }

  .layout {
    background: var(--graph-panel);
    border: 1px solid var(--graph-border);
    border-radius: 0.9rem;
    display: grid;
    grid-template-columns: minmax(11rem, 13rem) minmax(22rem, 1fr) minmax(14rem, 17rem);
    min-height: 38rem;
    overflow: hidden;
  }

  .panel { min-width: 0; padding: 1rem; }
  .palette { border-inline-end: 1px solid var(--graph-border); }
  .inspector { border-inline-start: 1px solid var(--graph-border); }
  .panel-heading { margin-block-end: 1rem; }
  h2 {
    color: var(--graph-text);
    font-size: .75rem;
    letter-spacing: .12em;
    margin: 0;
    text-transform: uppercase;
  }
  .panel-heading p {
    color: var(--graph-muted);
    font-size: .75rem;
    margin: .2rem 0 0;
  }

  .palette-list, .fields { display: grid; gap: .55rem; }
  .palette button, .toolbar button, .inspector button {
    background: var(--graph-panel-raised);
    border: 1px solid var(--graph-border);
    border-radius: .6rem;
    color: var(--graph-text);
    min-block-size: 2.75rem;
  }
  .palette button {
    align-items: center;
    display: grid;
    gap: .65rem;
    grid-template-columns: 2rem minmax(0, 1fr);
    padding: .45rem .55rem;
    text-align: start;
    width: 100%;
  }
  .palette button:hover:not(:disabled), .toolbar button:hover:not(:disabled),
  .inspector button:hover:not(:disabled) {
    background: #1e304a;
    border-color: var(--graph-accent);
  }
  .palette button strong, .palette button small { display: block; }
  .palette button strong { font-size: .82rem; }
  .palette button small { color: var(--graph-muted); font-size: .68rem; margin-block-start: .08rem; }
  .palette-icon, .kind-icon {
    align-items: center;
    background: #203552;
    border: 1px solid #47617f;
    border-radius: .5rem;
    color: var(--graph-accent-strong);
    display: inline-flex;
    justify-content: center;
  }
  .palette-icon { block-size: 2rem; inline-size: 2rem; }
  .palette-icon svg, .kind-icon svg, .drag-handle svg, .port svg {
    fill: none;
    height: 1.15rem;
    stroke: currentColor;
    stroke-linecap: round;
    stroke-linejoin: round;
    stroke-width: 1.8;
    width: 1.15rem;
  }

  .workspace {
    background: var(--graph-canvas);
    display: grid;
    grid-template-rows: auto minmax(30rem, 1fr);
    min-width: 0;
  }
  .toolbar {
    align-items: center;
    background: var(--graph-panel);
    border-block-end: 1px solid var(--graph-border);
    display: grid;
    gap: .4rem .55rem;
    grid-template-columns: auto minmax(7rem, 1fr) auto auto minmax(7rem, 1fr) auto;
    padding: .75rem;
  }
  .toolbar-heading { grid-column: 1 / -1; }
  .toolbar-heading strong, .toolbar-heading small { display: block; }
  .toolbar-heading strong { font-size: .8rem; }
  .toolbar-heading small { color: var(--graph-muted); font-size: .7rem; }
  .toolbar label { color: var(--graph-muted); font-size: .72rem; font-weight: 700; }
  .toolbar select {
    background: var(--graph-panel-raised);
    border: 1px solid var(--graph-border-strong);
    border-radius: .55rem;
    color: var(--graph-text);
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding-inline: .65rem 1.7rem;
  }
  .toolbar-arrow { color: var(--graph-accent-strong); font-size: 1rem; }
  .toolbar-actions { display: flex; gap: .4rem; }
  .toolbar button { padding: .45rem .7rem; text-align: center; }
  .toolbar [data-action="connect"] {
    background: var(--graph-accent);
    border-color: var(--graph-accent);
    color: #06283a;
    font-weight: 750;
  }

  .canvas {
    min-height: 30rem;
    overflow: auto;
    overscroll-behavior: contain;
    position: relative;
    scrollbar-color: var(--graph-border-strong) var(--graph-canvas);
  }
  .canvas-surface {
    background-image:
      radial-gradient(circle, #334155 1px, transparent 1px);
    background-size: 1.5rem 1.5rem;
    height: max(100%, var(--canvas-height));
    min-height: 30rem;
    position: relative;
    width: max(100%, var(--canvas-width));
  }
  .canvas-surface > svg {
    height: 100%;
    inset: 0;
    pointer-events: none;
    position: absolute;
    width: 100%;
  }
  .canvas-surface > svg > path { fill: none; stroke: #7390b5; stroke-width: 2; }
  .canvas-surface > svg > path[data-kind="event"],
  .canvas-surface > svg > path[data-kind="action"] {
    stroke: #c084fc;
    stroke-dasharray: 6 5;
  }

  .node {
    background: var(--graph-panel-raised);
    border: 1px solid var(--graph-border-strong);
    border-radius: .75rem;
    box-shadow: 0 .6rem 1.5rem rgb(0 0 0 / .24);
    color: var(--graph-text);
    left: var(--node-x);
    min-height: 8rem;
    padding: .45rem;
    position: absolute;
    top: var(--node-y);
    touch-action: none;
    user-select: none;
    width: 10rem;
  }
  .node:has(.node-select[aria-pressed="true"]) {
    border-color: var(--graph-accent);
    box-shadow: 0 0 0 2px rgb(56 189 248 / .2), 0 .6rem 1.5rem rgb(0 0 0 / .24);
  }
  .node[data-kind="event"], .node[data-kind="action"] { border-style: dashed; }
  .node-header {
    align-items: center;
    display: grid;
    grid-template-columns: 1.75rem minmax(0, 1fr) 2.75rem;
    min-height: 2.75rem;
  }
  .kind-icon {
    block-size: 1.75rem;
    border-radius: .4rem;
    inline-size: 1.75rem;
  }
  .kind-icon svg { height: 1rem; width: 1rem; }
  .kind-label {
    color: var(--graph-muted);
    font-size: .64rem;
    font-weight: 700;
    letter-spacing: .08em;
    overflow: hidden;
    text-overflow: ellipsis;
    text-transform: uppercase;
    white-space: nowrap;
  }
  .drag-handle {
    align-items: center;
    background: transparent;
    border: 0;
    color: var(--graph-muted);
    cursor: grab;
    display: inline-flex;
    justify-content: center;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding: 0;
  }
  .drag-handle:active { cursor: grabbing; }
  .drag-handle svg { fill: currentColor; stroke: none; }
  .node-select {
    background: transparent;
    border: 0;
    color: var(--graph-text);
    min-block-size: 2.75rem;
    padding: .25rem .35rem .6rem;
    text-align: start;
    width: 100%;
  }
  .node strong, .node small { display: block; overflow-wrap: anywhere; }
  .node strong { color: var(--graph-text); font-size: .86rem; }
  .node small {
    color: var(--graph-muted);
    font: .68rem "JetBrains Mono", ui-monospace, monospace;
    margin-top: .15rem;
  }
  .ports { display: flex; justify-content: space-between; min-height: 2.75rem; }
  .port {
    align-items: center;
    background: #163652;
    border: 1px solid #4eb6eb;
    border-radius: 999px;
    color: #bae6fd;
    display: inline-flex;
    justify-content: center;
    min-block-size: 2.75rem;
    min-inline-size: 2.75rem;
    padding: 0;
  }

  .fields label { color: var(--graph-muted); display: grid; font-size: .75rem; gap: .3rem; }
  .fields input {
    background: var(--graph-canvas);
    border: 1px solid var(--graph-border-strong);
    border-radius: .55rem;
    color: var(--graph-text);
    min-height: 2.75rem;
    padding: .45rem .55rem;
    width: 100%;
  }
  .empty { color: var(--graph-muted); }
  .danger { color: var(--graph-danger); margin-top: 1rem; padding: .5rem .7rem; width: 100%; }

  @container (max-width: 70rem) {
    .layout { grid-template-columns: minmax(11rem, 13rem) minmax(0, 1fr); }
    .inspector {
      border-block-start: 1px solid var(--graph-border);
      border-inline-start: 0;
      grid-column: 1 / -1;
    }
    .inspector .fields { grid-template-columns: repeat(auto-fit, minmax(10rem, 1fr)); }
  }

  @container (max-width: 47.5rem) {
    .layout { grid-template-columns: minmax(0, 1fr); }
    .palette, .inspector { border-inline: 0; }
    .palette { border-block-end: 1px solid var(--graph-border); }
    .inspector { grid-column: auto; }
    .palette-list { grid-template-columns: repeat(auto-fit, minmax(9.5rem, 1fr)); }
    .toolbar { grid-template-columns: auto minmax(0, 1fr); }
    .toolbar-heading, .toolbar-actions { grid-column: 1 / -1; }
    .toolbar-arrow { display: none; }
    .toolbar-actions button { flex: 1; }
    .workspace { grid-template-rows: auto 30rem; }
  }

  @media (pointer: coarse) {
    .palette button, .toolbar button, .toolbar select, .drag-handle, .node-select, .port {
      min-block-size: 2.75rem;
      min-inline-size: 2.75rem;
    }
  }

  @media (forced-colors: active) {
    .layout, .palette, .inspector, .toolbar, .node, .palette button,
    .toolbar button, .toolbar select, .fields input, .port {
      border-color: CanvasText;
    }
    .node:has(.node-select[aria-pressed="true"]) { outline: 3px solid Highlight; }
  }
`;
