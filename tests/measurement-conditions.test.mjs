import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { validateMeasurementConditions } from "../scripts/framework-lib.mjs";

async function json(relative) {
  return JSON.parse(await readFile(new URL(relative, import.meta.url), "utf8"));
}

test("cohort measurement conditions freeze comparable run resources", async () => {
  const [schema, artifactSchema] = await Promise.all([
    json("../schemas/measurement-conditions.schema.json"),
    json("../schemas/artifact.schema.json"),
  ]);
  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  ajv.addSchema(artifactSchema);
  const validate = ajv.compile(schema);
  const conditions = {
    schemaVersion: "1.0",
    frozenAt: "2026-07-29T00:00:00Z",
    launchId: "engineering-launch-v1",
    launchDigest: "1".repeat(64),
    fairnessFingerprint: "2".repeat(64),
    executionProfileDigest: "3".repeat(64),
    candidateRunIds: [
      "opaque-a-01",
      "opaque-a-02",
      "opaque-a-03",
      "opaque-b-01",
      "opaque-b-02",
      "opaque-b-03",
    ],
    modelGroups: [
      {
        groupId: "opaque-model-group-a",
        runIds: ["opaque-a-01", "opaque-a-02", "opaque-a-03"],
      },
      {
        groupId: "opaque-model-group-b",
        runIds: ["opaque-b-01", "opaque-b-02", "opaque-b-03"],
      },
    ],
    runConditions: {
      elapsedTimeLimitMinutes: 480,
      tokenBudget: { mode: "exact-limit", maximumTokens: 1000000 },
      reasoningPreset: "common-high",
      toolAccessProfile: "common-cad-shell-browser-v1",
      networkPolicy: "public-research-allowed",
      randomnessPolicy: "provider-default-recorded",
      humanInterventionLimit: 0,
    },
    repetitionPolicy: {
      runsPerModel: 3,
      assignmentRecordedOutsideCandidate: true,
    },
  };
  assert.equal(validate(conditions), true, JSON.stringify(validate.errors));
  assert.deepEqual(validateMeasurementConditions(conditions), []);
  conditions.modelGroups[1].runIds = [
    "opaque-b-01",
    "opaque-b-02",
    "opaque-a-03",
  ];
  assert.match(
    validateMeasurementConditions(conditions)
      .map(({ code }) => code)
      .join(","),
    /measurement-run-assigned-twice|measurement-run-group-coverage/,
  );
  conditions.modelGroups[1].runIds = [
    "opaque-b-01",
    "opaque-b-02",
    "opaque-b-03",
  ];
  conditions.runConditions.humanInterventionLimit = 1;
  assert.equal(validate(conditions), false);
});
