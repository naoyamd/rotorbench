import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  assessmentSchemaRelativePathForScoringVersion,
  evaluateEngineeringSubmission,
} from "../scripts/evaluate-engineering-submission.mjs";
import { loadFrozenContractValidators } from "../scripts/stage-contract.mjs";
import {
  bundleTreeHash,
  manifestDigest,
  sha256,
  validateReviewSubmission,
} from "../scripts/framework-lib.mjs";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const packetRoot = path.join(
  repositoryRoot,
  "task-packets",
  "integrated-robotic-handling",
  "1.8",
);
const scoringPath = path.join(
  repositoryRoot,
  "evaluation",
  "integrated-robotic-handling-v1",
  "scoring-contract.json",
);

test("assessment schema selection is frozen to scoring version 1.1 or 1.2", async () => {
  const v11Relative = assessmentSchemaRelativePathForScoringVersion("1.1");
  const v12Relative = assessmentSchemaRelativePathForScoringVersion("1.2");
  assert.equal(
    v11Relative,
    "evaluation/integrated-robotic-handling-v1/assessment.schema.json",
  );
  assert.equal(
    v12Relative,
    "evaluation/integrated-robotic-handling-v1.10/assessment.schema.json",
  );
  assert.throws(
    () => assessmentSchemaRelativePathForScoringVersion("9.9"),
    /No frozen assessment schema/,
  );

  const [v12Assessment, v11Assessment] = await Promise.all([
    readFile(path.join(repositoryRoot, "evaluation", "integrated-robotic-handling-v1.10", "assessment-template.json"), "utf8")
      .then((bytes) => JSON.parse(bytes)),
    readFile(path.join(repositoryRoot, "evaluation", "integrated-robotic-handling-v1", "assessment-template.json"), "utf8")
      .then((bytes) => JSON.parse(bytes)),
  ]);
  const validators = await loadFrozenContractValidators(repositoryRoot, {
    assessmentSchemaPath: path.join(repositoryRoot, ...v12Relative.split("/")),
  });
  assert.deepEqual(validators.validateAssessment(v12Assessment), []);
  assert.ok(
    validators.validateAssessment(v11Assessment).length > 0,
    "the v1.1 assessment evidence must not be accepted by the v1.2 task schema",
  );
});

