import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(
  projectRoot,
  "workspace-bootstrap-sources",
  "integrated-robotic-handling-v1",
  "tools",
  "stage1-preflight.mjs",
);
const bundlePath = path.join(
  projectRoot,
  "workspace-bootstrap",
  "integrated-robotic-handling-v1.json",
);
const embeddedPath = "tools/stage1-preflight.mjs";
const source = await readFile(sourcePath, "utf8");
const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
const embedded = bundle.files?.find(({ path: filePath }) => filePath === embeddedPath);

if (!embedded) throw new Error(`Bootstrap bundle does not contain ${embeddedPath}`);
if (process.argv.includes("--check")) {
  if (embedded.content !== source) {
    throw new Error(`${embeddedPath} is stale; run workspace-bootstrap:sync`);
  }
  process.stdout.write(`${embeddedPath} is synchronized\n`);
} else {
  embedded.content = source;
  await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
  process.stdout.write(`Updated ${path.relative(projectRoot, bundlePath)}\n`);
}
