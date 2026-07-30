import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { sha256 } from "../scripts/framework-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function json(relativePath) {
  return JSON.parse(await readFile(path.join(repositoryRoot, relativePath), "utf8"));
}

async function bytes(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath));
}

test("v1.10 draft binds the public 1.2 scoring contract and its commitments", async () => {
  const scoringRelative = "evaluation/integrated-robotic-handling-v1.10/scoring-contract.json";
  const [
    task,
    commitments,
    scoringBytes,
    draftScoringBytes,
    publicScoringBytes,
    commitmentBytes,
    commonEvaluationMethodBytes,
    scoring,
  ] = await Promise.all([
    json("stage0-drafts/integrated-robotic-handling-v1.10/task.json"),
    json("stage0-drafts/integrated-robotic-handling-v1.10/inputs/evaluation-commitments.json"),
    bytes(scoringRelative),
    bytes("stage0-drafts/integrated-robotic-handling-v1.10/inputs/scoring-contract.json"),
    bytes("public/framework/evaluation/integrated-robotic-handling-v1.10/scoring-contract.json"),
    bytes("stage0-drafts/integrated-robotic-handling-v1.10/inputs/evaluation-commitments.json"),
    bytes("stage0-drafts/integrated-robotic-handling-v1.10/inputs/common-evaluation-method.json"),
    json(scoringRelative),
  ]);
  const scoringDigest = sha256(scoringBytes);
  const commitmentDigest = sha256(commitmentBytes);
  const commonEvaluationMethodDigest = sha256(commonEvaluationMethodBytes);

  assert.deepEqual(draftScoringBytes, scoringBytes);
  assert.deepEqual(publicScoringBytes, scoringBytes);
  assert.equal(task.version, "1.10");
  assert.equal(task.v4Contract.scoringVersion, "1.2");
  assert.equal(task.extensions.scoringContract.version, "1.2");
  assert.equal(task.extensions.scoringContract.canonicalAuthoringSource, scoringRelative);
  assert.equal(task.extensions.scoringContract.canonicalDigest, scoringDigest);
  assert.equal(task.v4Contract.evaluationContract.digest, scoringDigest);
  assert.equal(commitments.evaluationContract.id, "integrated-robotic-handling-v1.10-scoring");
  assert.equal(commitments.evaluationContract.authoringSource, scoringRelative);
  assert.equal(commitments.evaluationContract.scoringVersion, "1.2");
  assert.match(commitments.scoring.weightPolicy, /v1\.2 scoring contract/);
  assert.equal(task.v4Contract.visibilityPolicy.digest, commitmentDigest);
  assert.equal(
    task.v4Contract.sealedAssetCommitments.find(
      ({ id }) => id === "COMMON-EVALUATION-METHOD",
    ).digest,
    commonEvaluationMethodDigest,
  );
  assert.match(
    commonEvaluationMethodBytes.toString("utf8"),
    /ordinal design-quality ratings, which have no pass\/fail threshold/,
  );
  assert.match(scoring.qualificationRules.baselineQualified, /A0 admission passes/);
  assert.match(scoring.qualificationRules.changeQualified, /CKPT-050/);
  assert.deepEqual(scoring.panelGateApplicability["change-response"], ["B1", "B2", "B3", "B4", "B5", "B6"]);
  assert.equal(
    scoring.dimensions.find(({ id }) => id === "D09").panelApplicability["fixed-anchor-baseline"].mode,
    "change-readiness",
  );
  assert.equal(
    scoring.dimensions.find(({ id }) => id === "D09").panelApplicability["change-response"].mode,
    "actual-change-response",
  );
  for (const dimension of scoring.dimensions) {
    if (dimension.id === "D09") {
      assert.equal(
        dimension.panelOperationalAnchors["fixed-anchor-baseline"].anchors.length,
        5,
      );
      assert.equal(
        dimension.panelOperationalAnchors["change-response"].anchors.length,
        5,
      );
      assert.notDeepEqual(
        dimension.panelOperationalAnchors["fixed-anchor-baseline"].anchors,
        dimension.panelOperationalAnchors["change-response"].anchors,
      );
      assert.equal(dimension.panelRequiredEvidence["fixed-anchor-baseline"].length, 2);
      assert.equal(dimension.panelRequiredEvidence["change-response"].length, 3);
    } else {
      assert.equal(dimension.operationalAnchors.length, 5, `${dimension.id} needs 0–4 anchors`);
    }
    assert.ok(dimension.requiredEvidence.length > 0, `${dimension.id} needs required evidence`);
    assert.ok(
      dimension.requiredEvidence.every(({ id, criterion }) =>
        new RegExp(`^${dimension.id}-E[0-9]{2}$`).test(id)
        && typeof criterion === "string"
        && criterion.length > 0),
      `${dimension.id} needs clause-addressable required evidence`,
    );
    assert.ok(dimension.failConditions.length > 0, `${dimension.id} needs fail conditions`);
    assert.ok(dimension.notEvaluableConditions.length > 0, `${dimension.id} needs not-evaluable conditions`);
  }
  assert.equal(scoring.ratingScale.passFailThreshold, null);
  assert.deepEqual(scoring.attainmentProfile.ratingStatuses, ["scored", "not-evaluable"]);
  assert.ok(scoring.attainmentProfile.nonEvaluationCauses.includes("incomplete-checkpoint"));
  assert.equal(Object.hasOwn(scoring.attainmentProfile, "failureCauses"), false);
  assert.match(scoring.reviewProtocol.frozenReviewInstruction, /omit dimensions/i);
  assert.match(scoring.reviewProtocol.frozenReviewInstruction, /panel-specific required-evidence criterion/i);
  assert.match(scoring.reviewProtocol.frozenReviewInstruction, /D09 fixed-anchor-baseline use change-readiness anchors only/);
});

