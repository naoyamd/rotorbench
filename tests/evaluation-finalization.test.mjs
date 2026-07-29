import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  bundleTreeHash,
  sha256,
  validateV4EvaluationStorage,
} from "../scripts/framework-lib.mjs";
import { finalizeEvaluation } from "../scripts/stage2-finalize-evaluation.mjs";

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

const hex = (character) => character.repeat(64);

async function createReviewAudit({ runRoot, reportSha256, scoringDigest }) {
  const packageRoot = path.join(runRoot, "sanitized", "review-package");
  const scoringBytes = Buffer.from('{"fixture":"public-scoring"}\n');
  await mkdir(path.join(packageRoot, "evidence"), { recursive: true });
  await writeFile(path.join(packageRoot, "scoring-contract.json"), scoringBytes);
  const evidence = [];
  for (let index = 1; index <= 4; index += 1) {
    const id = `EVD-${String(index).padStart(3, "0")}`;
    const bytes = Buffer.from(`fixture evidence ${index}\n`);
    const outputPath = `evidence/${id}.txt`;
    await writeFile(path.join(packageRoot, ...outputPath.split("/")), bytes);
    evidence.push({
      id,
      kind: "artifact",
      role: "supporting",
      mediaType: "text/plain",
      sha256: sha256(bytes),
      bytes: bytes.length,
      outputPath,
    });
  }
  const reviewPackage = {
    schemaVersion: "1.0",
    generatedAt: "2026-07-29T11:30:00Z",
    status: "ready",
    reviewPackageId: "review-1111111111111111",
    evidenceRoot: "evidence",
    scoringContract: {
      id: "fixture-public-scoring",
      version: "1.0",
      sha256: scoringDigest,
      outputPath: "scoring-contract.json",
      outputSha256: sha256(scoringBytes),
    },
    sanitizationReport: { sha256: reportSha256, status: "passed" },
    evidence,
  };
  const packagePath = path.join(packageRoot, "review-package.json");
  await writeJson(packagePath, reviewPackage);
  const packageBytes = await readFile(packagePath);
  const packageSha256 = sha256(packageBytes);
  const records = [];
  for (const [reviewerId, role] of [
    ["rater-1111111111111111", "primary"],
    ["rater-2222222222222222", "secondary"],
  ]) {
    const record = {
      schemaVersion: "1.0",
      reviewerId,
      role,
      lockedAt: "2026-07-29T11:31:00Z",
      reviewPackage: { id: reviewPackage.reviewPackageId, manifestSha256: packageSha256 },
      sourceReviewSha256: hex("3"),
      attestations: {
        independentFromCandidate: true,
        independentFromOtherReviewers: true,
        blindToCandidateIdentity: true,
        reviewedSanitizedEvidenceOnly: true,
        ratingLockedBeforeAdjudication: true,
      },
      gateRatings: [],
      expertRatings: [],
    };
    const recordPath = path.join(runRoot, "sanitized", "reviews", `${reviewerId}.json`);
    await writeJson(recordPath, record);
    records.push({ path: `sanitized/reviews/${reviewerId}.json`, sha256: sha256(await readFile(recordPath)), reviewerId, role });
  }
  return {
    reviewPackage: {
      id: reviewPackage.reviewPackageId,
      path: "sanitized/review-package/review-package.json",
      sha256: packageSha256,
    },
    records,
  };
}

