import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import { bundleTreeHash, sha256 } from "../scripts/framework-lib.mjs";
import { loadFrozenContractValidators } from "../scripts/frozen-contract.mjs";
import { executionContractFiles, freezeLaunch, freezePacket } from "../scripts/stage0-lib.mjs";
import { sanitizeRun } from "./helpers/stage2-sanitize-frozen-loader.mjs";
import { prepareReviewPackage } from "./helpers/stage2-review-package-frozen-loader.mjs";
import { sealReview } from "../scripts/stage2-seal-review.mjs";
import {
  loadBoundReviewRecords,
  validateReviewers,
} from "../scripts/evaluate-engineering-submission.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const hex = (character) => character.repeat(64);

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function projectRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), "stage2-sanitize-"));
  for (const name of ["benchmarks", "task-packets", "launches", "runs"]) {
    await mkdir(path.join(root, name), { recursive: true });
  }
  await cp(path.join(repositoryRoot, "schemas"), path.join(root, "schemas"), { recursive: true });
  await cp(path.join(repositoryRoot, "shared"), path.join(root, "shared"), { recursive: true });
  for (const relativePath of executionContractFiles) {
    const source = path.join(repositoryRoot, ...relativePath.split("/"));
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  await execFileAsync("git", ["init"], { cwd: workspace });
  await execFileAsync("git", ["config", "core.autocrlf", "false"], { cwd: workspace });
  await writeFile(path.join(workspace, "baseline.txt"), "baseline\n");
  await execFileAsync("git", ["add", "baseline.txt"], { cwd: workspace });
  await execFileAsync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"], { cwd: workspace });
  return { root, workspace };
}

function limits(overrides = {}) {
  return {
    maxBundleFiles: 32,
    maxBundleBytes: 1048576,
    maxFileBytes: 131072,
    maxPathLength: 240,
    maxJsonBytes: 131072,
    maxTextBytes: 131072,
    maxPdfBytes: 131072,
    maxStepBytes: 131072,
    maxImageBytes: 131072,
    ...overrides,
  };
}

function commitment(id, visibilityClass, disclosedAt, digest) {
  return { id, visibilityClass, disclosedAt, requirementRefs: [], digest };
}

