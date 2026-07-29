import "./official-execution-guard.mjs";
import { open, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bundleTreeHash,
  ensureInside,
  readJson,
  sha256,
  validateCohort,
  validateEvaluationRecord,
  validateReviewAuditStorage,
  validateV4SanitizationReport,
  validateRun,
  validateV4EvaluationStorage,
} from "./framework-lib.mjs";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

function optionalArgument(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : process.argv[index + 1] ?? null;
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function replaceAtomically(target, bytes, suffix) {
  const temporary = `${target}.${suffix}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
}

function problemList(label, issues) {
  return `${label}:\n${issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n")}`;
}

function assertEvaluationInput({
  run,
  cohort,
  submission,
  candidateBundleSha256,
  candidateSubmissionSha256,
  evaluation,
  evaluationBytes,
  pendingBytes,
  finalizedAt,
}) {
  const problems = validateEvaluationRecord(evaluation);
  if (problems.length > 0) {
    throw new Error(problemList("Evaluator result is schema-invalid", problems));
  }
  if (evaluation.status === "pending" || !["admitted", "artifact-invalid"].includes(evaluation.status)) {
    throw new Error("Evaluator result must have final status admitted or artifact-invalid");
  }
  if (Object.hasOwn(evaluation, "finalization")) {
    throw new Error("Evaluator result must not self-attest finalization; only this command may add it");
  }
  if (
    evaluation.runId !== run.id
    || evaluation.evaluationContractDigest !== run.evaluation.contractDigest
    || evaluation.scoringVersion !== run.evaluation.scoringVersion
    || evaluation.launchId !== run.launchId
    || evaluation.fairnessFingerprint !== run.fairnessFingerprint
    || evaluation.candidateBundleSha256 !== candidateBundleSha256
  ) {
    throw new Error("Evaluator result does not bind the current sealed run, launch, fairness fingerprint, and candidate bytes");
  }
  if (
    evaluation.sanitization?.actor !== "evaluator"
    || !["passed", "failed"].includes(evaluation.sanitization?.status)
    || evaluation.sanitization?.profileDigest !== run.sanitization?.profileDigest
    || submission.sanitizationRequest?.profileDigest !== run.sanitization?.profileDigest
  ) {
    throw new Error("Evaluator sanitization must conclusively bind the candidate-requested frozen sanitization profile");
  }
  if (evaluation.status === "admitted" && evaluation.sanitization.status !== "passed") {
    throw new Error("An admitted evaluator result requires passed sanitization");
  }
  if (
    cohort.id !== run.cohortId
    || cohort.launchId !== run.launchId
    || cohort.fairnessFingerprint !== run.fairnessFingerprint
    || !cohort.candidateIds.includes(run.id)
  ) {
    throw new Error("Run does not bind a matching open cohort membership");
  }

  return {
    ...evaluation,
    finalization: {
      schemaVersion: "1.0",
      status: "finalized",
      finalizedAt,
      runId: run.id,
      cohortId: run.cohortId,
      launchId: run.launchId,
      fairnessFingerprint: run.fairnessFingerprint,
      candidateBundleSha256,
      candidateSubmissionSha256,
      pendingRecordSha256: sha256(pendingBytes),
      sourceEvaluationSha256: sha256(evaluationBytes),
    },
  };
}

/**
 * Replace a run's pending evaluator record with a conclusive evaluator result.
 * The candidate tree is never written by this function.  The record transition
 * is serialized by an exclusive lock and each changed JSON file is replaced via
 * rename, so a second finalizer cannot silently overwrite a finalized record.
 */
export async function finalizeEvaluation({
  projectRoot = process.cwd(),
  runId,
  evaluationPath,
  finalizedAt = new Date().toISOString(),
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId)) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  if (Number.isNaN(Date.parse(finalizedAt))) {
    throw new Error("--at must be an ISO-8601 date-time");
  }
  const root = path.resolve(projectRoot);
  const runRoot = path.join(root, "runs", runId);
  const runPath = path.join(runRoot, "run.json");
  const lockPath = path.join(runRoot, "evaluation-finalize.lock");
  const resolvedEvaluationPath = path.resolve(evaluationPath);
  const lock = await open(lockPath, "wx").catch(() => {
    throw new Error(`Evaluation finalization is already in progress for ${runId}`);
  });
  await lock.close();

  let originalRunBytes = null;
  let originalRecordBytes = null;
  let evaluationRecordPath = null;
  let recordReplaced = false;
  let runReplaced = false;
  const suffix = `finalize-${process.pid}-${Date.now()}`;
  try {
    const [runBytes, run, evaluatorBytes] = await Promise.all([
      readFile(runPath),
      readJson(runPath),
      readFile(resolvedEvaluationPath),
    ]);
    originalRunBytes = runBytes;
    const runProblems = validateRun(run);
    if (runProblems.length > 0) throw new Error(problemList("Run manifest is schema-invalid", runProblems));
    if (run.extensions?.protocolVersion !== "4.0" || run.status !== "validated" || run.seal?.sealed !== true) {
      throw new Error("Only a sealed, validated v4 run may be finalized");
    }
    const candidateRoot = ensureInside(runRoot, run.seal.bundlePath);
    if (!candidateRoot || isInside(candidateRoot, resolvedEvaluationPath)) {
      throw new Error("Evaluator result must be outside the candidate-owned submitted bundle");
    }
    evaluationRecordPath = ensureInside(runRoot, run.evaluation?.recordPath);
    if (!evaluationRecordPath) throw new Error("Run evaluation record path is unsafe");
    const [pendingBytes, pending, cohort, candidateBundleSha256, submissionBytes] = await Promise.all([
      readFile(evaluationRecordPath),
      readJson(evaluationRecordPath),
      readJson(path.join(root, "cohorts", run.cohortId, "cohort.json")),
      bundleTreeHash(candidateRoot),
      readFile(path.join(candidateRoot, "submission.json")),
    ]);
    originalRecordBytes = pendingBytes;
    const cohortProblems = validateCohort(cohort);
    if (cohortProblems.length > 0) throw new Error(problemList("Cohort manifest is schema-invalid", cohortProblems));
    if (cohort.status !== "open") throw new Error("Evaluation can be finalized only while its cohort is open");
    if (pending.status !== "pending" || Object.hasOwn(pending, "finalization")) {
      throw new Error("The stored evaluator record must be an unfinalized pending record");
    }
    const pendingIntegrity = await validateV4EvaluationStorage(
      { root: runRoot, manifest: run },
      { cohortManifest: cohort, requireFinalized: false },
    );
    if (pendingIntegrity.length > 0) {
      throw new Error(problemList("Pending evaluator record failed integrity validation", pendingIntegrity));
    }
    if (candidateBundleSha256 !== run.seal.bundleSha256) {
      throw new Error("Candidate-owned submitted bytes no longer match the sealed bundle hash");
    }
    const submission = JSON.parse(submissionBytes.toString("utf8"));
    const evaluator = JSON.parse(evaluatorBytes.toString("utf8"));
    const finalizedRecord = assertEvaluationInput({
      run,
      cohort,
      submission,
      candidateBundleSha256,
      candidateSubmissionSha256: sha256(submissionBytes),
      evaluation: evaluator,
      evaluationBytes: evaluatorBytes,
      pendingBytes,
      finalizedAt,
    });
    const sanitizationIssues = await validateV4SanitizationReport(
      { root: runRoot, manifest: { ...run, sanitization: finalizedRecord.sanitization } },
      finalizedRecord.sanitization,
    );
    if (sanitizationIssues.length > 0) {
      throw new Error(problemList("Evaluator sanitization report failed integrity validation", sanitizationIssues));
    }
    const reviewAuditIssues = await validateReviewAuditStorage(
      { root: runRoot, manifest: run },
      finalizedRecord,
    );
    if (reviewAuditIssues.length > 0) {
      throw new Error(problemList("Evaluator review-package and sealed-review records failed integrity validation", reviewAuditIssues));
    }
    const finalizedRecordBytes = jsonBytes(finalizedRecord);
    const nextRun = {
      ...run,
      sanitization: finalizedRecord.sanitization,
      extensions: {
        ...run.extensions,
        evaluationFinalization: {
          status: "finalized",
          finalizedAt,
          recordSha256: sha256(finalizedRecordBytes),
          candidateBundleSha256,
          candidateSubmissionSha256: sha256(submissionBytes),
        },
      },
    };
    const nextRunProblems = validateRun(nextRun);
    if (nextRunProblems.length > 0) throw new Error(problemList("Finalized run manifest is schema-invalid", nextRunProblems));

    await replaceAtomically(evaluationRecordPath, finalizedRecordBytes, suffix);
    recordReplaced = true;
    await replaceAtomically(runPath, jsonBytes(nextRun), suffix);
    runReplaced = true;
    const storedRun = await readJson(runPath);
    const storedIssues = await validateV4EvaluationStorage(
      { root: runRoot, manifest: storedRun },
      { cohortManifest: cohort, requireFinalized: true },
    );
    if (storedIssues.length > 0) {
      throw new Error(problemList("Finalized evaluator state failed integrity validation", storedIssues));
    }
    return {
      runId,
      status: finalizedRecord.status,
      evaluationRecordSha256: sha256(finalizedRecordBytes),
      candidateBundleSha256,
    };
  } catch (error) {
    // Restore both evaluator-owned files if a post-write check fails.  The
    // submitted candidate directory is deliberately never part of rollback.
    if (runReplaced && originalRunBytes) {
      await replaceAtomically(runPath, originalRunBytes, `${suffix}-rollback`).catch(() => {});
    }
    if (recordReplaced && originalRecordBytes) {
      await replaceAtomically(
        evaluationRecordPath,
        originalRecordBytes,
        `${suffix}-rollback`,
      ).catch(() => {});
    }
    throw error;
  } finally {
    if (evaluationRecordPath) {
      await rm(`${evaluationRecordPath}.${suffix}.tmp`, { force: true }).catch(() => {});
    }
    await rm(`${runPath}.${suffix}.tmp`, { force: true }).catch(() => {});
    await rm(lockPath, { force: true });
  }
}

async function main() {
  const runId = requiredArgument("--run-id");
  const evaluationPath = path.resolve(requiredArgument("--evaluation"));
  const rootArgument = optionalArgument("--root");
  const at = optionalArgument("--at") ?? undefined;
  const result = await finalizeEvaluation({
    projectRoot: rootArgument ? path.resolve(rootArgument) : process.cwd(),
    runId,
    evaluationPath,
    ...(at ? { finalizedAt: at } : {}),
  });
  console.log(`Finalized evaluator record for ${result.runId}: ${result.status} (${result.evaluationRecordSha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
