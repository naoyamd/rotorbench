import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateExecutionContractSnapshot } from "../../scripts/stage0-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function isKebabCaseId(value) {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function isSha256(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function inside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function moduleUrl(filePath, bytes) {
  const digest = createHash("sha256").update(bytes).digest("hex");
  return `${pathToFileURL(filePath).href}?sha256=${digest}`;
}

/**
 * Resolve and verify the evaluator bundled with the sealed run's launch.
 * No evaluator code is imported until the complete execution-contract snapshot
 * has passed its byte-level digest check.
 */
export async function loadFrozenEngineeringEvaluator({
  projectRoot = process.cwd(),
  runId,
} = {}) {
  if (!isKebabCaseId(runId)) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  const root = path.resolve(projectRoot);
  const run = JSON.parse(await readFile(
    path.join(root, "runs", runId, "run.json"),
    "utf8",
  ));
  if (
    run.id !== runId
    || run.status !== "validated"
    || run.seal?.sealed !== true
  ) {
    throw new Error("Evaluation requires the named sealed, validated run");
  }
  if (!isKebabCaseId(run.launchId)) {
    throw new Error("run.json does not declare a safe launch identity");
  }
  if (!isSha256(run.executionContractDigest)) {
    throw new Error("run.json does not declare an execution-contract digest");
  }

  const snapshotRoot = path.join(
    root,
    "launches",
    run.launchId,
    "execution-contract",
  );
  const evaluatorPath = path.join(
    snapshotRoot,
    "scripts",
    "evaluate-engineering-submission.mjs",
  );
  if (!inside(root, evaluatorPath)) {
    throw new Error("frozen evaluator path is unsafe");
  }
  const snapshot = await validateExecutionContractSnapshot(
    snapshotRoot,
    run.executionContractDigest,
  );
  if (snapshot.status !== "valid") {
    const details = snapshot.issues
      .map(({ code, message }) => `${code}: ${message}`)
      .join("\n");
    throw new Error(`Frozen execution contract is invalid${details ? `:\n${details}` : ""}`);
  }

  const bytes = await readFile(evaluatorPath);
  const evaluator = await import(moduleUrl(evaluatorPath, bytes));
  if (typeof evaluator.scoreEngineeringRun !== "function") {
    throw new Error("frozen execution contract has no engineering evaluator");
  }
  return evaluator;
}

/** Invoke the evaluator implementation frozen with this run's launch. */
export async function scoreFrozenEngineeringRun(options = {}) {
  const projectRoot = path.resolve(options.projectRoot ?? process.cwd());
  const evaluator = await loadFrozenEngineeringEvaluator({
    projectRoot,
    runId: options.runId,
  });
  return evaluator.scoreEngineeringRun({ ...options, projectRoot });
}

async function main() {
  const result = await scoreFrozenEngineeringRun({
    projectRoot: argument("--project-root") ?? process.cwd(),
    runId: argument("--run-id", { required: true }),
    assessmentPath: argument("--assessment", { required: true }),
    outputPath: argument("--out", { required: true }),
  });
  console.log(
    `Evaluation ${result.status}; baseline qualified: ${result.qualification.baselineQualified}; no composite score emitted.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