async function fixture({
  artifactPath = "artifacts/proof.json",
  mediaType = "application/json",
  artifactBytes = Buffer.from('{"proof":true}\n'),
  limitOverrides = {},
  model = { provider: "unknown", name: "unknown", version: "unknown" },
  identityLeakInPlan = "",
  ancillaryFiles = {},
  additionalArtifacts = [],
} = {}) {
  const { root, workspace } = await projectRoot();
  const source = path.join(root, "source");
  await mkdir(source);
  const declaredArtifacts = [
    {
      id: "proof",
      role: "supporting",
      path: artifactPath,
      mediaType,
      bytes: artifactBytes,
      requiredOutputRefs: ["OUT-001"],
      requiredFields: mediaType === "application/json" ? ["proof"] : [],
    },
    ...additionalArtifacts,
  ];
  const publicFiles = {
    "visibility.json": "{}\n",
    "checkpoints.json": "{}\n",
    "evaluation.json": "{}\n",
    "scoring-contract.json": JSON.stringify({
      schemaVersion: "4.0",
      id: "fixture-scoring-contract",
      version: "1.0",
    }, null, 2),
    "sanitize.json": "{\"policy\":\"static\"}\n",
    "output-contract.json": JSON.stringify({
      version: "1.0",
      candidateCheckpoints: [{ id: "CKPT-000", requiredArtefacts: declaredArtifacts.map(({ path: artifactPath }) => artifactPath) }],
      artefacts: declaredArtifacts.map((artifact, index) => ({
        id: `ART-${String(index + 1).padStart(3, "0")}`,
        path: artifact.path,
        role: artifact.role,
        requiredOutputRef: artifact.requiredOutputRefs.at(0),
        mediaType: artifact.mediaType,
        requiredFields: artifact.requiredFields ?? [],
      })),
    }, null, 2),
    "requirements.json": JSON.stringify({ requirements: [{ id: "REQ-001" }] }, null, 2),
  };
  for (const [name, contents] of Object.entries(publicFiles)) {
    await writeFile(path.join(source, name), contents);
  }
  await writeFile(path.join(source, "TASK.md"), "# Sanitization fixture\n");
  const input = (id, file, media = "application/json") => ({
    id, path: file, mediaType: media, provenance: "fixture", license: "CC0-1.0", downloadName: file,
  });
  const digest = (name) => sha256(Buffer.from(publicFiles[name]));
  const task = {
    schemaVersion: "4.0", id: "sanitize-fixture", version: "1.0", title: "Sanitization fixture",
    author: { id: "fixture", name: "Fixture" },
    instructions: { path: "TASK.md", mediaType: "text/markdown", downloadName: "TASK.md" },
    inputs: [
      input("visibility", "visibility.json"), input("checkpoints", "checkpoints.json"),
      input("evaluation", "evaluation.json"), input("scoring-contract", "scoring-contract.json"), input("sanitize", "sanitize.json"),
      input("output-contract", "output-contract.json"), input("requirements", "requirements.json"),
    ],
    requiredOutputs: [{ id: "OUT-001", role: "supporting", description: "Proof" }],
    completionCriteria: [{ id: "CRIT-001", statement: "Proof exists", requiredOutputRefs: ["OUT-001"], evidenceRoles: ["supporting"] }],
    environment: { baseline: "fixture", cad: "none", stepPipeline: "none" },
    engineeringValues: [], extensions: {},
    v4Contract: {
      scoringVersion: "1.0",
      instanceBankManifest: commitment("INS-001", "run-private-instance", "run-start", hex("1")),
      visibilityPolicy: commitment("VIS-001", "candidate-public", "before-run", digest("visibility.json")),
      checkpointContract: commitment("CKC-001", "candidate-public", "before-run", digest("checkpoints.json")),
      changeEventContract: commitment("CHC-001", "event-private-change", "after-prior-receipt", hex("2")),
      evaluationContract: commitment("EVC-001", "candidate-public", "before-run", digest("scoring-contract.json")),
      sanitizationProfile: commitment("SAN-001", "candidate-public", "before-run", digest("sanitize.json")),
      sealedAssetCommitments: [],
      disclosureSchedule: [commitment("DSC-001", "candidate-public", "before-run", hex("3"))],
    },
    checkpoints: [
      { id: "CKPT-000", sequence: 0, title: "Initial", phase: "initial-plan", requiredOutputRefs: ["OUT-001"], requiresPriorCheckpointIds: [] },
      { id: "CKPT-010", sequence: 10, title: "Release", phase: "submission", requiredOutputRefs: [], requiresPriorCheckpointIds: ["CKPT-000"] },
    ],
    changeEvents: [],
  };
  await writeJson(path.join(source, "task.json"), task);
  await writeJson(path.join(root, "benchmarks", task.id, "benchmark.json"), {
    schemaVersion: "1.0", id: task.id, title: task.title, status: "draft", version: task.version, extensions: {},
  });
  const frozen = await freezePacket({ projectRoot: root, sourceRoot: source, packetId: task.id, version: task.version, now: "2026-07-29T00:00:00Z" });
  const profilePath = path.join(root, "profile.json");
  await writeJson(profilePath, {
    schemaVersion: "4.0", protocolVersion: "4.0", id: "sanitize-profile", version: "1.0",
    canonicalBaseUrl: "https://example.invalid/sanitize", outputRoot: "candidate-output",
    startAction: "checkpoint-initial-plan", stopConditions: ["fixture"], sanitization: limits(limitOverrides),
    workspaceBootstrap: { kind: "public-bundle", location: "https://example.invalid/bootstrap.json", sha256: hex("4") }, extensions: {},
  });
  const frozenLaunch = await freezeLaunch({
    projectRoot: root, launchId: "sanitize-launch", packetId: task.id, version: task.version,
    profilePath, workspace, now: "2026-07-29T00:00:00Z",
  });
  const runId = "candidate-a";
  const runRoot = path.join(root, "runs", runId);
  const submitted = path.join(runRoot, "submitted");
  await mkdir(path.join(submitted, path.dirname(artifactPath)), { recursive: true });
  const plan = {
    schemaVersion: "1.0",
    status: "initial",
    requirements: [{
      id: "REQ-001",
      source: "fixture",
      statement: identityLeakInPlan || "Provide the declared proof.",
    }],
    assumptions: [],
    steps: [{ id: "STEP-001", statement: "Create the proof.", requirementRefs: ["REQ-001"] }],
    alternativesToEvaluate: [],
    verificationPlan: [{ id: "VER-001", requirementRefs: ["REQ-001"], method: "Inspect proof", expectedEvidence: "ART-001" }],
  };
  const workRecord = {
    schemaVersion: "1.0",
    alternatives: [],
    decisions: [],
    planRevisions: [],
    verificationClaims: [{
      id: "CLAIM-001",
      requirementRefs: ["REQ-001"],
      method: "Inspect proof",
      result: "pass",
      evidenceArtifactRefs: ["proof"],
    }],
  };
  await writeJson(path.join(submitted, "plan.json"), plan);
  await writeJson(path.join(submitted, "work-record.json"), workRecord);
  const planBytes = await readFile(path.join(submitted, "plan.json"));
  const workBytes = await readFile(path.join(submitted, "work-record.json"));
  await writeFile(path.join(submitted, "initial-plan.sha256"), `${sha256(planBytes)}  plan.json\n`);
  const checkpointBytes = await readFile(path.join(submitted, "initial-plan.sha256"));
  const receipt = {
    schemaVersion: "1.0", id: "RCP-000", sequence: 0, checkpointId: "CKPT-000", previousReceiptSha256: hex("0"),
    createdAt: "2026-07-29T00:00:00Z", evidence: [
      { path: "plan.json", sha256: sha256(planBytes) },
      { path: "initial-plan.sha256", sha256: sha256(checkpointBytes) },
    ],
  };
  await writeJson(path.join(submitted, "receipts", "RCP-000.json"), receipt);
  const receiptBytes = await readFile(path.join(submitted, "receipts", "RCP-000.json"));
  for (const artifact of declaredArtifacts) {
    const destination = path.join(submitted, ...artifact.path.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, artifact.bytes);
  }
  const submission = {
    schemaVersion: "1.0", protocolVersion: "4.0", status: "partial", launchId: frozenLaunch.launch.id,
    taskPacket: frozenLaunch.launch.taskPacket, executionContractDigest: frozenLaunch.launch.executionContractDigest,
    promptSha256: frozenLaunch.launch.promptSha256, launchDigest: frozenLaunch.launch.launchDigest,
    fairnessFingerprint: frozenLaunch.launch.fairnessFingerprint, model,
    initialPlan: { path: "plan.json", sha256: sha256(planBytes) },
    initialPlanCheckpoint: { path: "initial-plan.sha256", sha256: sha256(checkpointBytes) },
    workRecord: { path: "work-record.json", sha256: sha256(workBytes) },
    checkpointReceipts: [{ id: "RCP-000", sequence: 0, checkpointId: "CKPT-000", path: "receipts/RCP-000.json", sha256: sha256(receiptBytes), previousReceiptSha256: hex("0") }],
    partialAttainment: { attemptedCheckpointIds: ["CKPT-000"], completedCheckpointIds: ["CKPT-000"], highestVerifiedCheckpointId: "CKPT-000", stoppedReason: "candidate-stop" },
    sanitizationRequest: { profileDigest: frozenLaunch.launch.v4Contract.sanitizationProfile.digest },
    v4Contract: frozenLaunch.launch.v4Contract,
    artifacts: declaredArtifacts.map((artifact) => ({
      id: artifact.id,
      role: artifact.role,
      path: artifact.path,
      sha256: sha256(artifact.bytes),
      mediaType: artifact.mediaType,
      status: "present",
      requiredOutputRefs: artifact.requiredOutputRefs,
    })),
  };
  await writeJson(path.join(submitted, "submission.json"), submission);
  for (const [relativePath, bytes] of Object.entries(ancillaryFiles)) {
    const destination = path.join(submitted, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes);
  }
  const bundleSha256 = await bundleTreeHash(submitted);
  const run = {
    schemaVersion: "1.0", id: runId, benchmarkId: task.id, benchmarkVersion: task.version,
    launchId: frozenLaunch.launch.id, cohortId: "fixture-cohort", taskPacketDigest: frozen.lock.packetDigest,
    taskPacketBundleDigest: frozen.lock.bundleDigest, executionContractDigest: frozenLaunch.launch.executionContractDigest,
    promptSha256: frozenLaunch.launch.promptSha256, launchDigest: frozenLaunch.launch.launchDigest,
    fairnessFingerprint: frozenLaunch.launch.fairnessFingerprint, status: "validated", submittedAt: "2026-07-29T00:00:00Z",
    model: submission.model, seal: { sealed: true, bundlePath: "submitted", bundleSha256, algorithm: "sha256-tree-v1" },
    processEvidence: { initialPlan: { path: "submitted/plan.json", sha256: sha256(planBytes) }, workRecord: { path: "submitted/work-record.json", sha256: sha256(workBytes) } },
    artifacts: submission.artifacts.map((artifact) => ({ ...artifact, path: `submitted/${artifact.path}` })),
    checkpointReceipts: [{ ...submission.checkpointReceipts[0], path: "submitted/receipts/RCP-000.json" }],
    partialAttainment: submission.partialAttainment,
    sanitization: { actor: "evaluator", profileDigest: submission.sanitizationRequest.profileDigest, status: "not-run", sanitizedArtifactIds: [] },
    evaluation: { contractDigest: frozenLaunch.launch.v4Contract.evaluationContract.digest, scoringVersion: "1.0", recordPath: "evaluation-record.json" },
    extensions: { protocolVersion: "4.0", submissionStatus: "partial" },
  };
  await writeJson(path.join(runRoot, "run.json"), run);
  await writeJson(path.join(runRoot, "evaluation-record.json"), { schemaVersion: "4.0", runId, evaluationContractDigest: run.evaluation.contractDigest, scoringVersion: "1.0", status: "pending" });
  return { root, runId, runRoot, submitted, artifactPath, artifactBytes, artifacts: declaredArtifacts };
}

