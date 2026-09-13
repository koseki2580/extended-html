export const graphEditorStyles = `
  :host {
    --graph-accent: #2563eb;
    --graph-border: #cbd5e1;
    --graph-panel: #ffffff;
    --graph-canvas: #f8fafc;
    color: #172033;
    display: block;
    font: 14px/1.45 system-ui, sans-serif;
  }

  * { box-sizing: border-box; }
  button, input, select { font: inherit; }
  button { cursor: pointer; }
  button:disabled { cursor: not-allowed; opacity: .5; }

  .layout {
    background: var(--graph-panel);
    border: 1px solid var(--graph-border);
    border-radius: 12px;
    display: grid;
    grid-template-columns: minmax(10rem, 14rem) minmax(20rem, 1fr) minmax(13rem, 18rem);
    min-height: 34rem;
    overflow: hidden;
  }

  .panel { padding: 1rem; }
  .palette { border-inline-end: 1px solid var(--graph-border); }
  .inspector { border-inline-start: 1px solid var(--graph-border); }
  h2 { font-size: .78rem; letter-spacing: .08em; margin: 0 0 .75rem; text-transform: uppercase; }

  .palette-list, .fields { display: grid; gap: .55rem; }
  .palette button, .toolbar button, .inspector button {
    background: #fff;
    border: 1px solid var(--graph-border);
    border-radius: 7px;
    min-height: 2.5rem;
    padding: .45rem .65rem;
    text-align: start;
  }
  .palette button:hover, .toolbar button:hover, .inspector button:hover { border-color: var(--graph-accent); }

  .workspace { background: var(--graph-canvas); display: grid; grid-template-rows: auto 1fr; min-width: 0; }
  .toolbar { align-items: end; background: #fff; border-block-end: 1px solid var(--graph-border); display: flex; flex-wrap: wrap; gap: .5rem; padding: .75rem; }
  .toolbar label { display: grid; font-size: .75rem; gap: .2rem; }
  .toolbar select { border: 1px solid var(--graph-border); border-radius: 6px; min-height: 2rem; }

  .canvas { min-height: 29rem; overflow: auto; position: relative; }
  svg { height: 100%; inset: 0; pointer-events: none; position: absolute; width: 100%; }
  path { fill: none; stroke: #8ba1bd; stroke-width: 2; }
  path[data-kind="event"], path[data-kind="action"] { stroke: #9333ea; stroke-dasharray: 5 4; }

  .node {
    background: #fff;
    border: 2px solid transparent;
    border-radius: 9px;
    box-shadow: 0 2px 9px rgb(15 23 42 / .12);
    left: var(--node-x);
    min-width: 9rem;
    padding: .35rem;
    position: absolute;
    top: var(--node-y);
    touch-action: none;
    user-select: none;
  }
  .node[aria-pressed="true"] { border-color: var(--graph-accent); }
  .node-select { background: transparent; border: 0; padding: .3rem .4rem; text-align: start; width: 100%; }
  .drag-handle { background: transparent; border: 0; color: #64748b; cursor: grab; float: inline-end; padding: .1rem .3rem; }
  .drag-handle:active { cursor: grabbing; }
  .node strong, .node small { display: block; }
  .node small { color: #64748b; margin-top: .2rem; }
  .node[data-kind="event"], .node[data-kind="action"] { border-style: dashed; }
  .ports { display: flex; justify-content: space-between; margin-top: .25rem; }
  .port { align-items: center; background: #dbeafe; border: 1px solid #60a5fa; border-radius: 999px; display: inline-flex; height: 1.35rem; justify-content: center; padding: 0; width: 1.35rem; }
  .port:focus-visible { outline: 3px solid #f59e0b; outline-offset: 2px; }

  .fields label { display: grid; gap: .25rem; }
  .fields input { border: 1px solid var(--graph-border); border-radius: 6px; min-height: 2.35rem; padding: .35rem .5rem; width: 100%; }
  .empty { color: #64748b; }
  .danger { color: #b91c1c; margin-top: 1rem; width: 100%; }

  @media (max-width: 820px) {
    .layout { grid-template-columns: 1fr; }
    .palette, .inspector { border: 0; }
    .palette { border-block-end: 1px solid var(--graph-border); }
    .inspector { border-block-start: 1px solid var(--graph-border); }
    .palette-list { grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr)); }
  }
`;