async function createPendingV4Run() {
  const root = await mkdtemp(path.join(tmpdir(), "evaluation-finalization-"));
  const runId = "candidate-a";
  const runRoot = path.join(root, "runs", runId);
  const submitted = path.join(runRoot, "submitted");
  await mkdir(submitted, { recursive: true });
  const profileDigest = hex("f");
  await writeJson(path.join(submitted, "submission.json"), {
    sanitizationRequest: { profileDigest },
  });
  await writeFile(path.join(submitted, "design.txt"), "candidate-owned design bytes\n");
  const bundleSha256 = await bundleTreeHash(submitted);
  const submissionBytes = await readFile(path.join(submitted, "submission.json"));
  const run = {
    schemaVersion: "1.0",
    id: runId,
    benchmarkId: "fixture-benchmark",
    benchmarkVersion: "1.0",
    launchId: "fixture-launch",
    cohortId: "fixture-cohort",
    taskPacketDigest: hex("a"),
    taskPacketBundleDigest: hex("b"),
    executionContractDigest: hex("c"),
    promptSha256: hex("d"),
    launchDigest: hex("e"),
    fairnessFingerprint: hex("1"),
    status: "validated",
    submittedAt: "2026-07-29T00:00:00Z",
    model: { provider: "fixture", name: "fixture", version: "1" },
    seal: {
      sealed: true,
      bundlePath: "submitted",
      bundleSha256,
      algorithm: "sha256-tree-v1",
    },
    processEvidence: {
      initialPlan: { path: "submitted/submission.json", sha256: sha256(submissionBytes) },
      workRecord: { path: "submitted/submission.json", sha256: sha256(submissionBytes) },
    },
    artifacts: [],
    checkpointReceipts: [{
      id: "RCP-000",
      sequence: 0,
      checkpointId: "CKPT-000",
      path: "submitted/submission.json",
      sha256: sha256(submissionBytes),
      previousReceiptSha256: hex("0"),
    }],
    partialAttainment: {
      attemptedCheckpointIds: ["CKPT-000"],
      completedCheckpointIds: ["CKPT-000"],
      highestVerifiedCheckpointId: "CKPT-000",
      stoppedReason: "candidate-stop",
    },
    sanitization: {
      actor: "evaluator",
      profileDigest,
      status: "not-run",
      sanitizedArtifactIds: [],
    },
    evaluation: {
      contractDigest: hex("9"),
      scoringVersion: "1.0",
      recordPath: "evaluation-record.json",
    },
    extensions: { protocolVersion: "4.0", submissionStatus: "partial" },
  };
  const pending = {
    schemaVersion: "4.0",
    runId,
    evaluationContractDigest: run.evaluation.contractDigest,
    scoringVersion: run.evaluation.scoringVersion,
    status: "pending",
  };
  const cohort = {
    schemaVersion: "1.0",
    id: run.cohortId,
    openedAt: "2026-07-29T00:00:00Z",
    launchId: run.launchId,
    fairnessFingerprint: run.fairnessFingerprint,
    status: "open",
    candidateIds: [runId],
    extensions: {},
  };
  await writeJson(path.join(runRoot, "run.json"), run);
  await writeJson(path.join(runRoot, "evaluation-record.json"), pending);
  await writeJson(path.join(root, "cohorts", cohort.id, "cohort.json"), cohort);

  const sanitizationReport = {
    schemaVersion: "1.0",
    generatedAt: "2026-07-29T11:00:00Z",
    runId,
    status: "passed",
    outputRoot: "sanitized",
    bundle: { path: "submitted", sha256: bundleSha256 },
    launch: { id: run.launchId, digest: run.launchDigest, fairnessFingerprint: run.fairnessFingerprint },
    packet: {
      id: run.benchmarkId,
      version: run.benchmarkVersion,
      digest: run.taskPacketDigest,
      bundleDigest: run.taskPacketBundleDigest,
    },
    executionProfile: { id: "fixture", version: "1", digest: hex("8"), limits: {} },
    sanitizationProfile: { digest: profileDigest, sha256: profileDigest },
    executionContract: {
      digest: run.executionContractDigest,
      artifactContractSha256: hex("7"),
      sanitizerSha256: hex("6"),
    },
    tool: { name: "stage2-sanitize", version: "1.0", sourceSha256: hex("6") },
    artifacts: [],
    issues: [],
  };
  const reportPath = path.join(runRoot, "sanitized", "sanitization-report.json");
  await writeJson(reportPath, sanitizationReport);
  const reportSha256 = sha256(await readFile(reportPath));
  const reviewAudit = await createReviewAudit({
    runRoot,
    reportSha256,
    scoringDigest: run.evaluation.contractDigest,
  });

  const evaluatorPath = path.join(root, "evaluator-result.json");
  await writeJson(evaluatorPath, {
    schemaVersion: "4.0",
    runId,
    evaluationContractDigest: run.evaluation.contractDigest,
    scoringVersion: run.evaluation.scoringVersion,
    status: "admitted",
    launchId: run.launchId,
    fairnessFingerprint: run.fairnessFingerprint,
    candidateBundleSha256: bundleSha256,
    sanitization: {
      actor: "evaluator",
      profileDigest,
      status: "passed",
      sanitizedArtifactIds: [],
      report: { path: "sanitized/sanitization-report.json", sha256: reportSha256 },
    },
    reviewAudit,
  });
  return { root, runId, runRoot, submitted, evaluatorPath, cohort, bundleSha256 };
}

