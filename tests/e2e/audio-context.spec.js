import { test, expect } from "@playwright/test";
import { startTestServer } from "./support/test-server.js";

let server;

test.beforeAll(async () => {
  server = await startTestServer();
});

test.afterAll(async () => {
  await server.stop();
});

const openFixture = async (page) => {
  const browserErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") browserErrors.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => browserErrors.push(`pageerror: ${error.message}`));

  await page.goto(`${server.httpUrl}/tests/e2e/fixtures/audio-context.html`);
  await page.waitForFunction(() => globalThis.audioFixture?.ready === true);
  return browserErrors;
};

const snapshot = (page) => page.evaluate(() => globalThis.audioFixture.snapshot());

const sortNativeConnections = (items) =>
  [...items].sort((left, right) =>
    [left.source, left.destination, left.sourceId, left.destinationId]
      .join(":")
      .localeCompare(
        [right.source, right.destination, right.sourceId, right.destinationId].join(
          ":",
        ),
      ),
  );

const observeWebAudio = async (page) => {
  const session = await page.context().newCDPSession(page);
  const contextIds = new Set();
  const nodes = new Map();
  const connections = [];

  session.on("WebAudio.contextCreated", ({ context }) => {
    contextIds.add(context.contextId);
  });
  session.on("WebAudio.audioNodeCreated", ({ node }) => {
    contextIds.add(node.contextId);
    nodes.set(node.nodeId, node);
  });
  session.on("WebAudio.nodesConnected", (connection) => {
    connections.push(connection);
  });
  await session.send("WebAudio.enable");

  const constructorName = (nodeId) => {
    const nodeType = nodes.get(nodeId)?.nodeType;
    return nodeType ? `${nodeType}Node` : null;
  };

  return {
    graphs: () =>
      [...contextIds].map((contextId) => ({
        contextId,
        nodes: [...nodes.values()]
          .filter((node) => node.contextId === contextId)
          .map((node) => ({ id: node.nodeId, type: constructorName(node.nodeId) }))
          .sort((left, right) =>
            `${left.type}:${left.id}`.localeCompare(`${right.type}:${right.id}`),
          ),
        connections: sortNativeConnections(
          connections
            .filter((connection) => connection.contextId === contextId)
            .map(({ sourceId, destinationId }) => ({
              source: constructorName(sourceId),
              destination: constructorName(destinationId),
              sourceId,
              destinationId,
            })),
        ),
      })),
    async close() {
      await session.send("WebAudio.disable");
      await session.detach();
    },
  };
};

test("one context resume starts the nested microphone and file graph in DOM order", async ({
  page,
}) => {
  const webAudio = await observeWebAudio(page);

  try {
    const browserErrors = await openFixture(page);
    await page.evaluate(() => globalThis.audioFixture.context.resume());
    await page.waitForFunction(
      () =>
        globalThis.audioFixture.events.some(({ node, type }) =>
          node === "music" && (type === "play" || type === "playing"),
        ) && globalThis.audioFixture.context.state === "running",
    );

    const state = await snapshot(page);
    expect(state.contextState).toBe("running");
    expect(state.filePaused).toBe(false);
    expect(state.events.findIndex(({ node, type }) => node === "mic" && type === "open"))
      .toBeGreaterThanOrEqual(0);
    expect(state.events.findIndex(({ node, type }) => node === "music" && type === "play"))
      .toBeGreaterThan(state.events.findIndex(({ node, type }) => node === "mic" && type === "open"));

    const micOpen = state.events.find(({ node, type }) => node === "mic" && type === "open");
    expect(micOpen).toMatchObject({
      dataKind: "MediaStream",
      contextState: "running",
      metadata: { contextId: "audio", nodeId: "mic", nodeName: "audio-input-mic" },
    });
    expect(micOpen.trackStates).toEqual([{ enabled: true, readyState: "live" }]);

    const filePlay = state.events.find(({ node, type }) => node === "music" && type === "play");
    expect(filePlay).toMatchObject({
      dataKind: "Event",
      metadata: {
        contextId: "audio",
        nodeId: "music",
        nodeName: "audio-input-file",
      },
    });

    const requiredNodeTypes = [
      "AudioDestinationNode",
      "BiquadFilterNode",
      "MediaElementAudioSourceNode",
      "MediaStreamAudioSourceNode",
    ];
    const targetGraphs = webAudio.graphs().filter(({ nodes }) =>
      requiredNodeTypes.every((type) => nodes.some((node) => node.type === type)),
    );
    expect(targetGraphs).toHaveLength(1);
    const graph = targetGraphs[0];
    const nodeId = (type) => {
      const matches = graph.nodes.filter((node) => node.type === type);
      expect(matches, `${type} node in target AudioContext`).toHaveLength(1);
      return matches[0].id;
    };
    const destinationId = nodeId("AudioDestinationNode");
    const filterId = nodeId("BiquadFilterNode");
    const fileId = nodeId("MediaElementAudioSourceNode");
    const micId = nodeId("MediaStreamAudioSourceNode");
    expect(graph.connections).toHaveLength(3);
    expect(graph.connections).toEqual(
      sortNativeConnections([
        {
          source: "MediaStreamAudioSourceNode",
          destination: "BiquadFilterNode",
          sourceId: micId,
          destinationId: filterId,
        },
        {
          source: "MediaElementAudioSourceNode",
          destination: "BiquadFilterNode",
          sourceId: fileId,
          destinationId: filterId,
        },
        {
          source: "BiquadFilterNode",
          destination: "AudioDestinationNode",
          sourceId: filterId,
          destinationId,
        },
      ]),
    );
    expect(browserErrors).toEqual([]);
  } finally {
    await webAudio.close();
  }
});