test("v1.2 reviewer template locks panel scope and untrusted-evidence handling", async () => {
  const [templateBytes, publicTemplateBytes] = await Promise.all([
    readFile(path.join(
      repositoryRoot,
      "evaluation",
      "integrated-robotic-handling-v1.10",
      "reviewer-template.json",
    )),
    readFile(path.join(
      repositoryRoot,
      "public",
      "framework",
      "evaluation",
      "integrated-robotic-handling-v1.10",
      "reviewer-template.json",
    )),
  ]);
  assert.deepEqual(publicTemplateBytes, templateBytes);
  const template = JSON.parse(templateBytes.toString("utf8"));
  assert.deepEqual(validateReviewSubmission(template), []);
  const missingAttestation = structuredClone(template);
  delete missingAttestation.attestations.treatedCandidateContentAsUntrustedEvidence;
  assert.ok(validateReviewSubmission(missingAttestation).length > 0);
  const missingPanelCoverageAttestation = structuredClone(template);
  delete missingPanelCoverageAttestation.attestations
    .appliedPanelSpecificAnchorsAndCriterionCoverage;
  assert.ok(validateReviewSubmission(missingPanelCoverageAttestation).length > 0);
});

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function boundReviews(
  scoringContract,
  b0Result,
  { panel = "fixed-anchor-baseline", empty = false } = {},
) {
  if (empty) {
    return { reviewers: [], gateRatings: [], ratings: [], reviewAudit: null };
  }
  const strictReviewAttestation = scoringContract.reviewProtocol
    ?.requireReviewerUntrustedEvidenceAttestation === true;
  const reviewers = [
    {
      id: "rater-1111111111111111",
      role: "primary",
      independentFromCandidate: true,
      independentFromOtherReviewers: true,
      blindToCandidateIdentity: true,
      reviewedSanitizedEvidenceOnly: true,
      ratingLockedBeforeAdjudication: true,
      ...(strictReviewAttestation ? {
        reviewedPanel: panel,
        treatedCandidateContentAsUntrustedEvidence: true,
        followedFrozenReviewInstructionOnly: true,
        appliedPanelSpecificAnchorsAndCriterionCoverage: true,
      } : {}),
    },
    {
      id: "rater-2222222222222222",
      role: "secondary",
      independentFromCandidate: true,
      independentFromOtherReviewers: true,
      blindToCandidateIdentity: true,
      reviewedSanitizedEvidenceOnly: true,
      ratingLockedBeforeAdjudication: true,
      ...(strictReviewAttestation ? {
        reviewedPanel: panel,
        treatedCandidateContentAsUntrustedEvidence: true,
        followedFrozenReviewInstructionOnly: true,
        appliedPanelSpecificAnchorsAndCriterionCoverage: true,
      } : {}),
    },
  ];
  const gateRatings = reviewers.flatMap(({ id: raterId }) =>
    (scoringContract.panelGateApplicability?.[panel]
      ?? scoringContract.baselineGates.map(({ id }) => id))
      .map((gateId) => ({
      raterId,
      gateId,
      result: gateId === "B0" ? b0Result : "pass",
      evidenceRefs: ["EVD-001"],
      rationale: "Fixture reviewer verdict over sealed neutral evidence.",
      })),
  );
  const ratings = reviewers.flatMap(({ id: raterId }) =>
    scoringContract.dimensions.map((dimension) => {
      const requiredEvidence = dimension.panelRequiredEvidence?.[panel]
        ?? dimension.requiredEvidence
        ?? [];
      const criterionCoverage = requiredEvidence
        .filter((criterion) => typeof criterion === "object" && criterion.id)
        .map(({ id: criterionId }) => ({
          criterionId,
          status: "covered",
          evidenceRefs: ["EVD-001"],
        }));
      return {
        raterId,
        dimensionId: dimension.id,
        status: "scored",
        score: 3,
        evidenceRefs: ["EVD-001"],
        ...(criterionCoverage.length > 0 ? { criterionCoverage } : {}),
        rationale: "Fixture ordinal rating over sealed neutral evidence.",
      };
    }),
  );
  return {
    reviewers,
    gateRatings,
    ratings,
    reviewAudit: {
      reviewPackage: {
        id: "review-1111111111111111",
        path: "sanitized/review-package/review-package.json",
        sha256: "a".repeat(64),
      },
      records: reviewers.map(({ id, role }, index) => ({
        path: `sanitized/reviews/${id}.json`,
        sha256: String(index + 1).repeat(64),
        reviewerId: id,
        role,
      })),
    },
  };
}