test("Stage 2 finalization atomically replaces pending evaluator state without touching candidate bytes", async () => {
  const fixture = await createPendingV4Run();
  try {
    const candidateBefore = await bundleTreeHash(fixture.submitted);
    const result = await finalizeEvaluation({
      projectRoot: fixture.root,
      runId: fixture.runId,
      evaluationPath: fixture.evaluatorPath,
      finalizedAt: "2026-07-29T12:00:00Z",
    });
    assert.equal(result.status, "admitted");
    assert.equal(await bundleTreeHash(fixture.submitted), candidateBefore);

    const [run, record] = await Promise.all([
      JSON.parse(await readFile(path.join(fixture.runRoot, "run.json"), "utf8")),
      JSON.parse(await readFile(path.join(fixture.runRoot, "evaluation-record.json"), "utf8")),
    ]);
    assert.equal(record.status, "admitted");
    assert.equal(record.finalization.status, "finalized");
    assert.equal(record.finalization.candidateBundleSha256, fixture.bundleSha256);
    assert.equal(run.sanitization.status, "passed");
    assert.equal(run.extensions.evaluationFinalization.recordSha256, result.evaluationRecordSha256);
    assert.deepEqual(
      await validateV4EvaluationStorage({ root: fixture.runRoot, manifest: run }, {
        cohortManifest: fixture.cohort,
        requireFinalized: true,
      }),
      [],
    );
    const sealedRecordPath = path.join(fixture.runRoot, "sanitized", "reviews", "rater-1111111111111111.json");
    await writeFile(sealedRecordPath, `${await readFile(sealedRecordPath, "utf8")} `);
    const reviewTamperIssues = await validateV4EvaluationStorage(
      { root: fixture.runRoot, manifest: run },
      { cohortManifest: fixture.cohort, requireFinalized: true },
    );
    assert.ok(reviewTamperIssues.some(({ code }) => code === "review-record-hash-mismatch"));
    await assert.rejects(
      () => finalizeEvaluation({
        projectRoot: fixture.root,
        runId: fixture.runId,
        evaluationPath: fixture.evaluatorPath,
        finalizedAt: "2026-07-29T12:01:00Z",
      }),
      /unfinalized pending record/,
    );
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("publication integrity fails closed for a pending or mismatched v4 evaluator record", async () => {
  const fixture = await createPendingV4Run();
  try {
    const run = JSON.parse(await readFile(path.join(fixture.runRoot, "run.json"), "utf8"));
    const pendingIssues = await validateV4EvaluationStorage(
      { root: fixture.runRoot, manifest: run },
      { cohortManifest: fixture.cohort, requireFinalized: true },
    );
    assert.ok(pendingIssues.some(({ code }) => code === "pending-evaluation-record"));

    await finalizeEvaluation({
      projectRoot: fixture.root,
      runId: fixture.runId,
      evaluationPath: fixture.evaluatorPath,
      finalizedAt: "2026-07-29T12:00:00Z",
    });
    const recordPath = path.join(fixture.runRoot, "evaluation-record.json");
    const record = JSON.parse(await readFile(recordPath, "utf8"));
    record.fairnessFingerprint = hex("2");
    await writeJson(recordPath, record);
    const finalizedRun = JSON.parse(await readFile(path.join(fixture.runRoot, "run.json"), "utf8"));
    const issues = await validateV4EvaluationStorage(
      { root: fixture.runRoot, manifest: finalizedRun },
      { cohortManifest: fixture.cohort, requireFinalized: true },
    );
    assert.ok(issues.some(({ code }) => code === "evaluation-record-binding"));
    assert.ok(issues.some(({ code }) => code === "run-evaluation-finalization"));
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});