test("v2 execution profile changes only the bootstrap binding from v1", async () => {
  const [v1, v2, bootstrapBytes] = await Promise.all([
    json("execution-profiles/integrated-robotic-handling-v1/profile.json"),
    json("execution-profiles/integrated-robotic-handling-v2/profile.json"),
    bytes("workspace-bootstrap/integrated-robotic-handling-v2.json"),
  ]);
  const expected = structuredClone(v1);
  expected.version = "1.1";
  expected.workspaceBootstrap = {
    kind: "public-bundle",
    location: "https://naoyamd.github.io/rotorbench/framework/workspaces/integrated-robotic-handling-v2.json",
    sha256: sha256(bootstrapBytes),
  };
  assert.deepEqual(v2, expected);
});

test("v1.10 output contract seals the exact change event and complete final baseline", async () => {
  const [task, outputContractBytes, outputContract] = await Promise.all([
    json("stage0-drafts/integrated-robotic-handling-v1.10/task.json"),
    bytes("stage0-drafts/integrated-robotic-handling-v1.10/inputs/output-contract.json"),
    json("stage0-drafts/integrated-robotic-handling-v1.10/inputs/output-contract.json"),
  ]);
  const impactPath = outputContract.conditionalChangeResponse.impactArtifact;
  const expectedBaselinePaths = outputContract.artefacts
    .map(({ path: artefactPath }) => artefactPath)
    .filter((artefactPath) => artefactPath !== impactPath)
    .sort();
  const checkpoint040 = outputContract.candidateCheckpoints.find(({ id }) => id === "CKPT-040");
  const checkpoint020 = outputContract.candidateCheckpoints.find(({ id }) => id === "CKPT-020");
  const checkpoint030 = outputContract.candidateCheckpoints.find(({ id }) => id === "CKPT-030");

  assert.equal(outputContract.version, "1.9");
  assert.equal(task.version, "1.10");
  assert.equal(task.v4Contract.checkpointContract.digest, sha256(outputContractBytes));
  assert.equal(outputContract.conditionalChangeResponse.changeEventId, "CHG-001");
  assert.equal(
    task.changeEvents.find(({ id }) => id === "CHG-001").responseCheckpointId,
    outputContract.conditionalChangeResponse.triggerCheckpoint,
  );
  assert.deepEqual([...checkpoint040.requiredArtefacts].sort(), expectedBaselinePaths);
  assert.ok(checkpoint020.requiredArtefacts.includes("artifacts/cad/source-manifest.json"));
  assert.ok(checkpoint030.requiredArtefacts.includes("artifacts/drawings/critical-drawing-index.csv"));
  assert.ok(checkpoint040.requiredArtefacts.includes("artifacts/cad/source-manifest.json"));
  assert.ok(checkpoint040.requiredArtefacts.includes("artifacts/drawings/critical-drawing-index.csv"));
  assert.match(outputContract.snapshotHandoffRule.workingFiles, /working paths/i);
  assert.match(outputContract.snapshotHandoffRule.indexedReferences, /every file referenced/i);
  assert.match(outputContract.snapshotHandoffRule.currentBytes, /byte-identical/i);
});