async function candidateFixture({
  launch,
  status,
  completedCheckpointIds,
  attemptedCheckpointIds = completedCheckpointIds,
}) {
  const parent = await mkdtemp(path.join(
    os.tmpdir(),
    "evaluator-qualification-",
  ));
  const candidateRoot = path.join(parent, "candidate-output");
  await mkdir(path.join(candidateRoot, "receipts"), { recursive: true });

  const plan = {
    schemaVersion: "1.0",
    status: "initial",
    requirements: [],
    assumptions: [],
    steps: [],
    alternativesToEvaluate: [],
    verificationPlan: [],
  };
  const workRecord = {
    schemaVersion: "1.0",
    alternatives: [],
    decisions: [],
    planRevisions: [],
    verificationClaims: [],
  };
  await writeJson(path.join(candidateRoot, "plan.json"), plan);
  await writeJson(
    path.join(candidateRoot, "work-record.json"),
    workRecord,
  );
  const planBytes = await readFile(path.join(candidateRoot, "plan.json"));
  const workRecordBytes = await readFile(
    path.join(candidateRoot, "work-record.json"),
  );
  await writeFile(
    path.join(candidateRoot, "initial-plan.sha256"),
    `${sha256(planBytes)}  plan.json`,
  );
  const planCheckpointBytes = await readFile(
    path.join(candidateRoot, "initial-plan.sha256"),
  );

  const checkpointReceipts = [];
  let previousReceiptSha256 = "0".repeat(64);
  for (const [sequence, checkpointId] of completedCheckpointIds.entries()) {
    const id = `RCP-${String(sequence).padStart(3, "0")}`;
    const receiptPath = `receipts/${id}.json`;
    const receipt = {
      schemaVersion: "1.0",
      id,
      sequence,
      checkpointId,
      previousReceiptSha256,
      createdAt: `2026-07-30T00:00:${String(sequence).padStart(2, "0")}Z`,
      ...(checkpointId === "CKPT-050" ? { changeEventId: "CHG-001" } : {}),
      evidence: sequence === 0
        ? [
          { path: "plan.json", sha256: sha256(planBytes) },
          {
            path: "initial-plan.sha256",
            sha256: sha256(planCheckpointBytes),
          },
        ]
        : [],
    };
    await writeJson(path.join(candidateRoot, receiptPath), receipt);
    const receiptBytes = await readFile(path.join(candidateRoot, receiptPath));
    const receiptSha256 = sha256(receiptBytes);
    checkpointReceipts.push({
      id,
      sequence,
      checkpointId,
      path: receiptPath,
      sha256: receiptSha256,
      previousReceiptSha256,
      ...(checkpointId === "CKPT-050" ? { changeEventId: "CHG-001" } : {}),
    });
    previousReceiptSha256 = receiptSha256;
  }

  const submission = {
    schemaVersion: "1.0",
    protocolVersion: "4.0",
    status,
    launchId: launch.id,
    taskPacket: launch.taskPacket,
    executionContractDigest: launch.executionContractDigest,
    promptSha256: launch.promptSha256,
    launchDigest: launch.launchDigest,
    fairnessFingerprint: launch.fairnessFingerprint,
    model: {
      provider: "fixture",
      name: "qualification-fixture",
      version: "1",
    },
    initialPlan: {
      path: "plan.json",
      sha256: sha256(planBytes),
    },
    initialPlanCheckpoint: {
      path: "initial-plan.sha256",
      sha256: sha256(planCheckpointBytes),
    },
    workRecord: {
      path: "work-record.json",
      sha256: sha256(workRecordBytes),
    },
    checkpointReceipts,
    partialAttainment: {
      attemptedCheckpointIds,
      completedCheckpointIds,
      highestVerifiedCheckpointId: completedCheckpointIds.at(-1),
      stoppedReason: status === "complete" ? "completed" : "candidate-stop",
    },
    sanitizationRequest: {
      profileDigest: launch.v4Contract.sanitizationProfile.digest,
    },
    v4Contract: launch.v4Contract,
    artifacts: [],
  };
  await writeJson(path.join(candidateRoot, "submission.json"), submission);
  return {
    parent,
    candidateRoot,
    submission,
    candidateBundleSha256: await bundleTreeHash(candidateRoot),
  };
}

