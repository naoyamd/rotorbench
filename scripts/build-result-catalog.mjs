import {
  access,
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const submissionsRoot = path.resolve(projectRoot, "submissions");
const publicRoot = path.resolve(projectRoot, "public");
const outputRoot = path.resolve(publicRoot, "results");

if (!outputRoot.startsWith(`${publicRoot}${path.sep}`)) {
  throw new Error("Refusing to write outside public/");
}

const requiredStrings = [
  "id",
  "title",
  "provider",
  "model",
  "reasoning",
  "runDate",
  "promptVersion",
  "summary",
];

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });

const directoryEntries = await readdir(submissionsRoot, { withFileTypes: true });
const catalog = [];
const seenIds = new Set();

for (const directoryEntry of directoryEntries) {
  if (!directoryEntry.isDirectory() || directoryEntry.name.startsWith("_")) {
    continue;
  }

  const submissionRoot = path.join(submissionsRoot, directoryEntry.name);
  const manifestPath = path.join(submissionRoot, "manifest.json");
  const siteRoot = path.join(submissionRoot, "site");
  const indexPath = path.join(siteRoot, "index.html");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));

  for (const key of requiredStrings) {
    if (typeof manifest[key] !== "string" || manifest[key].trim() === "") {
      throw new Error(`${directoryEntry.name}: manifest.${key} must be a non-empty string`);
    }
  }

  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(manifest.id)) {
    throw new Error(`${directoryEntry.name}: manifest.id must use lowercase kebab-case`);
  }
  if (manifest.id !== directoryEntry.name) {
    throw new Error(`${directoryEntry.name}: directory name and manifest.id must match`);
  }
  if (seenIds.has(manifest.id)) {
    throw new Error(`${directoryEntry.name}: duplicate manifest.id`);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(manifest.runDate)) {
    throw new Error(`${directoryEntry.name}: manifest.runDate must use YYYY-MM-DD`);
  }
  if (!Array.isArray(manifest.tags) || manifest.tags.some((tag) => typeof tag !== "string")) {
    throw new Error(`${directoryEntry.name}: manifest.tags must be a string array`);
  }
  if (manifest.cover != null && typeof manifest.cover !== "string") {
    throw new Error(`${directoryEntry.name}: manifest.cover must be null or a relative path`);
  }
  if (manifest.cover?.startsWith("/") || manifest.cover?.includes("..")) {
    throw new Error(`${directoryEntry.name}: manifest.cover must stay inside site/`);
  }

  await access(indexPath);
  if (manifest.cover) {
    await access(path.join(siteRoot, manifest.cover));
  }

  seenIds.add(manifest.id);
  await cp(siteRoot, path.join(outputRoot, manifest.id), { recursive: true });
  catalog.push({
    schemaVersion: 1,
    id: manifest.id,
    title: manifest.title,
    provider: manifest.provider,
    model: manifest.model,
    reasoning: manifest.reasoning,
    runDate: manifest.runDate,
    promptVersion: manifest.promptVersion,
    summary: manifest.summary,
    tags: manifest.tags,
    cover: manifest.cover ?? null,
  });
}

catalog.sort(
  (left, right) =>
    right.runDate.localeCompare(left.runDate) || left.title.localeCompare(right.title, "ja"),
);

await writeFile(
  path.join(outputRoot, "catalog.json"),
  `${JSON.stringify({ schemaVersion: 1, results: catalog }, null, 2)}\n`,
  "utf8",
);

console.log(`Prepared ${catalog.length} result${catalog.length === 1 ? "" : "s"}.`);