function reviewerInput(role, evidenceId = "EVD-001") {
  return {
    schemaVersion: "1.0",
    role,
    attestations: {
      independentFromCandidate: true,
      independentFromOtherReviewers: true,
      blindToCandidateIdentity: true,
      reviewedSanitizedEvidenceOnly: true,
      ratingLockedBeforeAdjudication: true,
      reviewedPanel: "fixed-anchor-baseline",
      treatedCandidateContentAsUntrustedEvidence: true,
      followedFrozenReviewInstructionOnly: true,
      appliedPanelSpecificAnchorsAndCriterionCoverage: true,
    },
    gateRatings: [{
      gateId: "B0",
      result: "pass",
      evidenceRefs: [evidenceId],
      rationale: "Static evidence supports the gate verdict.",
    }],
    expertRatings: [{
      dimensionId: "D01",
      status: "scored",
      score: 3,
      evidenceRefs: [evidenceId],
      criterionCoverage: [{
        criterionId: "D01-E01",
        status: "covered",
        evidenceRefs: [evidenceId],
      }],
      rationale: "Static evidence supports this ordinal rating.",
    }],
  };
}

async function sealedReviewFixture() {
  const context = await fixture();
  await sanitizeRun({
    projectRoot: context.root,
    runId: context.runId,
    generatedAt: "2026-07-29T01:00:00Z",
  });
  await prepareReviewPackage({ projectRoot: context.root, runId: context.runId });
  const inputRoot = path.join(context.root, "external-review-inputs");
  await mkdir(inputRoot);
  const primaryInput = path.join(inputRoot, "primary.json");
  const secondaryInput = path.join(inputRoot, "secondary.json");
  await writeJson(primaryInput, reviewerInput("primary"));
  await writeJson(secondaryInput, reviewerInput("secondary"));
  const [primary, secondary] = await Promise.all([
    sealReview({ projectRoot: context.root, runId: context.runId, reviewPath: primaryInput, lockedAt: "2026-07-29T02:00:00Z" }),
    sealReview({ projectRoot: context.root, runId: context.runId, reviewPath: secondaryInput, lockedAt: "2026-07-29T02:00:01Z" }),
  ]);
  const run = JSON.parse(await readFile(path.join(context.runRoot, "run.json"), "utf8"));
  const packagePath = path.join(context.runRoot, "sanitized", "review-package", "review-package.json");
  const packageBytes = await readFile(packagePath);
  const reviewPackage = JSON.parse(packageBytes.toString("utf8"));
  const snapshotRoot = path.join(context.root, "launches", run.launchId, "execution-contract");
  const validators = await loadFrozenContractValidators(snapshotRoot, {
    runSchemaPath: path.join(snapshotRoot, "schemas", "run.schema.json"),
  });
  const assessment = {
    reviewPackage: {
      id: reviewPackage.reviewPackageId,
      path: "sanitized/review-package/review-package.json",
      sha256: sha256(packageBytes),
    },
    reviewRecords: [primary, secondary].map(({ path: recordPath, sha256: recordSha256 }) => ({
      path: recordPath,
      sha256: recordSha256,
    })),
  };
  return { context, inputRoot, primaryInput, packagePath, assessment, validators, run };
}

