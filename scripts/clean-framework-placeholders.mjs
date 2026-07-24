import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathExists } from "./framework-lib.mjs";

const projectRoot = process.cwd();
const placeholderRoutes = [
  "runs/__framework-empty__",
  "benchmarks/__framework-empty__",
];
const publicRoots = [
  path.resolve(process.argv[2] ?? path.join(projectRoot, "out")),
  path.join(projectRoot, "dist", "client"),
];

for (const publicRoot of publicRoots) {
  for (const route of placeholderRoutes) {
    const directory = path.resolve(publicRoot, route);
    if (!directory.startsWith(`${publicRoot}${path.sep}`)) {
      throw new Error("Unsafe placeholder target");
    }
    await rm(directory, { recursive: true, force: true });
    await rm(`${directory}.rsc`, { force: true });
    await rm(`${directory}.txt`, { force: true });
  }
}

const prerenderManifest = path.join(projectRoot, "dist", "server", "vinext-prerender.json");
if (await pathExists(prerenderManifest)) {
  const manifest = JSON.parse(await readFile(prerenderManifest, "utf8"));
  manifest.routes = (manifest.routes ?? []).filter(
    (entry) => !placeholderRoutes.some((route) => entry.path === `/${route}`),
  );
  await writeFile(prerenderManifest, `${JSON.stringify(manifest, null, 2)}\n`);
}

console.log("Removed empty-catalog validation placeholders from public build outputs.");
