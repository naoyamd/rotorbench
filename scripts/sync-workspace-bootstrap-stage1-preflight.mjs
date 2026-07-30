import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const definitions = [
  {
    id: "integrated-robotic-handling-v1",
    embeddedPaths: ["tools/stage1-preflight.mjs"],
  },
  {
    id: "integrated-robotic-handling-v2",
    embeddedPaths: [
      "tools/stage1-preflight.mjs",
      "tools/stage1-checkpoint.mjs",
      "candidate-output/README.md",
      "candidate-output/templates/README.md",
    ],
  },
];
const checkOnly = process.argv.includes("--check");
const stale = [];
const updated = [];

for (const definition of definitions) {
  const sourceRoot = path.join(
    projectRoot,
    "workspace-bootstrap-sources",
    definition.id,
  );
  const bundlePath = path.join(
    projectRoot,
    "workspace-bootstrap",
    `${definition.id}.json`,
  );
  const publicBundlePath = path.join(
    projectRoot,
    "public",
    "framework",
    "workspaces",
    `${definition.id}.json`,
  );
  const bundle = JSON.parse(await readFile(bundlePath, "utf8"));
  let changed = false;

  for (const embeddedPath of definition.embeddedPaths) {
    const source = await readFile(path.join(sourceRoot, embeddedPath), "utf8");
    const embedded = bundle.files?.find(({ path: filePath }) => filePath === embeddedPath);
    if (!embedded) {
      throw new Error(`${definition.id} bootstrap bundle does not contain ${embeddedPath}`);
    }
    if (embedded.content !== source) {
      stale.push(`${definition.id}:${embeddedPath}`);
      if (!checkOnly) {
        embedded.content = source;
        changed = true;
      }
    }
  }

  if (!checkOnly && changed) {
    await writeFile(bundlePath, `${JSON.stringify(bundle, null, 2)}\n`);
    updated.push(path.relative(projectRoot, bundlePath));
  }

  let publicBundle;
  try {
    publicBundle = await readFile(publicBundlePath, "utf8");
  } catch {
    throw new Error(`Public workspace bootstrap is missing: ${definition.id}`);
  }
  const currentBundle = await readFile(bundlePath, "utf8");
  if (publicBundle !== currentBundle) {
    stale.push(`public:${definition.id}`);
    if (!checkOnly) {
      await writeFile(publicBundlePath, currentBundle);
      updated.push(path.relative(projectRoot, publicBundlePath));
    }
  }
}

if (checkOnly && stale.length > 0) {
  throw new Error(`${stale.join(", ")} is stale; run workspace-bootstrap:sync`);
}

if (checkOnly) {
  process.stdout.write("Workspace bootstrap sources are synchronized\n");
} else if (updated.length > 0) {
  process.stdout.write(`Updated ${updated.join(", ")}\n`);
} else {
  process.stdout.write("Workspace bootstrap sources already synchronized\n");
}
