import "./official-execution-guard.mjs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateFramework } from "./framework-lib.mjs";
import { publicEvaluationSummary } from "./public-evaluation-summary.mjs";
import { exportPublicCohortPublication } from "./publication-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

/**
 * Stage 2 evaluator command. Run this only from the frozen execution contract
 * in a private evaluator workspace, after `stage2:publish-cohort` succeeds.
 */
export async function exportFrozenCohortPublication({
  projectRoot = process.cwd(),
  cohortId,
  out,
  exportedAt,
} = {}) {
  const root = path.resolve(projectRoot);
  const framework = await validateFramework(root);
  return exportPublicCohortPublication({
    projectRoot: root,
    cohortId,
    out,
    ...(exportedAt ? { exportedAt } : {}),
    framework,
    publicEvaluationSummary,
  });
}

async function main() {
  const result = await exportFrozenCohortPublication({
    projectRoot: path.resolve(argument("--project-root") ?? process.cwd()),
    cohortId: argument("--cohort-id", { required: true }),
    out: path.resolve(argument("--out", { required: true })),
    ...(argument("--at") ? { exportedAt: argument("--at") } : {}),
  });
  console.log(`Exported safe public cohort publication ${result.cohortId} (${result.fileCount} files; ${result.manifestSha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
