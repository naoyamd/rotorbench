import assert from "node:assert/strict";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  canonicalInputDigest,
  validateNeutralHandoff,
} from "../stage0-drafts/integrated-robotic-handling-v1.7/inputs/neutral-handoff-validator.mjs";

const root = path.resolve("stage0-drafts/integrated-robotic-handling-v1.7");
const contract = JSON.parse(await readFile(path.join(root, "inputs/neutral-handoff-contract.json"), "utf8"));
const commonMethod = JSON.parse(await readFile(path.join(root, "inputs/common-evaluation-method.json"), "utf8"));
const inputDigest = canonicalInputDigest(commonMethod.canonicalInputByteSet);

function fixture() {
  const targetById = new Map(contract.kinematics.requiredPoseTargets.map((target) => [target.id, target]));
  const cases = contract.kinematics.requiredPayloadCases;
  const poses = contract.kinematics.requiredPoseTargets.map(({ id }) => id);
  const results = cases.flatMap((payloadCase) => poses.map((poseId) => ({
    id: `${payloadCase.id}-${poseId}`,
    poseId,
    payloadCaseId: payloadCase.id,
    payloadStateId: payloadCase.payloadStateId,
    targetPosition: targetById.get(poseId).position,
    targetToolAxis: targetById.get(poseId).toolAxis,
    jointValues: [{ jointId: "J1", unit: "deg", value: 0 }],
  })));
  const segments = cases.flatMap((payloadCase) => poses.slice(1).map((toPoseId, index) => ({
    id: `${payloadCase.id}-S${index + 1}`,
    payloadCaseId: payloadCase.id,
    payloadStateId: payloadCase.payloadStateId,
    sequence: index + 1,
    fromPoseId: poses[index],
    toPoseId,
    durationSeconds: 1,
  })));
  const caseIds = cases.map(({ id }) => id);
  return {
    contractId: contract.contractId,
    units: contract.kinematics.units,
    coordinateFrames: [
      { id: "W", parentFrameId: null },
      {
        id: "TCP",
        parentFrameId: "W",
        translationMm: [0, 0, 0],
        rotationMatrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
      },
    ],
    jointTopology: [{
      id: "J1",
      kind: "revolute",
      unit: "deg",
      parentFrameId: "W",
      childFrameId: "TCP",
      axis: [0, 0, 1],
    }],
    jointLimits: [{ jointId: "J1", unit: "deg", minimum: -180, maximum: 180 }],
    tcpTransform: {
      frameId: "TCP",
      translationMm: [0, 0, 0],
      rotationMatrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
    },
    payloadStates: contract.kinematics.requiredPayloadStates,
    requiredPoseResults: results,
    trajectory: {
      segments,
      cycleSummaries: cases.map((payloadCase) => ({
        payloadCaseId: payloadCase.id,
        declaredCycleSeconds: 7,
      })),
    },
    geometryReferences: contract.kinematics.requiredGeometryReferenceIds.map((id) => ({ id })),
    repeatabilityBudget: {
      components: [{ id: "encoder", unit: "mm", valueMm: 0.1 }],
      rssMm: 0.1,
    },
    evaluationEvidence: {
      methodId: commonMethod.methodId,
      motion: {
        id: "motion",
        method: "static-kinematic-allocation",
        inputDigest,
        segmentIds: segments.map(({ id }) => id),
        payloadCaseIds: caseIds,
        reportedCycleSeconds: 21,
        driveLimitEvidence: { source: "candidate static drive table" },
      },
      collision: {
        id: "collision",
        method: "declared-swept-volume-sampling",
        inputDigest,
        poseIds: poses,
        payloadCaseIds: caseIds,
        geometryReferenceIds: contract.kinematics.requiredGeometryReferenceIds,
        selfCollisionResult: "evaluator-uncertain",
        cellCollisionResult: "evaluator-uncertain",
        minimumClearanceMm: 0,
        modelScope: "Static neutral geometry and declared sampled poses only.",
      },
      accuracy: {
        id: "accuracy",
        method: "static-error-budget",
        inputDigest,
        poseIds: poses,
        payloadCaseIds: caseIds,
        foundationReference: "FND-ANCH-001",
        errorSources: [
          "backlash",
          "encoder-feedback",
          "compliance",
          "thermal",
          "assembly-datum",
          "calibration",
        ],
        reportedRssMm: 0.1,
        thermalState: "Declared steady-state design condition.",
        calibrationRange: "No physical calibration claimed in this static record.",
      },
    },
  };
}

