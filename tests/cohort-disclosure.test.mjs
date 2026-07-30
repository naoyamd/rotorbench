import assert from "node:assert/strict";
import test from "node:test";
import {
  validateCohortDisclosure,
  validateCohortEvaluationAggregate,
  validatePublicEvaluationSummary,
} from "../scripts/framework-lib.mjs";
import {
  buildCohortEvaluationAggregate,
  validateDisclosureForPublication,
} from "../scripts/stage2-publish-cohort.mjs";
import { publicEvaluationSummary } from "../scripts/public-evaluation-summary.mjs";

const hex = (character) => character.repeat(64);
const runIds = ["opaque-a-01", "opaque-a-02", "opaque-a-03"];

function disclosure() {
  return {
    schemaVersion: "1.0",
    cohortId: "cohort-a",
    launchId: "launch-a",
    measurementConditionsSha256: hex("c"),
    disclosedAt: "2026-07-29T12:00:00Z",
    modelGroups: [{
      groupId: "model-group-a",
      runIds: [...runIds],
      model: {
        provider: "provider-a",
        name: "model-a",
        version: "2026-07",
        reasoningSetting: "high",
        policy: "standard",
      },
    }],
  };
}

function record(runId, score) {
  return {
    schemaVersion: "4.0",
    runId,
    evaluationContractDigest: hex("e"),
    scoringVersion: "1.0",
    benchmarkId: "integrated-robotic-handling",
    scoringContract: { id: "scoring", version: "1.0", sha256: hex("a") },
    panel: "fixed-anchor-baseline",
    launchId: "launch-a",
    fairnessFingerprint: hex("f"),
    candidateBundleSha256: hex(String(score)),
    evaluatedAt: "2026-07-29T12:00:00Z",
    status: "admitted",
    reviewAudit: {
      reviewPackage: {
        id: "review-1111111111111111",
        path: "sanitized/review-package/review-package.json",
        sha256: hex("1"),
      },
      records: [
        {
          path: "sanitized/reviews/rater-2222222222222222.json",
          sha256: hex("2"),
          reviewerId: "rater-2222222222222222",
          role: "primary",
        },
        {
          path: "sanitized/reviews/rater-3333333333333333.json",
          sha256: hex("3"),
          reviewerId: "rater-3333333333333333",
          role: "secondary",
        },
      ],
    },
    admissionIssues: [],
    qualification: { baselineQualified: score >= 3, changeQualified: null, changeFailureDoesNotEraseBaseline: true },
    gates: [{ id: "A0", label: "Admission", result: "pass", checks: [] }],
    attainment: { highestVerifiedCheckpoint: "CKPT-040", verifiedCheckpointRefs: ["CKPT-040"] },
    dimensions: Array.from({ length: 10 }, (_, index) => ({
      id: `D${String(index + 1).padStart(2, "0")}`,
      label: `Dimension ${index + 1}`,
      attempted: true,
      evaluable: true,
      score,
      scoreInterval: [score, score],
      failureCause: null,
      ratings: [],
    })),
    rawMetrics: [{ id: "mass", value: score }],
    compositeScore: null,
    compositeScorePublished: false,
    efficiency: { separateFromDesignQuality: true, values: { wallClockMinutes: score } },
  };
}

test("post-review disclosure requires exact frozen three-repeat membership", () => {
  const value = disclosure();
  const cohort = { id: "cohort-a", launchId: "launch-a" };
  const conditions = { modelGroups: [{ groupId: "model-group-a", runIds: [...runIds] }] };
  assert.deepEqual(validateCohortDisclosure(value), []);
  assert.doesNotThrow(() => validateDisclosureForPublication({
    disclosure: value,
    cohort,
    conditions,
    measurementConditionsSha256: hex("c"),
    officialRepeatCount: 3,
  }));
  value.modelGroups[0].runIds = value.modelGroups[0].runIds.slice(0, 2);
  assert.throws(() => validateDisclosureForPublication({
    disclosure: value,
    cohort,
    conditions,
    measurementConditionsSha256: hex("c"),
    officialRepeatCount: 3,
  }), /exactly match|exactly 3/);
});

test("cohort aggregate keeps D01-D10, gates, records, raw metrics, and efficiency separate", () => {
  const records = [record(runIds[0], 2), record(runIds[1], 3), record(runIds[2], 4)];
  const aggregate = buildCohortEvaluationAggregate({
    cohort: { id: "cohort-a", launchId: "launch-a", fairnessFingerprint: hex("f") },
    measurementConditionsSha256: hex("c"),
    disclosureSha256: hex("d"),
    disclosure: disclosure(),
    records,
    generatedAt: "2026-07-29T12:30:00Z",
  });
  assert.deepEqual(validateCohortEvaluationAggregate(aggregate), []);
  const group = aggregate.modelGroups[0];
  assert.equal(group.runCount, 3);
  assert.equal(group.dimensions.length, 10);
  assert.equal(group.dimensions[0].median, 3);
  assert.deepEqual(group.dimensions[0].observedInterval, [2, 4]);
  assert.equal(group.gates[0].passCount, 3);
  assert.equal(group.admission.rate, 1);
  assert.equal(group.qualification.baseline.count, 2);
  assert.equal(group.rawMetrics.separateFromDesignQuality, true);
  assert.equal(group.efficiency.separateFromDesignQuality, true);
  assert.equal(group.compositeScore, null);
  assert.equal(group.compositeScorePublished, false);

  const mismatchedPanel = records.map((entry) => structuredClone(entry));
  mismatchedPanel[2].panel = "change-response";
  assert.throws(() => buildCohortEvaluationAggregate({
    cohort: { id: "cohort-a", launchId: "launch-a", fairnessFingerprint: hex("f") },
    measurementConditionsSha256: hex("c"),
    disclosureSha256: hex("d"),
    disclosure: disclosure(),
    records: mismatchedPanel,
    generatedAt: "2026-07-29T12:30:00Z",
  }), /assessment panel/);
});

