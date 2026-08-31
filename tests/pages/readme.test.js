import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readmePath = new URL("../../README.md", import.meta.url);

test("README presents extended-html usage and delegates detail to the guides", async () => {
  const readme = await readFile(readmePath, "utf8");

  assert.match(readme, /^# Extended HTML$/m);
  assert.match(
    readme,
    /<script type="module" src="https:\/\/koseki2580\.github\.io\/extended-html\/src\/index\.js"><\/script>/,
  );
  assert.match(
    readme,
    /<script type="module" src="https:\/\/koseki2580\.github\.io\/extended-html\/src\/audio\/index\.js"><\/script>/,
  );
  assert.match(readme, /<web-socket/);
  assert.match(readme, /socket\.open\(\)/);
  assert.match(readme, /socket\.send\(/);
  assert.match(readme, /socket\.close\(\)/);
  assert.match(readme, /event\.detail\.data/);
  assert.match(readme, /<audio-context id="audio">/);
  assert.match(readme, /<audio-input-file[^>]*>/);
  assert.match(readme, /<audio-biquad-filter[^>]*>/);
  assert.match(readme, /<audio-output><\/audio-output>/);
  assert.match(readme, /<audio-stream-output>/);
  assert.match(readme, /<media-recorder/);
  assert.match(readme, /event\.detail\.data/);
  assert.match(readme, /await audio\.resume\(\)/);
  assert.match(readme, /extended-html\/guide\/ja\//);
  assert.match(readme, /extended-html\/guide\/en\//);
  assert.match(readme, /extended-html\/examples\//);

  assert.doesNotMatch(readme, /^## Development$/m);
  assert.doesNotMatch(readme, /npm test/);
  assert.doesNotMatch(readme, /Pages artifact/i);
  assert.doesNotMatch(readme, /deployment workflow/i);
  assert.doesNotMatch(readme, /implementation plan/i);
  assert.doesNotMatch(readme, /import "extended-html(?:\/audio-context)?";/);
});