async function validate(value, benchmarkRoot = root) {
  const candidate = await mkdtemp(path.join(tmpdir(), "neutral-v17-"));
  try {
    await mkdir(path.join(candidate, "artifacts/cad"), { recursive: true });
    await mkdir(path.join(candidate, "artifacts/motion"), { recursive: true });
    await writeFile(path.join(candidate, "artifacts/cad/assembly.step"), "ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));\nENDSEC;\nDATA;\n#1=PRODUCT('x','x','',());\nENDSEC;\nEND-ISO-10303-21;\n");
    await writeFile(path.join(candidate, "artifacts/motion/kinematics.json"), JSON.stringify(value));
    return await validateNeutralHandoff({ candidateRoot: candidate, contract, benchmarkRoot });
  } finally {
    await rm(candidate, { recursive: true, force: true });
  }
}

test("v1.7 static handoff accepts complete linked pose/payload evidence bound to canonical input bytes", async () => {
  assert.equal(inputDigest, commonMethod.canonicalInputByteSet.expectedInputDigest);
  assert.equal((await validate(fixture())).status, "valid");
});

test("v1.7 static handoff rejects zero and non-unit non-fixed joint axes", async () => {
  const zeroAxis = fixture();
  zeroAxis.jointTopology[0].axis = [0, 0, 0];
  assert.equal((await validate(zeroAxis)).status, "invalid");
  const nonUnitAxis = fixture();
  nonUnitAxis.jointTopology[0].axis = [0, 0, 2];
  assert.equal((await validate(nonUnitAxis)).status, "invalid");
});

test("v1.7 static handoff rejects a topology edge that contradicts its frame tree", async () => {
  const contradiction = fixture();
  contradiction.coordinateFrames = [
    { id: "W", parentFrameId: null },
    { id: "LINK", parentFrameId: "W", translationMm: [0, 0, 0], rotationMatrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
    { id: "TCP", parentFrameId: "LINK", translationMm: [0, 0, 0], rotationMatrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]] },
  ];
  contradiction.jointTopology = [
    { id: "J0", kind: "fixed", unit: "none", parentFrameId: "W", childFrameId: "LINK" },
    { id: "J1", kind: "revolute", unit: "deg", parentFrameId: "W", childFrameId: "TCP", axis: [0, 0, 1] },
  ];
  assert.equal((await validate(contradiction)).status, "invalid");
});

test("v1.7 static handoff rejects omitted evidence result fields and duplicate or substituted coverage IDs", async () => {
  const omitted = fixture();
  delete omitted.evaluationEvidence.collision.modelScope;
  assert.equal((await validate(omitted)).status, "invalid");
  const duplicated = fixture();
  duplicated.evaluationEvidence.motion.segmentIds[1] = duplicated.evaluationEvidence.motion.segmentIds[0];
  assert.equal((await validate(duplicated)).status, "invalid");
  const substituted = fixture();
  substituted.evaluationEvidence.collision.geometryReferenceIds[1] = substituted.evaluationEvidence.collision.geometryReferenceIds[0];
  assert.equal((await validate(substituted)).status, "invalid");
});

test("v1.7 static handoff rejects evidence whose digest is not bound to the published input-byte set", async () => {
  const unbound = fixture();
  unbound.evaluationEvidence.accuracy.inputDigest = "a".repeat(64);
  assert.equal((await validate(unbound)).status, "invalid");
});

test("v1.7 static handoff rejects stale or substituted canonical packet input bytes and digests", async () => {
  const isolated = await mkdtemp(path.join(tmpdir(), "neutral-v17-packet-"));
  try {
    const staleBytesRoot = path.join(isolated, "stale-bytes");
    await cp(root, staleBytesRoot, { recursive: true });
    const fixedGeometry = path.join(staleBytesRoot, "inputs/fixed-geometry.json");
    await writeFile(fixedGeometry, `${await readFile(fixedGeometry, "utf8")}\n`);
    const staleBytesReport = await validate(fixture(), staleBytesRoot);
    assert.equal(staleBytesReport.status, "invalid");
    assert.equal(
      staleBytesReport.checks.find((check) => check.id === "COMMON-EVIDENCE-COVERAGE")?.result,
      "fail",
    );

    const substitutedDigestRoot = path.join(isolated, "substituted-digest");
    await cp(root, substitutedDigestRoot, { recursive: true });
    const methodPath = path.join(substitutedDigestRoot, "inputs/common-evaluation-method.json");
    const method = JSON.parse(await readFile(methodPath, "utf8"));
    method.canonicalInputByteSet.records[0].sha256 = "a".repeat(64);
    await writeFile(methodPath, `${JSON.stringify(method, null, 2)}\n`);
    const substitutedDigestReport = await validate(fixture(), substitutedDigestRoot);
    assert.equal(substitutedDigestReport.status, "invalid");
    assert.equal(
      substitutedDigestReport.checks.find((check) => check.id === "COMMON-EVIDENCE-COVERAGE")?.result,
      "fail",
    );
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});
