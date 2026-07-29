import assert from "node:assert/strict";
import test from "node:test";
import {
  OPERATOR_ATTESTATION,
  authorizationBindingIssues,
  runConditionsSha256,
} from "../scripts/stage1-authorize-run.mjs";
import {
  workspaceReceiptBindingIssues,
} from "../scripts/candidate-workspace-lib.mjs";

const digest = (character) => character.repeat(64);
const conditions = {
  frozenAt: "2026-07-29T00:00:00.000Z",
  runConditions: {
    elapsedTimeLimitMinutes: 480,
    tokenBudget: { mode: "provider-metered-unbounded" },
    reasoningPreset: "xhigh",
    toolAccessProfile: "common-engineering-workspace-v1",
    networkPolicy: "public-research-allowed",
    randomnessPolicy: "provider-default-recorded",
    humanInterventionLimit: 0,
  },
};
const cohort = {
  id: "official-cohort",
  openedAt: "2026-07-29T00:01:00.000Z",
  launchId: "engineering-launch",
  candidateIds: ["opaque-run-01"],
};
const launch = {
  id: "engineering-launch",
  launchDigest: digest("1"),
  fairnessFingerprint: digest("2"),
  executionProfile: { digest: digest("3") },
};
const conditionsSha256 = digest("4");
const profile = {
  extensions: {
    candidateWorkspaceReceiptRequired: true,
    candidateWorkspaceIsolationAssurance:
      "operator-harness-attested-not-cryptographic-proof",
  },
};

function authorization() {
  return {
    schemaVersion: "1.0",
    assurance: "operator-attested-pre-run",
    runId: "opaque-run-01",
    cohortId: "official-cohort",
    launchId: "engineering-launch",
    issuedAt: "2026-07-29T00:02:00.000Z",
    measurementConditionsSha256: conditionsSha256,
    runConditionsSha256: runConditionsSha256(conditions.runConditions),
    launchDigest: launch.launchDigest,
    fairnessFingerprint: launch.fairnessFingerprint,
    executionProfileDigest: launch.executionProfile.digest,
    operatorPseudonym: "operator-01",
    attestations: {
      conditionsFrozenBeforeRun: true,
      candidateReceivedOnlyLaunchHandoff: true,
      candidateHadNoHumanDesignIntervention: true,
      statement: OPERATOR_ATTESTATION,
    },
  };
}

test("pre-run authorization binds one opaque run to frozen conditions and launch", () => {
  assert.deepEqual(
    authorizationBindingIssues(authorization(), {
      cohort,
      conditions,
      conditionsSha256,
      launch,
    }),
    [],
  );
});

test("pre-run authorization rejects backfilled or mismatched records", () => {
  const backfilled = authorization();
  backfilled.issuedAt = "2026-07-28T23:59:00.000Z";
  assert.ok(
    authorizationBindingIssues(backfilled, {
      cohort,
      conditions,
      conditionsSha256,
      launch,
    }).some(({ code }) => code === "authorization-time-order"),
  );

  const mismatched = authorization();
  mismatched.runConditionsSha256 = digest("f");
  assert.ok(
    authorizationBindingIssues(mismatched, {
      cohort,
      conditions,
      conditionsSha256,
      launch,
    }).some(({ code }) => code === "authorization-conditions"),
  );
});

test("official authorization requires the operator-created workspace receipt hash", () => {
  const missing = authorization();
  assert.ok(
    authorizationBindingIssues(missing, {
      cohort,
      conditions,
      conditionsSha256,
      launch,
      profile,
    }).some(({ code }) => code === "authorization-workspace-receipt"),
  );

  const bound = authorization();
  bound.externalRunConfigurationSha256 = digest("5");
  assert.deepEqual(
    authorizationBindingIssues(bound, {
      cohort,
      conditions,
      conditionsSha256,
      launch,
      profile,
    }),
    [],
  );
});

function workspaceReceipt() {
  return {
    schemaVersion: "1.0",
    kind: "candidate-workspace-receipt",
    createdAt: "2026-07-29T00:01:30.000Z",
    source: {
      launchId: launch.id,
      canonicalBaseUrl: "https://naoyamd.github.io/rotorbench",
      launchDigest: launch.launchDigest,
      promptSha256: digest("6"),
      executionContractDigest: digest("7"),
      taskPacket: {
        id: "engineering-task",
        version: "1.7",
        digest: digest("8"),
        bundleDigest: digest("9"),
      },
      workspaceBootstrap: {
        kind: "public-bundle",
        location:
          "https://naoyamd.github.io/rotorbench/framework/workspaces/engineering-task.json",
        sha256: digest("a"),
      },
    },
    cleanRoot: {
      assertion: "target-did-not-exist-before-atomic-materialization",
      targetExistedBeforeMaterialization: false,
      atomicInstall: true,
      symlinksRejected: true,
    },
    isolation: {
      policyPath: "isolation-policy.json",
      policySha256: digest("b"),
      enforcementAssurance:
        "operator-harness-attested-not-cryptographic-proof",
      enforcementStatement:
        "This record is an operator/harness attestation of the intended access boundary. It verifies only local materialization bytes and is not cryptographic proof that an external service, browser, or network policy was enforced.",
      sourceAllowlist: [
        "launches/engineering-launch/",
        "launches/engineering-launch/execution-contract/",
        "task-packets/engineering-task/1.7/",
        "workspace-bootstrap/engineering-task.json",
      ],
      prohibitedSourcePrefixes: [
        "runs/",
        "cohorts/",
        "publications/",
        "results/",
        "submissions/",
        "evaluation/private/",
      ],
    },
    materializedFiles: [
      ...Array.from({ length: 19 }, (_, index) => ({
        path: `task/inputs/input-${String(index + 1).padStart(2, "0")}.json`,
        sha256: digest("c"),
        sizeBytes: 1,
        source: {
          kind: "packet",
          path:
            `task-packets/engineering-task/1.7/inputs/input-${String(index + 1).padStart(2, "0")}.json`,
        },
      })),
      {
        path: "isolation-policy.json",
        sha256: digest("b"),
        sizeBytes: 1,
        source: {
          kind: "generated-policy",
          path: "generated/isolation-policy",
        },
      },
    ],
  };
}

test("workspace receipt binds launch, packet, bootstrap, assurance, and pre-run order", () => {
  const boundLaunch = {
    ...launch,
    canonicalBaseUrl: "https://naoyamd.github.io/rotorbench",
    promptSha256: digest("6"),
    executionContractDigest: digest("7"),
    taskPacket: {
      id: "engineering-task",
      version: "1.7",
      digest: digest("8"),
      bundleDigest: digest("9"),
    },
    workspaceBootstrap: {
      kind: "public-bundle",
      location:
        "https://naoyamd.github.io/rotorbench/framework/workspaces/engineering-task.json",
      sha256: digest("a"),
    },
  };
  const boundAuthorization = authorization();
  assert.deepEqual(
    workspaceReceiptBindingIssues(workspaceReceipt(), {
      launch: boundLaunch,
      profile,
      authorization: boundAuthorization,
    }),
    [],
  );

  const tampered = workspaceReceipt();
  tampered.source.launchDigest = digest("f");
  tampered.createdAt = "2026-07-29T00:03:00.000Z";
  const issues = workspaceReceiptBindingIssues(tampered, {
    launch: boundLaunch,
    profile,
    authorization: boundAuthorization,
  });
  assert.ok(issues.some((message) => /exact frozen launch/.test(message)));
  assert.ok(issues.some((message) => /no later than/.test(message)));
});
