import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import {
  importPublicCohortPublication,
  validatePublicCohortPublication,
} from "../scripts/publication-lib.mjs";
import { publicEvaluationSummary } from "../scripts/public-evaluation-summary.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const hex = (character) => character.repeat(64);

async function write(root, relative, value) {
  const destination = path.join(root, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  const bytes = Buffer.isBuffer(value) ? value : jsonBytes(value);
  await writeFile(destination, bytes, { flag: "wx" });
  return { bytes, sha256: sha256(bytes) };
}

function aggregate({ disclosureSha256, evaluationRecordSha256 }) {
  return {
    schemaVersion: "1.0",
    cohortId: "cohort-public-a",
    launchId: "launch-a",
    measurementConditionsSha256: hex("c"),
    disclosureSha256,
    generatedAt: "2026-07-30T00:00:00Z",
    binding: {
      fairnessFingerprint: hex("f"),
      evaluationContractDigest: hex("e"),
      scoringVersion: "1.0",
      scoringContractSha256: hex("d"),
      panel: "fixed-anchor-panel",
    },
    evaluationRecords: [{
      runId: "opaque-run-a-01",
      path: "evaluation-summaries/opaque-run-a-01.json",
      sha256: evaluationRecordSha256,
      status: "admitted",
    }],
    modelGroups: [{
      groupId: "model-group-a",
      runIds: ["opaque-run-a-01"],
      runCount: 1,
      admission: { count: 1, rate: 1 },
      qualification: { baseline: { count: 1, rate: 1 }, change: { count: 0, rate: 0 } },
      dimensions: Array.from({ length: 10 }, (_, index) => ({
        id: `D${String(index + 1).padStart(2, "0")}`,
        label: `Dimension ${index + 1}`,
        runCount: 1,
        evaluableCount: 1,
        median: 3,
        observedInterval: [3, 3],
        failureCauses: {},
      })),
      gates: [{ id: "A0", runCount: 1, passCount: 1, passRate: 1, resultCounts: { pass: 1 } }],
      attainment: { highestCheckpointCounts: { "CKPT-040": 1 } },
      rawMetrics: { separateFromDesignQuality: true, records: [{ runId: "opaque-run-a-01", values: [] }] },
      efficiency: { separateFromDesignQuality: true, records: [{ runId: "opaque-run-a-01", values: {} }] },
      compositeScore: null,
      compositeScorePublished: false,
    }],
    compositeScore: null,
    compositeScorePublished: false,
  };
}

function v110PublicEvaluationSummary() {
  const privateRecord = {
    runId: "opaque-run-a-01",
    status: "admitted",
    qualification: { baselineQualified: true, changeQualified: null },
    attainment: { highestVerifiedCheckpoint: "CKPT-040" },
    gates: [{ id: "A0", label: "Admission", result: "pass", checks: [] }],
    dimensions: [{
      id: "D01",
      label: "Dimension",
      attempted: true,
      evidenceCoverage: {
        required: 2,
        covered: 1,
        missing: 1,
        uncertain: 0,
        ratio: 0.5,
        criteria: [
          { id: "D01-E01", criterion: "private criterion", consensusStatus: "covered" },
          { id: "D01-E02", criterion: "private criterion", consensusStatus: "missing" },
        ],
        reviewerObservations: [{
          raterId: "rater-0123456789abcdef",
          rationale: "private rationale",
          path: "sanitized/private-evidence.json",
        }],
      },
      evaluable: true,
      ratingStatus: "scored",
      score: 3,
      scoreInterval: [3, 3],
      nonEvaluationCause: null,
      highestVerifiedCheckpoint: "CKPT-040",
      ratings: [{ raterId: "rater-0123456789abcdef", rationale: "private rationale" }],
    }],
    rawMetrics: [],
    efficiency: { separateFromDesignQuality: true, values: {} },
  };
  return publicEvaluationSummary(privateRecord, jsonBytes(privateRecord));
}

async function createBundle({
  artifactBytes = Buffer.from("safe static artifact"),
  mutate,
  evaluationVersion = "legacy",
  evaluationMutate,
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "rotorbench-publication-"));
  const disclosure = {
    schemaVersion: "1.0",
    cohortId: "cohort-public-a",
    launchId: "launch-a",
    measurementConditionsSha256: hex("c"),
    disclosedAt: "2026-07-30T00:00:00Z",
    modelGroups: [{
      groupId: "model-group-a",
      runIds: ["opaque-run-a-01"],
      model: { provider: "Provider A", name: "Model A", version: "v1", reasoningSetting: "high", policy: "fixed" },
    }],
  };
  const disclosureFile = await write(root, "cohort-disclosure.json", disclosure);
  const legacyEvaluation = {
    schemaVersion: "1.0",
    runId: "opaque-run-a-01",
    status: "admitted",
    evaluationRecordSha256: hex("a"),
    finalization: null,
    qualification: { baselineQualified: true, changeQualified: null },
    attainment: { highestVerifiedCheckpoint: "CKPT-040" },
    gates: [{ id: "A0", label: "Admission", result: "pass" }],
    dimensions: [{ id: "D01", label: "Dimension", score: 3, scoreInterval: [3, 3], evaluable: true }],
    rawMetrics: [],
    efficiency: { separateFromDesignQuality: true, values: {} },
    compositeScore: null,
    compositeScorePublished: false,
  };
  const evaluation = evaluationVersion === "v110"
    ? v110PublicEvaluationSummary()
    : legacyEvaluation;
  evaluationMutate?.(evaluation);
  const evaluationRecordSha256 = evaluation.evaluationRecordSha256;
  const evaluationFile = await write(root, "evaluation-summaries/opaque-run-a-01.json", evaluation);
  const validation = {
    schemaVersion: "1.0",
    runId: "opaque-run-a-01",
    status: "valid",
    generatedAt: "2026-07-30T00:00:00Z",
    sourceReportSha256: hex("b"),
    checkCounts: { pass: 5, fail: 0, warning: 0 },
    issueCodes: [],
  };
  const validationFile = await write(root, "validation-summaries/opaque-run-a-01.json", validation);
  const artifactFile = await write(root, "artifacts/opaque-run-a-01/step-a.download", artifactBytes);
  const metadata = {
    schemaVersion: "1.0",
    id: "opaque-run-a-01",
    benchmarkId: "integrated-robotic-handling",
    benchmarkVersion: "1.0",
    launchId: "launch-a",
    cohortId: "cohort-public-a",
    taskPacketDigest: hex("1"),
    fairnessFingerprint: hex("f"),
    status: "published",
    submittedAt: "2026-07-30T00:00:00Z",
    seal: { bundleSha256: hex("2"), algorithm: "sha256-tree-v1" },
    artifacts: [{ id: "step-a", role: "step", sha256: artifactFile.sha256, status: "processed", mediaType: "model/step", label: "STEP", downloadPath: "artifacts/opaque-run-a-01/step-a.download" }],
    validation: { path: "validation-summaries/opaque-run-a-01.json", sha256: validationFile.sha256 },
    evaluation: { path: "evaluation-summaries/opaque-run-a-01.json", sha256: evaluationFile.sha256 },
  };
  const metadataFile = await write(root, "candidate-metadata/opaque-run-a-01.json", metadata);
  const aggregateValue = aggregate({ disclosureSha256: disclosureFile.sha256, evaluationRecordSha256 });
  const aggregateFile = await write(root, "cohort-evaluation-aggregate.json", aggregateValue);
  const files = [
    { path: "cohort-disclosure.json", kind: "disclosure", sha256: disclosureFile.sha256, bytes: disclosureFile.bytes.length, sourceSha256: disclosureFile.sha256 },
    { path: "cohort-evaluation-aggregate.json", kind: "aggregate", sha256: aggregateFile.sha256, bytes: aggregateFile.bytes.length, sourceSha256: hex("3") },
    { path: "candidate-metadata/opaque-run-a-01.json", kind: "run-metadata", sha256: metadataFile.sha256, bytes: metadataFile.bytes.length, sourceSha256: hex("4") },
    { path: "evaluation-summaries/opaque-run-a-01.json", kind: "evaluation-summary", sha256: evaluationFile.sha256, bytes: evaluationFile.bytes.length, sourceSha256: evaluationRecordSha256 },
    { path: "validation-summaries/opaque-run-a-01.json", kind: "validation-summary", sha256: validationFile.sha256, bytes: validationFile.bytes.length, sourceSha256: hex("b") },
    { path: "artifacts/opaque-run-a-01/step-a.download", kind: "artifact", sha256: artifactFile.sha256, bytes: artifactFile.bytes.length, sourceSha256: artifactFile.sha256 },
  ];
  const manifest = {
    schemaVersion: "1.0",
    kind: "rotorbench-public-cohort-publication",
    cohortId: "cohort-public-a",
    launchId: "launch-a",
    fairnessFingerprint: hex("f"),
    exportedAt: "2026-07-30T00:00:00Z",
    source: { frameworkValidationDigest: hex("5"), cohortManifestSha256: hex("6"), measurementConditionsSha256: hex("c"), disclosureSha256: disclosureFile.sha256, aggregateSha256: hex("3") },
    files,
  };
  if (mutate) mutate({ manifest, metadata, evaluation, validation, aggregate: aggregateValue, files });
  const manifestFile = await write(root, "publication.json", manifest);
  await writeFile(path.join(root, "publication.sha256"), `${manifestFile.sha256}\n`, { flag: "wx" });
  return root;
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "ignore" });
    child.once("error", reject);
    child.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`command failed: ${code}`)));
  });
}