test("baseline qualification requires full baseline attainment and B0-B6 pass", async (t) => {
  const [packet, scoringBytes] = await Promise.all([
    readFile(path.join(packetRoot, "packet.json"), "utf8")
      .then((bytes) => JSON.parse(bytes)),
    readFile(scoringPath),
  ]);
  const scoringContract = JSON.parse(scoringBytes.toString("utf8"));
  const scoringContractDigest = sha256(scoringBytes);
  assert.equal(
    packet.v4Contract.evaluationContract.digest,
    scoringContractDigest,
    "the fixture must exercise the scoring contract frozen by packet v1.8",
  );
  const launch = {
    id: "qualification-fixture-launch",
    protocolVersion: "4.0",
    taskPacket: {
      id: packet.id,
      version: packet.version,
      digest: manifestDigest(packet),
      bundleDigest: "b".repeat(64),
    },
    executionContractDigest: "c".repeat(64),
    promptSha256: "d".repeat(64),
    launchDigest: "e".repeat(64),
    fairnessFingerprint: "f".repeat(64),
    v4Contract: packet.v4Contract,
  };
  const baselineCheckpointIds = packet.checkpoints
    .filter(({ requiredForBaseline }) => requiredForBaseline !== false)
    .map(({ id }) => id);
  const cases = [
    {
      name: "partial CKPT-000 with all reviewer gates passing",
      status: "partial",
      completedCheckpointIds: ["CKPT-000"],
      b0Result: "pass",
      expected: false,
    },
    {
      name: "complete baseline with B0 failing",
      status: "complete",
      completedCheckpointIds: baselineCheckpointIds,
      b0Result: "fail",
      expected: false,
    },
    {
      name: "complete baseline with B0-B6 passing",
      status: "complete",
      completedCheckpointIds: baselineCheckpointIds,
      b0Result: "pass",
      expected: true,
    },
    {
      name: "all baseline checkpoints qualify even when submission status remains partial",
      status: "partial",
      completedCheckpointIds: baselineCheckpointIds,
      b0Result: "pass",
      expected: true,
    },
    {
      name: "complete baseline with A0 admission failing",
      status: "complete",
      completedCheckpointIds: baselineCheckpointIds,
      b0Result: "pass",
      a0Result: "fail",
      expected: false,
      expectedStatus: "artifact-invalid",
    },
  ];
  const contractValidators = {
    validateSubmission: () => [],
    validatePlan: () => [],
    validateWorkRecord: () => [],
  };

  for (const testCase of cases) {
    await t.test(testCase.name, async () => {
      const fixture = await candidateFixture({
        launch,
        status: testCase.status,
        completedCheckpointIds: testCase.completedCheckpointIds,
      });
      try {
        const assessment = {
          schemaVersion: "4.0",
          runId: "candidate-qualification-fixture",
          panel: "fixed-anchor-baseline",
          launchId: launch.id,
          fairnessFingerprint: launch.fairnessFingerprint,
          evaluatedAt: "2026-07-30T01:00:00Z",
          scoringContract: {
            id: scoringContract.id,
            version: scoringContract.version,
            sha256: scoringContractDigest,
          },
          candidateBundleSha256: fixture.candidateBundleSha256,
          sanitization: {
            actor: "evaluator",
            profileDigest: launch.v4Contract.sanitizationProfile.digest,
            status: "passed",
            sanitizedArtifactIds: [],
          },
          checkpointReceipts: fixture.submission.checkpointReceipts.map(
            ({ checkpointId, sha256: receiptSha256 }) => ({
              checkpointId,
              receiptSha256,
              status: "verified",
            }),
          ),
          automaticChecks: [{
            id: "A0-STATIC-ADMISSION",
            gateId: "A0",
            result: testCase.a0Result ?? "pass",
            evidenceRefs: [],
            detail: "Fixture static admission passed.",
          }],
          rawMetrics: [],
          efficiency: {},
        };
        const result = await evaluateEngineeringSubmission({
          candidateRoot: fixture.candidateRoot,
          packetRoot,
          packet,
          launch,
          assessment,
          scoringContract,
          scoringContractDigest,
          contractValidators,
          artifactContractValidator: async () => ({
            status: "valid",
            admissionIssues: [],
            deferred: [],
            coverage: null,
          }),
          boundReviews: boundReviews(
            scoringContract,
            testCase.b0Result,
          ),
        });
        assert.equal(result.status, testCase.expectedStatus ?? "admitted");
        assert.equal(
          result.qualification.baselineQualified,
          testCase.expected,
        );
        assert.equal(
          result.gates.find(({ id }) => id === "B0")?.result,
          testCase.b0Result,
        );
      } finally {
        await rm(fixture.parent, { recursive: true, force: true });
      }
    });
  }
});

