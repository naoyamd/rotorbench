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

async function frozenSanitizer(projectRoot, runId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId ?? "")) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  const root = path.resolve(projectRoot);
  const run = JSON.parse(await readFile(path.join(root, "runs", runId, "run.json"), "utf8"));
  if (
    run.id !== runId
    || run.status !== "validated"
    || run.seal?.sealed !== true
    || run.extensions?.protocolVersion !== "4.0"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(run?.launchId ?? "")
    || !/^[a-f0-9]{64}$/.test(run?.executionContractDigest ?? "")
  ) {
    throw new Error("Sanitization requires the named sealed, validated v4 run and execution contract");
  }
  const snapshotRoot = path.join(
    root,
    "launches",
    run.launchId,
    "execution-contract",
  );
  const modulePath = path.join(snapshotRoot, "scripts", "stage2-sanitize.mjs");
  if (!isSafeRelativePath(path.relative(root, modulePath).split(path.sep).join("/"))) {
    throw new Error("frozen sanitizer path is unsafe");
  }
  const snapshot = await validateExecutionContractSnapshot(
    snapshotRoot,
    run.executionContractDigest,
  );
  if (snapshot.status !== "valid") {
    throw new Error("Frozen execution contract is invalid");
  }
  const bytes = await readFile(modulePath);
  const frozenModule = await import(`${pathToFileURL(modulePath).href}?sha256=${sha256(bytes)}`);
  if (typeof frozenModule.sanitizeRun !== "function") {
    throw new Error("frozen execution contract has no sanitizer implementation");
  }
  return frozenModule.sanitizeRun;
}

/** Invoke the evaluator implementation frozen with this run's launch. */
export async function sanitizeRun(options = {}) {
  const projectRoot = options.projectRoot ?? process.cwd();
  const sanitizer = await frozenSanitizer(projectRoot, options.runId);
  return sanitizer({ ...options, projectRoot });
}

async function main() {
  const projectRoot = argument("--project-root", { required: true });
  const runId = argument("--run-id", { required: true });
  const out = argument("--out") ?? "sanitized";
  const result = await sanitizeRun({ projectRoot: path.resolve(projectRoot), runId, out });
  console.log(`${result.report.status === "passed" ? "Sanitized" : "Rejected"} ${runId}: ${result.reportPath} (${result.reportSha256}).`);
  if (result.report.status !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