test("suspend and resume pause and restart all sources through the context", async ({ page }) => {
  const browserErrors = await openFixture(page);
  await page.evaluate(() => globalThis.audioFixture.context.resume());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "running");

  await page.evaluate(() => globalThis.audioFixture.context.suspend());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "suspended");
  const suspended = await snapshot(page);
  expect(suspended.filePaused).toBe(true);
  expect(suspended.micTracks).toEqual([{ enabled: false, readyState: "live" }]);

  await page.evaluate(() => globalThis.audioFixture.context.resume());
  await page.waitForFunction(
    () =>
      globalThis.audioFixture.context.state === "running" &&
      !globalThis.audioFixture.file.paused,
  );
  const resumed = await snapshot(page);
  expect(resumed.micTracks).toEqual([{ enabled: true, readyState: "live" }]);
  expect(resumed.events.filter(({ node, type }) => node === "music" && type === "play"))
    .toHaveLength(2);
  expect(browserErrors).toEqual([]);
});

test("close is terminal and releases microphone and file sources", async ({ page }) => {
  const browserErrors = await openFixture(page);
  await page.evaluate(() => globalThis.audioFixture.context.resume());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "running");

  await page.evaluate(() => globalThis.audioFixture.context.close());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "closed");
  const closed = await snapshot(page);
  expect(closed.filePaused).toBe(true);
  expect(closed.micTracks).toEqual([{ enabled: true, readyState: "ended" }]);
  expect(closed.events.some(({ node, type }) => node === "mic" && type === "close"))
    .toBe(true);

  const rejection = await page.evaluate(async () => {
    try {
      await globalThis.audioFixture.context.resume();
      return null;
    } catch (error) {
      return { name: error.name, message: error.message };
    }
  });
  expect(rejection).toMatchObject({ name: "InvalidStateError" });
  expect(browserErrors).toEqual([]);
});

test("removing the context performs terminal cleanup", async ({ page }) => {
  const browserErrors = await openFixture(page);
  await page.evaluate(() => globalThis.audioFixture.context.resume());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "running");

  await page.evaluate(() => globalThis.audioFixture.context.remove());
  await page.waitForFunction(() => globalThis.audioFixture.context.state === "closed");
  const removed = await snapshot(page);
  expect(removed.connected).toBe(false);
  expect(removed.filePaused).toBe(true);
  expect(removed.micTracks).toEqual([{ enabled: true, readyState: "ended" }]);
  expect(browserErrors).toEqual([]);
});

test("a flat graph rejects with a wrapped SyntaxError without browser errors", async ({
  page,
}) => {
  const browserErrors = await openFixture(page);

  const result = await page.evaluate(async () => {
    const context = document.createElement("audio-context");
    context.id = "invalid-audio";
    context.innerHTML = `
      <audio-input-file src="/tests/e2e/fixtures/tone.wav"></audio-input-file>
      <audio-biquad-filter id="flat-filter"></audio-biquad-filter>
      <audio-output></audio-output>
    `;
    const errors = [];
    context.addEventListener("error", (event) => {
      errors.push({
        dataName: event.detail.data.name,
        metadata: event.detail.metadata,
      });
    });
    document.querySelector("#invalid-host").append(context);

    let rejection = null;
    try {
      await context.resume();
    } catch (error) {
      rejection = { name: error.name, message: error.message };
    }
    return { rejection, errors, state: context.state };
  });

  expect(result.rejection).toMatchObject({ name: "SyntaxError" });
  expect(result.errors).toEqual([
    {
      dataName: "SyntaxError",
      metadata: {
        contextId: "invalid-audio",
        nodeId: "invalid-audio",
        nodeName: "audio-context",
      },
    },
  ]);
  expect(result.state).toBe("suspended");
  expect(browserErrors).toEqual([]);
});
