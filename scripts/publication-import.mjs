import path from "node:path";
import { pathToFileURL } from "node:url";
import { importPublicCohortPublication } from "./publication-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

export async function importPublication(options = {}) {
  return importPublicCohortPublication({
    projectRoot: path.resolve(options.projectRoot ?? process.cwd()),
    bundlePath: path.resolve(options.bundlePath),
  });
}

async function main() {
  const result = await importPublication({
    projectRoot: path.resolve(argument("--project-root") ?? process.cwd()),
    bundlePath: argument("--bundle", { required: true }),
  });
  console.log(`Imported publication ${result.cohortId} (${result.runIds.length} public runs; ${result.manifestSha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