test("portable publication import validates hashes and writes only publication state atomically", async (t) => {
  const bundle = await createBundle();
  const project = await mkdtemp(path.join(os.tmpdir(), "rotorbench-public-repo-"));
  t.after(async () => Promise.all([rm(bundle, { recursive: true, force: true }), rm(project, { recursive: true, force: true })]));
  const checked = await validatePublicCohortPublication(bundle);
  assert.equal(checked.runMetadata.size, 1);
  const result = await importPublicCohortPublication({ projectRoot: project, bundlePath: bundle });
  assert.deepEqual(result.runIds, ["opaque-run-a-01"]);
  assert.equal((await readFile(path.join(project, "publications", "cohort-public-a", "publication.sha256"), "utf8")).trim(), result.manifestSha256);
  await assert.rejects(importPublicCohortPublication({ projectRoot: project, bundlePath: bundle }), /already exists/);
});

test("portable publication rejects private reviewer tokens, private paths, and modified bytes", async (t) => {
  const secret = await createBundle({ artifactBytes: Buffer.from("rater-0123456789abcdef") });
  const traversal = await createBundle({ mutate: ({ manifest }) => { manifest.files[0].path = "../cohort-disclosure.json"; } });
  const tampered = await createBundle();
  await writeFile(path.join(tampered, "validation-summaries", "opaque-run-a-01.json"), "{}\n");
  t.after(async () => Promise.all([secret, traversal, tampered].map((item) => rm(item, { recursive: true, force: true }))));
  await assert.rejects(validatePublicCohortPublication(secret), /prohibited private token/);
  await assert.rejects(validatePublicCohortPublication(traversal), /schema-invalid|unsafe/);
  await assert.rejects(validatePublicCohortPublication(tampered), /hash or size mismatch/);
});