test("v1.2 keeps baseline and change qualification separate and scopes D09", async () => {
  const [sourcePacket, scoringBytes] = await Promise.all([
    readFile(path.join(packetRoot, "packet.json"), "utf8")
      .then((bytes) => JSON.parse(bytes)),
    readFile(path.join(
      repositoryRoot,
      "evaluation",
      "integrated-robotic-handling-v1.10",
      "scoring-contract.json",
    )),
  ]);
  const packet = structuredClone(sourcePacket);
  const scoringContract = JSON.parse(scoringBytes.toString("utf8"));
  const scoringContractDigest = sha256(scoringBytes);
  packet.v4Contract = {
    ...packet.v4Contract,
    scoringVersion: "1.2",
    evaluationContract: {
      ...packet.v4Contract.evaluationContract,
      digest: scoringContractDigest,
    },
  };
  const launch = {
    id: "qualification-v12-change-launch",
    protocolVersion: "4.0",
    taskPacket: {
      id: packet.id,
      version: packet.version,
      digest: manifestDigest(packet),
      bundleDigest: "b".repeat(64),
    },
    executionContractDigest: "c".repeat(64),
    promptSha256: "d".repeat(64),
    launchDigest: "e".repeat(64),
    fairnessFingerprint: "f".repeat(64),
    v4Contract: packet.v4Contract,
  };
  const baselineCheckpointIds = packet.checkpoints
    .filter(({ requiredForBaseline }) => requiredForBaseline !== false)
    .map(({ id }) => id);
  const contractValidators = {
    validateSubmission: () => [],
    validatePlan: () => [],
    validateWorkRecord: () => [],
  };
  const fixture = await candidateFixture({
    launch,
    status: "complete",
    completedCheckpointIds: [...baselineCheckpointIds, "CKPT-050"],
  });
  try {
    const assessment = {
      schemaVersion: "4.0",
      runId: "candidate-v12-change-fixture",
      panel: "change-response",
      launchId: launch.id,
      fairnessFingerprint: launch.fairnessFingerprint,
      evaluatedAt: "2026-07-30T01:00:00Z",
      scoringContract: {
        id: scoringContract.id,
        version: scoringContract.version,
        sha256: scoringContractDigest,
      },
      candidateBundleSha256: fixture.candidateBundleSha256,
      sanitization: {
        actor: "evaluator",
        profileDigest: launch.v4Contract.sanitizationProfile.digest,
        status: "passed",
        sanitizedArtifactIds: [],
      },
      reviewContext: {
        panel: "change-response",
        candidateContentHandling: "untrusted-evidence-only",
      },
      checkpointReceipts: fixture.submission.checkpointReceipts.map(
        ({ checkpointId, sha256: receiptSha256 }) => ({
          checkpointId,
          receiptSha256,
          status: "verified",
        }),
      ),
      automaticChecks: [{
        id: "A0-STATIC-ADMISSION",
        gateId: "A0",
        result: "pass",
        evidenceRefs: [],
        detail: "Fixture static admission passed.",
      }],
      rawMetrics: [],
      efficiency: {},
    };
    const changeReviews = boundReviews(scoringContract, "pass", {
      panel: "change-response",
    });
    const secondaryD09 = changeReviews.ratings.find(
      ({ raterId, dimensionId }) =>
        raterId === "rater-2222222222222222" && dimensionId === "D09",
    );
    const secondaryRegressionCoverage = secondaryD09.criterionCoverage.find(
      ({ criterionId }) => criterionId === "D09-E05",
    );
    secondaryRegressionCoverage.status = "missing";
    secondaryRegressionCoverage.evidenceRefs = [];
    const result = await evaluateEngineeringSubmission({
      candidateRoot: fixture.candidateRoot,
      packetRoot,
      packet,
      launch,
      assessment,
      scoringContract,
      scoringContractDigest,
      contractValidators,
      artifactContractValidator: async () => ({
        status: "valid",
        admissionIssues: [],
        deferred: [],
        coverage: null,
      }),
      boundReviews: changeReviews,
    });
    assert.equal(result.qualification.baselineQualified, null);
    assert.equal(
      result.qualification.changeQualified,
      true,
      JSON.stringify({
        qualification: result.qualification,
        admissionIssues: result.admissionIssues,
        gates: result.gates.map(({ id, result: gateResult }) => [id, gateResult]),
      }),
    );
    assert.equal(result.gates.find(({ id }) => id === "B0")?.result, "not-applicable");
    assert.equal(
      result.dimensions.find(({ id }) => id === "D09")?.applicability.mode,
      "actual-change-response",
    );
    const changedD09 = result.dimensions.find(({ id }) => id === "D09");
    assert.equal(changedD09.ratingStatus, "scored");
    assert.equal(changedD09.nonEvaluationCause, null);
    assert.equal(changedD09.evidenceCoverage.required, 3);
    assert.equal(changedD09.evidenceCoverage.covered, 2);
    assert.equal(changedD09.evidenceCoverage.uncertain, 1);
    assert.equal(changedD09.evidenceCoverage.ratio, 2 / 3);
    assert.equal(changedD09.evidenceCoverage.reviewerObservations.length, 2);
    assert.notDeepEqual(
      changedD09.evidenceCoverage.reviewerObservations[0],
      changedD09.evidenceCoverage.reviewerObservations[1],
    );
    assert.equal(Object.hasOwn(changedD09, "passFail"), false);

    const noChangeFixture = await candidateFixture({
      launch,
      status: "complete",
      completedCheckpointIds: baselineCheckpointIds,
    });
    try {
      const noChangeAssessment = {
        ...assessment,
        candidateBundleSha256: noChangeFixture.candidateBundleSha256,
        checkpointReceipts: noChangeFixture.submission.checkpointReceipts.map(
          ({ checkpointId, sha256: receiptSha256 }) => ({
            checkpointId,
            receiptSha256,
            status: "verified",
          }),
        ),
      };
      const noChange = await evaluateEngineeringSubmission({
        candidateRoot: noChangeFixture.candidateRoot,
        packetRoot,
        packet,
        launch,
        assessment: noChangeAssessment,
        scoringContract,
        scoringContractDigest,
        contractValidators,
        artifactContractValidator: async () => ({
          status: "valid",
          admissionIssues: [],
          deferred: [],
          coverage: null,
        }),
        boundReviews: boundReviews(scoringContract, "pass", { empty: true }),
      });
      assert.equal(noChange.qualification.changeQualified, false);
      assert.equal(
        noChange.dimensions.find(({ id }) => id === "D09")?.nonEvaluationCause,
        "not-attempted",
      );
    } finally {
      await rm(noChangeFixture.parent, { recursive: true, force: true });
    }

    const attemptedChangeFixture = await candidateFixture({
      launch,
      status: "partial",
      completedCheckpointIds: baselineCheckpointIds,
      attemptedCheckpointIds: [...baselineCheckpointIds, "CKPT-050"],
    });
    try {
      const attemptedChangeAssessment = {
        ...assessment,
        candidateBundleSha256: attemptedChangeFixture.candidateBundleSha256,
        checkpointReceipts: attemptedChangeFixture.submission.checkpointReceipts.map(
          ({ checkpointId, sha256: receiptSha256 }) => ({
            checkpointId,
            receiptSha256,
            status: "verified",
          }),
        ),
      };
      const attemptedChange = await evaluateEngineeringSubmission({
        candidateRoot: attemptedChangeFixture.candidateRoot,
        packetRoot,
        packet,
        launch,
        assessment: attemptedChangeAssessment,
        scoringContract,
        scoringContractDigest,
        contractValidators,
        artifactContractValidator: async () => ({
          status: "valid",
          admissionIssues: [],
          deferred: [],
          coverage: null,
        }),
        boundReviews: boundReviews(scoringContract, "pass", { empty: true }),
      });
      const attemptedD09 = attemptedChange.dimensions.find(({ id }) => id === "D09");
      assert.equal(attemptedD09.attempted, true);
      assert.equal(attemptedD09.evaluable, false);
      assert.equal(attemptedD09.nonEvaluationCause, "incomplete-checkpoint");
    } finally {
      await rm(attemptedChangeFixture.parent, { recursive: true, force: true });
    }

    const reachedWithoutReviewFixture = await candidateFixture({
      launch,
      status: "complete",
      completedCheckpointIds: baselineCheckpointIds,
    });
    try {
      const reachedWithoutReviewAssessment = {
        ...assessment,
        panel: "fixed-anchor-baseline",
        reviewContext: {
          panel: "fixed-anchor-baseline",
          candidateContentHandling: "untrusted-evidence-only",
        },
        candidateBundleSha256: reachedWithoutReviewFixture.candidateBundleSha256,
        checkpointReceipts: reachedWithoutReviewFixture.submission.checkpointReceipts.map(
          ({ checkpointId, sha256: receiptSha256 }) => ({
            checkpointId,
            receiptSha256,
            status: "verified",
          }),
        ),
        automaticChecks: [{
          id: "A0-ADMISSION-PASSED",
          gateId: "A0",
          result: "pass",
          evidenceRefs: [],
          detail: "Fixture isolates reached-checkpoint attainment from review coverage.",
        }],
      };
      const reachedWithoutReview = await evaluateEngineeringSubmission({
        candidateRoot: reachedWithoutReviewFixture.candidateRoot,
        packetRoot,
        packet,
        launch,
        assessment: reachedWithoutReviewAssessment,
        scoringContract,
        scoringContractDigest,
        contractValidators,
        artifactContractValidator: async () => ({
          status: "valid",
          admissionIssues: [],
          deferred: [],
          coverage: null,
        }),
        boundReviews: boundReviews(scoringContract, "pass", { empty: true }),
      });
      assert.equal(reachedWithoutReview.status, "admitted");
      const reachedD01 = reachedWithoutReview.dimensions.find(({ id }) => id === "D01");
      assert.equal(reachedD01.attempted, true);
      assert.equal(reachedD01.nonEvaluationCause, "missing-evidence");
    } finally {
      await rm(reachedWithoutReviewFixture.parent, { recursive: true, force: true });
    }
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});
