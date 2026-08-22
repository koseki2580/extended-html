import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { stagePages } from "../../scripts/stage-pages.js";

const listFiles = async (directory, relativeDirectory = "") => {
  const entries = await readdir(join(directory, relativeDirectory), {
    withFileTypes: true,
  });
  const files = [];
  for (const entry of entries) {
    const relativePath = join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listFiles(directory, relativePath)));
    } else if (entry.isFile()) {
      files.push(relativePath);
    }
  }
  return files.sort();
};

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

    const audioSource = join(process.cwd(), "src/audio");
    const audioFiles = await listFiles(audioSource);
    assert.ok(audioFiles.includes("index.js"), "src/audio/index.js");
    for (const file of audioFiles) {
      assert.deepEqual(
        await readFile(join(destination, "src/audio", file)),
        await readFile(join(audioSource, file)),
        `src/audio/${file}`,
      );
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