test("v1.10 ratingStatus crosses the portable publication boundary while reviewer fields remain prohibited", async (t) => {
  const valid = await createBundle({ evaluationVersion: "v110" });
  const privateFields = ["rating", "ratings", "raterId", "reviewerObservations"];
  const invalid = await Promise.all(privateFields.map((field) => createBundle({
    evaluationVersion: "v110",
    evaluationMutate: (evaluation) => {
      evaluation.dimensions[0][field] = field === "raterId" ? "anonymous" : [];
    },
  })));
  const misplacedRatingStatuses = await Promise.all([
    ["rawMetrics", [1, 4]],
    ["qualification", 3],
    ["attainment", "scored"],
    ["gates", "not-evaluable"],
    ["efficiency", { primary: "scored" }],
  ].map(([location, value]) => createBundle({
    evaluationVersion: "v110",
    evaluationMutate: (evaluation) => {
      if (location === "rawMetrics") evaluation.rawMetrics = [{ ratingStatus: value }];
      else if (location === "gates") evaluation.gates = [{ id: "A0", label: "Admission", result: "pass", ratingStatus: value }];
      else evaluation[location].ratingStatus = value;
    },
  })));
  const project = await mkdtemp(path.join(os.tmpdir(), "rotorbench-v110-publication-"));
  t.after(async () => Promise.all([valid, project, ...invalid, ...misplacedRatingStatuses].map((item) => rm(item, { recursive: true, force: true }))));

  const checked = await validatePublicCohortPublication(valid);
  assert.equal(checked.parsed.get("evaluation-summaries/opaque-run-a-01.json").dimensions[0].ratingStatus, "scored");
  assert.deepEqual((await importPublicCohortPublication({ projectRoot: project, bundlePath: valid })).runIds, ["opaque-run-a-01"]);
  for (const [index, field] of privateFields.entries()) {
    await assert.rejects(validatePublicCohortPublication(invalid[index]), new RegExp(`prohibited field .*${field}`));
  }
  for (const bundle of misplacedRatingStatuses) {
    await assert.rejects(validatePublicCohortPublication(bundle), /prohibited field .*ratingStatus/);
  }
});

test("failed import rolls back staging and the public catalog can be built from publication state alone", async (t) => {
  const invalid = await createBundle({ artifactBytes: Buffer.from("reviewer-secret") });
  const valid = await createBundle();
  const project = await mkdtemp(path.join(os.tmpdir(), "rotorbench-public-catalog-"));
  t.after(async () => Promise.all([invalid, valid, project].map((item) => rm(item, { recursive: true, force: true }))));
  for (const directory of ["benchmarks", "task-packets", "launches", "cohorts", "runs", "evaluation", "workspace-bootstrap", "publications"]) {
    await mkdir(path.join(project, directory), { recursive: true });
  }
  await assert.rejects(importPublicCohortPublication({ projectRoot: project, bundlePath: invalid }), /prohibited private token/);
  const afterFailure = await readdir(path.join(project, "publications"));
  assert.equal(afterFailure.length, 0);
  await importPublicCohortPublication({ projectRoot: project, bundlePath: valid });
  const node = process.execPath;
  await run(node, [path.join(process.cwd(), "scripts", "build-framework-catalog.mjs"), "--root", project], project);
  const catalog = JSON.parse(await readFile(path.join(project, "public", "framework", "catalog.json"), "utf8"));
  assert.equal(catalog.cohorts.length, 1);
  assert.equal(catalog.runs.length, 1);
  assert.equal(catalog.runs[0].processEvidence, null);
  assert.match(catalog.runs[0].evaluation.download, /framework\/publications\/cohort-public-a\/evaluation-summaries/);
});