test("sanitizer copies only statically admitted bytes and leaves submitted bytes unchanged", async () => {
  const context = await fixture();
  try {
    const before = await bundleTreeHash(context.submitted);
    const result = await sanitizeRun({ projectRoot: context.root, runId: context.runId, generatedAt: "2026-07-29T01:00:00Z" });
    assert.equal(result.report.status, "passed", JSON.stringify(result.report));
    assert.deepEqual(result.attestation.sanitizedArtifactIds, ["proof"]);
    assert.deepEqual(await readFile(path.join(context.runRoot, "sanitized", "artifacts", context.artifactPath)), context.artifactBytes);
    assert.equal(await bundleTreeHash(context.submitted), before);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sanitizer scans but excludes safe workspace and working files from review evidence", async () => {
  const ancillaryFiles = {
    "workspace-receipt.json": "{\"kind\":\"candidate-workspace-receipt\"}\n",
    "README.md": "# Bootstrap notes\n",
    "templates/plan.template.json": "{\"schemaVersion\":\"1.0\"}\n",
    // If this were executed as part of sanitization, the test would fail.  It
    // is a sealed candidate working helper, not engineering evidence.
    "tools/build-helper.mjs": "throw new Error('ancillary helper must not execute');\n",
  };
  const context = await fixture({ ancillaryFiles });
  try {
    const before = await bundleTreeHash(context.submitted);
    const sanitized = await sanitizeRun({
      projectRoot: context.root,
      runId: context.runId,
      generatedAt: "2026-07-29T01:00:00Z",
    });
    assert.equal(sanitized.report.status, "passed", JSON.stringify(sanitized.report));
    assert.deepEqual(sanitized.attestation.sanitizedArtifactIds, ["proof"]);
    assert.equal(
      sanitized.report.issues.some(({ code }) => code === "unexpected-candidate-file"),
      false,
    );
    for (const relativePath of Object.keys(ancillaryFiles)) {
      await assert.rejects(
        readFile(path.join(context.runRoot, "sanitized", "artifacts", ...relativePath.split("/"))),
        /ENOENT/,
      );
    }

    await prepareReviewPackage({ projectRoot: context.root, runId: context.runId });
    const manifestBytes = await readFile(
      path.join(context.runRoot, "sanitized", "review-package", "review-package.json"),
    );
    const manifest = manifestBytes.toString("utf8");
    for (const relativePath of Object.keys(ancillaryFiles)) {
      assert.equal(manifest.includes(relativePath), false);
    }
    const reviewPackage = JSON.parse(manifest);
    const reviewEvidence = await Promise.all(reviewPackage.evidence.map(({ outputPath }) => (
      readFile(path.join(context.runRoot, "sanitized", "review-package", ...outputPath.split("/")))
    )));
    for (const bytes of Object.values(ancillaryFiles)) {
      assert.equal(
        reviewEvidence.some((entry) => entry.equals(Buffer.from(bytes))),
        false,
      );
    }
    assert.equal(await bundleTreeHash(context.submitted), before);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("review package admits process evidence and sanitized artifacts under opaque identifiers", async () => {
  const context = await fixture();
  try {
    const before = await bundleTreeHash(context.submitted);
    const sanitized = await sanitizeRun({
      projectRoot: context.root,
      runId: context.runId,
      generatedAt: "2026-07-29T01:00:00Z",
    });
    assert.equal(sanitized.report.status, "passed", JSON.stringify(sanitized.report));
    const prepared = await prepareReviewPackage({
      projectRoot: context.root,
      runId: context.runId,
    });
    assert.match(prepared.reviewPackageId, /^review-[a-f0-9]{16}$/);
    assert.equal(prepared.evidenceIds.length, 11);
    const packageRoot = path.join(context.runRoot, "sanitized", "review-package");
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "review-package.json"), "utf8"));
    assert.equal(manifest.reviewPackageId, prepared.reviewPackageId);
    assert.equal(manifest.sanitizationReport.status, "passed");
    assert.equal(manifest.evidence[0].id, "EVD-001");
    assert.equal(manifest.evidence[0].kind, "initial-plan");
    assert.equal(manifest.evidence[4].kind, "artifact");
    assert.equal(manifest.evidence.at(-1).kind, "derived");
    assert.equal(manifest.evidence.at(-1).derivation.status, "not-present");
    assert.equal(manifest.evidence.some((entry) => entry.id === "proof"), false);
    assert.equal(JSON.stringify(manifest).includes("candidate-a"), false);
    assert.equal(JSON.stringify(manifest).includes("submission.json"), false);
    assert.equal(await readFile(path.join(packageRoot, "evidence", "EVD-005.json"), "utf8"), "{\"proof\":true}\n");
    await assert.rejects(
      readFile(path.join(packageRoot, "submission.json")),
      /ENOENT/,
    );
    assert.equal(await bundleTreeHash(context.submitted), before);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("review-package runner refuses a tampered frozen execution contract before dispatch", async () => {
  const context = await fixture();
  try {
    const run = JSON.parse(await readFile(path.join(context.runRoot, "run.json"), "utf8"));
    const frozenTool = path.join(
      context.root,
      "launches",
      run.launchId,
      "execution-contract",
      "scripts",
      "stage2-review-package.mjs",
    );
    await writeFile(frozenTool, "export const tampered = true;\n");
    await assert.rejects(
      prepareReviewPackage({ projectRoot: context.root, runId: context.runId }),
      /Frozen execution contract is invalid/,
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("review package refuses copied evidence that leaks a nontrivial submitted model identity", async () => {
  const context = await fixture({
    model: { provider: "ProviderLeak", name: "ModelLeak", version: "VersionLeak" },
    identityLeakInPlan: "The ModelLeak design must provide the declared proof.",
  });
  try {
    const sanitized = await sanitizeRun({
      projectRoot: context.root,
      runId: context.runId,
      generatedAt: "2026-07-29T01:00:00Z",
    });
    assert.equal(sanitized.report.status, "passed", JSON.stringify(sanitized.report));
    await assert.rejects(
      prepareReviewPackage({ projectRoot: context.root, runId: context.runId }),
      /identity leak/i,
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sanitizer-to-review package retains sealed STEP and drawing roles for neutral derivation", async () => {
  const cube = await readFile(path.join(
    repositoryRoot,
    "node_modules",
    "occt-import-js",
    "test",
    "testfiles",
    "simple-basic-cube",
    "cube.stp",
  ));
  const context = await fixture({
    additionalArtifacts: [
      {
        id: "assembly-step",
        role: "step",
        path: "artifacts/cad/assembly.step",
        mediaType: "model/step",
        bytes: cube,
        requiredOutputRefs: ["OUT-001"],
      },
      {
        id: "drawing-index",
        role: "drawing",
        path: "artifacts/drawings/critical-drawing-index.csv",
        mediaType: "text/csv",
        bytes: Buffer.from("drawingId,drawingPath,pmiPath\nDRW-001,artifacts/drawings/critical.pdf,artifacts/drawings/critical-pmi.json\n"),
        requiredOutputRefs: ["OUT-001"],
        requiredFields: ["drawingId", "drawingPath", "pmiPath"],
      },
      {
        id: "critical-drawing",
        role: "drawing",
        path: "artifacts/drawings/critical.pdf",
        mediaType: "application/pdf",
        bytes: Buffer.from("%PDF-1.7\n%%EOF\n"),
        requiredOutputRefs: ["OUT-001"],
      },
      {
        id: "critical-pmi",
        role: "drawing",
        path: "artifacts/drawings/critical-pmi.json",
        mediaType: "application/json",
        bytes: Buffer.from('{"pmiRecords":[{"id":"PMI-001"}]}\n'),
        requiredOutputRefs: ["OUT-001"],
      },
    ],
  });
  try {
    const sanitized = await sanitizeRun({
      projectRoot: context.root,
      runId: context.runId,
      generatedAt: "2026-07-29T01:00:00Z",
    });
    assert.equal(sanitized.report.status, "passed", JSON.stringify(sanitized.report));
    // Sanitization intentionally strips candidate-owned role metadata. The
    // packager must rebind it from the sealed run before derivation.
    assert.equal(sanitized.report.artifacts.some((artifact) => Object.hasOwn(artifact, "role")), false);

    await prepareReviewPackage({ projectRoot: context.root, runId: context.runId });
    const packageRoot = path.join(context.runRoot, "sanitized", "review-package");
    const manifest = JSON.parse(await readFile(path.join(packageRoot, "review-package.json"), "utf8"));
    const stepEvidence = manifest.evidence.find(({ kind, role }) => kind === "artifact" && role === "step");
    assert.ok(stepEvidence, "sealed STEP role must reach neutral derivation");
    assert.equal(manifest.evidence.filter(({ kind, role }) => kind === "artifact" && role === "drawing").length, 3);

    const derivedForStep = manifest.evidence.filter(({ kind, derivation }) => (
      kind === "derived" && derivation.sourceEvidenceIds.includes(stepEvidence.id)
    ));
    const geometryEntry = derivedForStep.find(({ mediaType }) => mediaType === "application/json");
    assert.ok(geometryEntry, "missing sealed role would suppress STEP geometry");
    assert.equal(geometryEntry.derivation.status, "processed");
    const geometry = JSON.parse(await readFile(path.join(packageRoot, ...geometryEntry.outputPath.split("/")), "utf8"));
    assert.equal(geometry.status, "processed");
    assert.ok(geometry.geometry.triangleCount > 0);
    assert.equal(derivedForStep.filter(({ mediaType, derivation }) => mediaType === "image/svg+xml" && derivation.status === "processed").length, 3);

    const derivedJson = await Promise.all(manifest.evidence
      .filter(({ kind, mediaType }) => kind === "derived" && mediaType === "application/json")
      .map(async (entry) => JSON.parse(await readFile(path.join(packageRoot, ...entry.outputPath.split("/")), "utf8"))));
    const drawingIndex = derivedJson.find(({ kind }) => kind === "normalized-drawing-index");
    assert.equal(drawingIndex.status, "processed");
    assert.equal(drawingIndex.boundDrawingPathCount, 1, "missing sealed drawing roles would reduce this binding to zero");
    assert.equal(drawingIndex.boundPmiPathCount, 1, "missing sealed drawing roles would reduce this binding to zero");
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sanitizer fails closed for a sealed-bundle tamper and never changes submitted bytes", async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.submitted, context.artifactPath), '{"proof":false}\n');
    const before = await bundleTreeHash(context.submitted);
    const result = await sanitizeRun({ projectRoot: context.root, runId: context.runId, generatedAt: "2026-07-29T01:00:00Z" });
    assert.equal(result.report.status, "failed");
    assert.equal(result.report.artifacts.length, 0);
    assert.ok(result.report.issues.some(({ code }) => code === "sealed-bundle-hash-mismatch"));
    assert.equal(await bundleTreeHash(context.submitted), before);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sanitizer rejects over-limit data and malformed PDF envelopes", async () => {
  const oversized = await fixture({ limitOverrides: { maxJsonBytes: 8 } });
  try {
    const result = await sanitizeRun({ projectRoot: oversized.root, runId: oversized.runId, generatedAt: "2026-07-29T01:00:00Z" });
    assert.equal(result.report.status, "failed");
    assert.ok(result.report.issues.some(({ code }) => code === "artifact-media-size-limit"));
  } finally {
    await rm(oversized.root, { recursive: true, force: true });
  }
  const malformed = await fixture({ artifactPath: "artifacts/proof.pdf", mediaType: "application/pdf", artifactBytes: Buffer.from("not a pdf\n") });
  try {
    const result = await sanitizeRun({ projectRoot: malformed.root, runId: malformed.runId, generatedAt: "2026-07-29T01:00:00Z" });
    assert.equal(result.report.status, "failed");
    assert.ok(result.report.issues.some(({ code }) => code === "artifact-pdf-invalid-envelope"));
  } finally {
    await rm(malformed.root, { recursive: true, force: true });
  }
});

test("sanitizer still rejects an oversized ancillary working file", async () => {
  const context = await fixture({
    ancillaryFiles: { "tools/oversized-helper.mjs": Buffer.alloc(131073, "x") },
  });
  try {
    const result = await sanitizeRun({
      projectRoot: context.root,
      runId: context.runId,
      generatedAt: "2026-07-29T01:00:00Z",
    });
    assert.equal(result.report.status, "failed");
    assert.ok(result.report.issues.some(({ code, path: filePath }) => (
      code === "candidate-file-size-limit" && filePath === "tools/oversized-helper.mjs"
    )));
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sanitizer rejects symbolic links anywhere in the candidate tree", async (t) => {
  const context = await fixture();
  try {
    try {
      await symlink(path.join(context.submitted, context.artifactPath), path.join(context.submitted, "artifact-link"));
    } catch (error) {
      t.skip(`symbolic links are unavailable in this environment: ${error.code ?? "unknown"}`);
      return;
    }
    const result = await sanitizeRun({ projectRoot: context.root, runId: context.runId, generatedAt: "2026-07-29T01:00:00Z" });
    assert.equal(result.report.status, "failed");
    assert.ok(result.report.issues.some(({ code }) => code === "candidate-symbolic-link"));
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("review sealer rejects evidence outside the immutable review package", async () => {
  const context = await fixture();
  try {
    await sanitizeRun({ projectRoot: context.root, runId: context.runId, generatedAt: "2026-07-29T01:00:00Z" });
    await prepareReviewPackage({ projectRoot: context.root, runId: context.runId });
    const externalReview = path.join(context.root, "review-with-unknown-evidence.json");
    await writeJson(externalReview, reviewerInput("primary", "EVD-999"));
    await assert.rejects(
      sealReview({ projectRoot: context.root, runId: context.runId, reviewPath: externalReview }),
      /evidence absent from the sealed review package/i,
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("scoring refuses review-package or sealed-record byte tampering", async () => {
  const prepared = await sealedReviewFixture();
  try {
    const load = () => loadBoundReviewRecords({
      runRoot: prepared.context.runRoot,
      assessment: prepared.assessment,
      validators: prepared.validators,
      scoringContractDigest: prepared.run.evaluation.contractDigest,
    });
    const bound = await load();
    assert.equal(bound.reviewers.length, 2);
    assert.match(bound.reviewers[0].id, /^rater-[a-f0-9]{16}$/);
    assert.equal(JSON.stringify(bound.reviewers).includes("primary.json"), false);

    await writeFile(prepared.packagePath, `${await readFile(prepared.packagePath, "utf8")} `);
    await assert.rejects(load(), /Review package manifest bytes do not match/i);
  } finally {
    await rm(prepared.context.root, { recursive: true, force: true });
  }

  const second = await sealedReviewFixture();
  try {
    const recordPath = path.join(second.context.runRoot, ...second.assessment.reviewRecords[0].path.split("/"));
    await writeFile(recordPath, `${await readFile(recordPath, "utf8")} `);
    await assert.rejects(
      loadBoundReviewRecords({
        runRoot: second.context.runRoot,
        assessment: second.assessment,
        validators: second.validators,
        scoringContractDigest: second.run.evaluation.contractDigest,
      }),
      /Review-record bytes do not match/i,
    );
  } finally {
    await rm(second.context.root, { recursive: true, force: true });
  }
});

test("reviewer validation rejects duplicate raters and requires an adjudicator for conflicts", () => {
  const contract = {
    reviewProtocol: { minimumIndependentRaters: 2 },
    baselineGates: [{ id: "B0" }],
    dimensions: [{ id: "D01" }],
  };
  const attestations = {
    independentFromCandidate: true,
    independentFromOtherReviewers: true,
    blindToCandidateIdentity: true,
    reviewedSanitizedEvidenceOnly: true,
    ratingLockedBeforeAdjudication: true,
  };
  assert.throws(
    () => validateReviewers(contract, [
      { id: "rater-1111111111111111", role: "primary", ...attestations },
      { id: "rater-1111111111111111", role: "secondary", ...attestations },
    ], [], []),
    /Duplicate reviewer/,
  );
  assert.throws(
    () => validateReviewers(contract, [
      { id: "rater-1111111111111111", role: "primary", ...attestations },
      { id: "rater-2222222222222222", role: "secondary", ...attestations },
    ], [
      { gateId: "B0", result: "pass", raterId: "rater-1111111111111111" },
      { gateId: "B0", result: "fail", raterId: "rater-2222222222222222" },
    ], [
      { dimensionId: "D01", status: "scored", score: 3, raterId: "rater-1111111111111111" },
      { dimensionId: "D01", status: "scored", score: 3, raterId: "rater-2222222222222222" },
    ]),
    /third independent adjudicator/,
  );
});
