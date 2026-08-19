import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stagePages } from "../../scripts/stage-pages.js";

test("stages only the static site and runtime source", async () => {
  await assert.rejects(
    stagePages({ root: process.cwd(), destination: process.cwd() }),
    /must not overlap the repository or published sources/,
  );

  const destination = await mkdtemp(join(tmpdir(), "extended-html-pages-"));

  try {
    await writeFile(join(destination, "stale.txt"), "remove me");
    await stagePages({ root: process.cwd(), destination });

    const expectedFiles = [
      "index.html",
      "examples/index.html",
      "examples/web-socket/index.html",
      "examples/web-socket/background.html",
      "guide/en/index.html",
      "guide/ja/index.html",
      "guide/assets/guide.css",
      "src/index.js",
      "src/web-socket/web-socket.worker.js",
    ];

    for (const file of expectedFiles) {
      assert.ok((await readFile(join(destination, file), "utf8")).length > 0, file);
    }

    await assert.rejects(readFile(join(destination, "stale.txt")));
    await assert.rejects(readFile(join(destination, "tests")));
    await assert.rejects(readFile(join(destination, "node_modules")));
    await assert.rejects(readFile(join(destination, "agents")));

    const example = await readFile(
      join(destination, "examples/web-socket/index.html"),
      "utf8",
    );
    assert.match(example, /\.\.\/\.\.\/src\/index\.js/);
  } finally {
    await rm(destination, { recursive: true, force: true });
  }
});
