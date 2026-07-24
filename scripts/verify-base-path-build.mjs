import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { cp, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const projectRoot = process.cwd();
const exportRoot = path.join(projectRoot, "out");
const basePath = "/framework-base-path";
const nextCli = path.join(projectRoot, "node_modules", "next", "dist", "bin", "next");
const baseEnvironment = {
  ...process.env,
  PAGES_BASE_PATH: basePath,
  NEXT_PUBLIC_BASE_PATH: basePath,
};

function run(script, argumentsList, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...argumentsList], {
      cwd: projectRoot,
      env,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0
        ? resolve()
        : reject(new Error(`${path.basename(script)} exited with ${code}`)),
    );
  });
}

async function exists(target) {
  try {
    await stat(target);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

const temporaryRoot = await mkdtemp(path.join(tmpdir(), "framework-base-path-"));
const savedExport = path.join(temporaryRoot, "out");
const hadExport = await exists(exportRoot);
if (hadExport) await cp(exportRoot, savedExport, { recursive: true });

try {
  await rm(exportRoot, { recursive: true, force: true });
  await run(nextCli, ["build"], baseEnvironment);
  await run(path.join(projectRoot, "scripts", "clean-framework-placeholders.mjs"), [], baseEnvironment);
  await run(path.join(projectRoot, "scripts", "verify-static-links.mjs"), [], baseEnvironment);
  const baseHome = await readFile(path.join(exportRoot, "index.html"), "utf8");
  assert.match(baseHome, new RegExp(`href="${basePath}/benchmarks/"`));
  assert.match(baseHome, new RegExp(`href="${basePath}/stage0/"`));
  const stage0Author = await readFile(
    path.join(exportRoot, "stage0", "author", "index.html"),
    "utf8",
  );
  assert.match(
    stage0Author,
    new RegExp(
      `https://rotorbench-lab\\.naoyamd\\.chatgpt\\.site${basePath}/stage0/author/`,
    ),
  );
} finally {
  await rm(exportRoot, { recursive: true, force: true });
  if (hadExport) await cp(savedExport, exportRoot, { recursive: true });
  await rm(temporaryRoot, { recursive: true, force: true });
}

if (hadExport) {
  await run(
    path.join(projectRoot, "scripts", "verify-static-links.mjs"),
    [],
    process.env,
  );
  const restoredHome = await readFile(path.join(exportRoot, "index.html"), "utf8");
  assert.doesNotMatch(restoredHome, /\/framework-base-path\//);
}
console.log("Verified isolated GitHub Pages base-path export and restored the original out/.");
