import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readmePath = new URL("../../README.md", import.meta.url);

test("README presents extended-html usage and delegates detail to the guides", async () => {
  const readme = await readFile(readmePath, "utf8");

  assert.match(readme, /^# extended-html$/m);
  assert.match(readme, /\.\/src\/index\.js/);
  assert.match(readme, /<web-socket/);
  assert.match(readme, /socket\.open\(\)/);
  assert.match(readme, /socket\.send\(/);
  assert.match(readme, /socket\.close\(\)/);
  assert.match(readme, /event\.detail\.data/);
  assert.match(readme, /extended-html\/guide\/ja\//);
  assert.match(readme, /extended-html\/guide\/en\//);
  assert.match(readme, /extended-html\/examples\//);

  assert.doesNotMatch(readme, /^## Development$/m);
  assert.doesNotMatch(readme, /npm test/);
  assert.doesNotMatch(readme, /Pages artifact/i);
});
