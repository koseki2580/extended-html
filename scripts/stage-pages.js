import { cp, mkdir, rm } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";

const publishedPaths = ["index.html", "examples", "src"];

/**
 * Rebuilds a GitHub Pages artifact from the explicit public-file allowlist.
 * Keeping this list small prevents tests, dependencies, and agent files from
 * being published accidentally.
 */
export async function stagePages({ root, destination }) {
  const resolvedRoot = resolve(root);
  const resolvedDestination = resolve(destination);
  const sourcePaths = publishedPaths.map((relativePath) =>
    resolve(resolvedRoot, relativePath),
  );
  const overlaps = (first, second) =>
    first === second ||
    first.startsWith(`${second}${sep}`) ||
    second.startsWith(`${first}${sep}`);

  // Never let a caller erase the repository, one of its sources, or an ancestor.
  if (
    resolvedDestination === resolvedRoot ||
    resolvedRoot.startsWith(`${resolvedDestination}${sep}`) ||
    sourcePaths.some((sourcePath) => overlaps(resolvedDestination, sourcePath))
  ) {
    throw new RangeError(
      "Pages destination must not overlap the repository or published sources",
    );
  }

  await rm(resolvedDestination, { recursive: true, force: true });
  await mkdir(resolvedDestination, { recursive: true });

  for (const relativePath of publishedPaths) {
    await cp(
      resolve(resolvedRoot, relativePath),
      resolve(resolvedDestination, relativePath),
      { recursive: true },
    );
  }
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  await stagePages({
    root: process.cwd(),
    destination: resolve(process.cwd(), "_site"),
  });
}
