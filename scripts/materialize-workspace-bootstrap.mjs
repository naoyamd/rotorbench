import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { ensureInside, sha256 } from "./framework-lib.mjs";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

export async function materializeWorkspaceBootstrap({ bundlePath, targetRoot }) {
  const bytes = await readFile(bundlePath);
  const bundle = JSON.parse(bytes.toString("utf8"));
  if (
    bundle.schemaVersion !== "1.0"
    || !Array.isArray(bundle.files)
    || bundle.files.length === 0
  ) {
    throw new Error("Workspace bootstrap bundle is invalid");
  }
  await mkdir(targetRoot, { recursive: false });
  for (const file of bundle.files) {
    const target = ensureInside(targetRoot, file.path);
    if (!target || typeof file.content !== "string") {
      throw new Error(`Unsafe workspace bootstrap entry: ${file.path}`);
    }
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, file.content, { flag: "wx" });
  }
  return { bundleSha256: sha256(bytes), fileCount: bundle.files.length };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const result = await materializeWorkspaceBootstrap({
    bundlePath: path.resolve(argument("--bundle")),
    targetRoot: path.resolve(argument("--target")),
  });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
