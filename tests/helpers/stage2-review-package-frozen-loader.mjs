import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { isSafeRelativePath, sha256 } from "../../scripts/framework-lib.mjs";
import { validateExecutionContractSnapshot } from "../../scripts/stage0-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function frozenReviewPackager(projectRoot, runId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId ?? "")) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  const root = path.resolve(projectRoot);
  const run = JSON.parse(await readFile(path.join(root, "runs", runId, "run.json"), "utf8"));
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(run?.launchId ?? "")) {
    throw new Error("run.json does not declare a safe launch identity");
  }
  const snapshotRoot = path.join(root, "launches", run.launchId, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(
    snapshotRoot,
    run.executionContractDigest,
  );
  if (snapshot.status !== "valid") {
    throw new Error("Frozen execution contract is invalid");
  }
  const modulePath = path.join(snapshotRoot, "scripts", "stage2-review-package.mjs");
  if (!isSafeRelativePath(path.relative(root, modulePath).split(path.sep).join("/"))) {
    throw new Error("frozen review-package path is unsafe");
  }
  const bytes = await readFile(modulePath);
  const frozenModule = await import(`${pathToFileURL(modulePath).href}?sha256=${sha256(bytes)}`);
  if (typeof frozenModule.prepareReviewPackage !== "function") {
    throw new Error("frozen execution contract has no review-package implementation");
  }
  return frozenModule.prepareReviewPackage;
}

/** Invoke the evaluator implementation frozen with this run's launch. */
export async function prepareReviewPackage(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const packager = await frozenReviewPackager(projectRoot, options.runId);
  return packager({ ...options, projectRoot });
}

async function main() {
  const projectRoot = argument("--project-root", { required: true });
  const runId = argument("--run-id", { required: true });
  const sanitized = argument("--sanitized") ?? "sanitized";
  const out = argument("--out") ?? `${sanitized}/review-package`;
  const result = await prepareReviewPackage({
    projectRoot: path.resolve(projectRoot),
    runId,
    sanitized,
    out,
  });
  console.log(`Prepared ${result.reviewPackageId}: ${result.manifestPath} (${result.manifestSha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