test("legacy public evaluation summaries retain scalar coverage without reviewer details", () => {
  const evaluatorRecord = {
    ...record(runIds[0], 3),
    reviewers: [{ raterId: "reviewer-secret", rationale: "private rationale" }],
    reviewPackagePath: "sanitized/review-package",
    finalization: { status: "finalized", finalizedAt: "2026-07-29T13:00:00Z", candidateBundleSha256: hex("b"), candidateSubmissionSha256: hex("c"), pendingRecordSha256: hex("d"), sourceEvaluationSha256: hex("e"), reviewPackagePath: "private-review-package" },
    gates: [{ id: "A0", label: "Admission", result: "pass", checks: [{ raterId: "reviewer-secret", rationale: "private" }] }],
    dimensions: [{ id: "D01", label: "Dimension", attempted: true, evidenceCoverage: 1, evaluable: true, passFail: "scored", score: 3, scoreInterval: [2, 4], failureCause: null, highestVerifiedCheckpoint: "CKPT-040", ratings: [{ raterId: "reviewer-secret", rationale: "private" }] }],
  };
  const summary = publicEvaluationSummary(evaluatorRecord, Buffer.from(JSON.stringify(evaluatorRecord)));
  const published = JSON.stringify(summary);
  assert.deepEqual(validatePublicEvaluationSummary(summary), []);
  assert.doesNotMatch(published, /reviewer-secret|private rationale|reviewPackagePath|reviewAudit|raterId|ratings|rationale/);
  assert.equal(summary.evaluationRecordSha256.length, 64);
  assert.equal(summary.gates[0].result, "pass");
  assert.equal(summary.dimensions[0].score, 3);
  assert.equal(summary.dimensions[0].evidenceCoverage, 1);
  assert.equal(summary.dimensions[0].passFail, "scored");
  assert.equal(summary.dimensions[0].failureCause, null);
});

test("v1.10 public evaluation summaries project only consensus evidence coverage", () => {
  const evaluatorRecord = {
    ...record(runIds[0], 3),
    reviewPackagePath: "private-review-package",
    dimensions: [{
      id: "D01",
      label: "Dimension",
      attempted: true,
      evidenceCoverage: {
        required: 3,
        covered: 1,
        missing: 1,
        uncertain: 1,
        ratio: 1 / 3,
        criteria: [
          { id: "D01-E01", criterion: "private criterion text", consensusStatus: "covered" },
          { id: "D01-E02", criterion: "private criterion text", consensusStatus: "missing" },
          { id: "D01-E03", criterion: "private criterion text", consensusStatus: "uncertain" },
        ],
        reviewerObservations: [{
          raterId: "reviewer-secret",
          covered: ["D01-E01"],
          missing: ["D01-E02"],
          uncertain: ["D01-E03"],
          rationale: "private rationale",
          path: "private-evidence-path",
        }],
      },
      evaluable: true,
      ratingStatus: "scored",
      score: 3,
      scoreInterval: [2, 4],
      nonEvaluationCause: null,
      highestVerifiedCheckpoint: "CKPT-040",
      ratings: [{
        raterId: "reviewer-secret",
        rationale: "private rationale",
        evidenceRefs: ["private-evidence-path"],
      }],
    }],
  };
  const summary = publicEvaluationSummary(evaluatorRecord, Buffer.from(JSON.stringify(evaluatorRecord)));
  const coverage = summary.dimensions[0].evidenceCoverage;
  const published = JSON.stringify(summary);

  assert.deepEqual(validatePublicEvaluationSummary(summary), []);
  assert.deepEqual(coverage, {
    required: 3,
    covered: 1,
    missing: 1,
    uncertain: 1,
    ratio: 1 / 3,
    criterionConsensus: {
      "D01-E01": "covered",
      "D01-E02": "missing",
      "D01-E03": "uncertain",
    },
  });
  assert.equal(Object.hasOwn(summary.dimensions[0], "passFail"), false);
  assert.equal(Object.hasOwn(summary.dimensions[0], "failureCause"), false);
  assert.equal(Object.hasOwn(coverage, "criteria"), false);
  assert.equal(Object.hasOwn(coverage, "reviewerObservations"), false);
  assert.doesNotMatch(published, /reviewer-secret|private rationale|private-evidence-path|private criterion text|raterId|ratings|rationale|reviewPackagePath|reviewAudit/);
});
