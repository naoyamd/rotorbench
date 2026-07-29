import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { aggregateEngineeringEvaluations } from "../scripts/aggregate-engineering-benchmark.mjs";
import { loadFrozenContractValidators } from "../scripts/frozen-contract.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const contractUrl = new URL(
  "../evaluation/integrated-robotic-handling-v1/scoring-contract.json",
  import.meta.url,
);
const assessmentSchemaUrl = new URL(
  "../evaluation/integrated-robotic-handling-v1/assessment.schema.json",
  import.meta.url,
);
const assessmentTemplateUrl = new URL(
  "../evaluation/integrated-robotic-handling-v1/assessment-template.json",
  import.meta.url,
);
const evaluationRecordSchemaUrl = new URL(
  "../schemas/evaluation-record.schema.json",
  import.meta.url,
);
const stageV4SchemaUrl = new URL(
  "../schemas/stage-contract-v4.schema.json",
  import.meta.url,
);
const artifactSchemaUrl = new URL(
  "../schemas/artifact.schema.json",
  import.meta.url,
);

async function json(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

test("engineering scoring contract is vector-valued and longitudinally stable", async () => {
  const contract = await json(contractUrl);
  assert.equal(contract.schemaVersion, "4.0");
  assert.equal(contract.dimensions.length, 10);
  assert.equal(contract.baselineGates.length, 7);
  assert.equal(contract.checkpoints.length, 6);
  assert.equal(contract.compositeScore.published, false);
  assert.equal(contract.longitudinalRules.primaryPanel, "fixed-anchor-baseline");
  assert.equal(contract.longitudinalRules.contractFreezeMonths, 12);
  assert.equal(contract.efficiencyRecord.separateFromDesignQuality, true);
  assert.equal(contract.qualificationRules.changeFailureDoesNotEraseBaseline, true);
});

test("assessment template satisfies its public schema", async () => {
  const [schema, template] = await Promise.all([
    json(assessmentSchemaUrl),
    json(assessmentTemplateUrl),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  assert.equal(validate(template), true, JSON.stringify(validate.errors));
});

test("frozen scoring runtime validates the exact task assessment schema", async () => {
  const [template] = await Promise.all([json(assessmentTemplateUrl)]);
  const validators = await loadFrozenContractValidators(repositoryRoot, {
    assessmentSchemaPath: fileURLToPath(assessmentSchemaUrl),
  });
  assert.equal(typeof validators.validateAssessment, "function");
  assert.deepEqual(validators.validateAssessment(template), []);
  assert.ok(
    validators.validateAssessment({
      ...template,
      scoringContract: { ...template.scoringContract, version: "1.0" },
    }).some(({ code }) => code === "schema-const"),
  );
});

function evaluationRecord({
  bundle,
  d01,
  qualified,
  checkpoint,
}) {
  return {
    schemaVersion: "4.0",
    runId: `candidate-${bundle}`,
    evaluationContractDigest: "a".repeat(64),
    scoringVersion: "1.0",
    benchmarkId: "integrated-robotic-handling",
    scoringContract: {
      id: "integrated-robotic-handling-scoring",
      version: "1.0",
      sha256: "a".repeat(64),
    },
    panel: "fixed-anchor-baseline",
    launchId: "integrated-robotic-handling-v1",
    fairnessFingerprint: "b".repeat(64),
    candidateBundleSha256: bundle.repeat(64),
    evaluatedAt: "2026-07-29T00:00:00Z",
    status: "admitted",
    admissionIssues: [],
    qualification: {
      baselineQualified: qualified,
      changeQualified: null,
      changeFailureDoesNotEraseBaseline: true,
    },
    gates: [
      { id: "A0", label: "Admission", result: "pass", checks: [] },
      {
        id: "B1",
        label: "Geometry",
        result: qualified ? "pass" : "fail",
        checks: [],
      },
    ],
    outputCoverage: {
      required: 1,
      covered: 1,
      ratio: 1,
      missingOutputRefs: [],
    },
    attainment: {
      highestVerifiedCheckpoint: checkpoint,
      verifiedCheckpointRefs: [checkpoint],
    },
    dimensions: [
      {
        id: "D01",
        label: "Requirements",
        attempted: true,
        evidenceCoverage: 2,
        evaluable: true,
        passFail: "scored",
        score: d01,
        scoreInterval: [d01, d01],
        failureCause: null,
        highestVerifiedCheckpoint: checkpoint,
        ratings: [],
      },
    ],
    rawMetrics: [],
    compositeScore: null,
    compositeScorePublished: false,
    efficiency: {
      separateFromDesignQuality: true,
      values: { wallClockDuration: 100 },
    },
    reviewAudit: {
      reviewPackage: {
        id: "review-1111111111111111",
        path: "sanitized/review-package/review-package.json",
        sha256: "c".repeat(64),
      },
      records: [
        {
          path: "sanitized/reviews/rater-1111111111111111.json",
          sha256: "d".repeat(64),
          reviewerId: "rater-1111111111111111",
          role: "primary",
        },
        {
          path: "sanitized/reviews/rater-2222222222222222.json",
          sha256: "e".repeat(64),
          reviewerId: "rater-2222222222222222",
          role: "secondary",
        },
      ],
    },
  };
}

test("rich evaluator record satisfies the framework binding schema", async () => {
  const [schema, stageV4, artifact] = await Promise.all([
    json(evaluationRecordSchemaUrl),
    json(stageV4SchemaUrl),
    json(artifactSchemaUrl),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  addFormats(ajv);
  ajv.addSchema(artifact);
  ajv.addSchema(stageV4);
  const validate = ajv.compile(schema);
  const record = evaluationRecord({
    bundle: "e",
    d01: 3,
    qualified: true,
    checkpoint: "CKPT-040",
  });
  assert.equal(validate(record), true, JSON.stringify(validate.errors));
});

test("longitudinal aggregation preserves vector, gates, and separate efficiency", () => {
  const aggregate = aggregateEngineeringEvaluations([
    evaluationRecord({
      bundle: "c",
      d01: 2,
      qualified: false,
      checkpoint: "CKPT-030",
    }),
    evaluationRecord({
      bundle: "d",
      d01: 4,
      qualified: true,
      checkpoint: "CKPT-040",
    }),
  ]);
  assert.equal(aggregate.runCount, 2);
  assert.equal(aggregate.baselineQualifiedCount, 1);
  assert.equal(aggregate.dimensions[0].median, 3);
  assert.deepEqual(aggregate.dimensions[0].observedInterval, [2, 4]);
  assert.equal(aggregate.compositeScore, null);
  assert.equal(aggregate.efficiency.separateFromDesignQuality, true);
});
