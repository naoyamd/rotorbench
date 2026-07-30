import "./official-execution-guard.mjs";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bundleTreeHash,
  loadAuthoritativeOutputContract,
  loadFrozenContractValidators,
  readCandidateSubmissionIdentity,
  validateCandidateBundle,
} from "./stage-contract.mjs";
import {
  pathExists,
  canonicalJson,
  ensureInside,
  sha256,
  validateMeasurementConditions,
  validateFramework,
  validateSubmissionRequiredOutputBindings,
} from "./framework-lib.mjs";
import { validateArtifactContract } from "./artifact-contract.mjs";
import { validateExecutionContractSnapshot } from "./stage0-lib.mjs";
import { authorizationBindingIssues } from "./stage1-authorize-run.mjs";
import { workspaceReceiptBindingIssues } from "./candidate-workspace-lib.mjs";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

const source = path.resolve(requiredArgument("--source"));
const candidateId = requiredArgument("--candidate-id");
const cohortId = requiredArgument("--cohort-id");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(candidateId)) {
  throw new Error("candidate ID must use lowercase kebab-case");
}
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cohortId)) {
  throw new Error("cohort ID must use lowercase kebab-case");
}
const projectRoot = process.cwd();
const destinationRoot = path.join(projectRoot, "runs", candidateId);
const submittedRoot = path.join(destinationRoot, "submitted");
if (await pathExists(destinationRoot)) {
  throw new Error(`Run destination already exists: runs/${candidateId}`);
}
const submissionIdentity = await readCandidateSubmissionIdentity(source);
const framework = await validateFramework(projectRoot);
if (framework.issues.length > 0) {
  throw new Error(
    `Target framework is invalid:\n${framework.issues
      .map((issue) => `${issue.scope}: ${issue.code}: ${issue.message}`)
      .join("\n")}`,
  );
}
const launchEntry = framework.launches.find(
  (entry) => entry.manifest?.id === submissionIdentity.launchId,
);
const launch = launchEntry?.manifest;
if (!launch || launchEntry.validationIssues.length > 0) {
  throw new Error("Submission launchId does not name a validated launch");
}
const packetEntry = framework.taskPackets.find(
  (entry) =>
    entry.manifest?.id === launch.taskPacket.id
    && entry.manifest?.version === launch.taskPacket.version,
);
if (!packetEntry?.manifest || packetEntry.validationIssues.length > 0) {
  throw new Error("Submission task packet is not valid");
}
let contractValidators;
let artifactContractValidator = validateArtifactContract;
if (["3.0", "4.0"].includes(launch.protocolVersion)) {
  const snapshotRoot = path.join(launchEntry.root, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(
    snapshotRoot,
    launch.executionContractDigest,
  );
  if (snapshot.status !== "valid") {
    throw new Error(
      `Submission launch execution contract is invalid:\n${snapshot.issues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  contractValidators = await loadFrozenContractValidators(snapshotRoot);
  if (launch.protocolVersion === "4.0") {
    const frozenArtifactContract = await import(
      pathToFileURL(path.join(snapshotRoot, "scripts", "artifact-contract.mjs")).href
    );
    if (typeof frozenArtifactContract.validateArtifactContract !== "function") {
      throw new Error("Frozen execution contract has no artifact-contract validator");
    }
    artifactContractValidator = frozenArtifactContract.validateArtifactContract;
  }
}
const authoritativeOutputContract = (
  packetEntry.manifest.id === "integrated-robotic-handling"
  && packetEntry.manifest.version === "1.10"
)
  ? await loadAuthoritativeOutputContract(packetEntry.root, packetEntry.manifest)
  : {};
const validation = await validateCandidateBundle(source, {
  contractValidators,
  ...authoritativeOutputContract,
});
if (validation.status !== "valid") {
  throw new Error(`Candidate bundle is invalid:\n${validation.issues.join("\n")}`);
}
const submission = validation.submission;
if (
  !["3.0", "4.0"].includes(submission.protocolVersion)
  && launchEntry.v2Grandfathered !== true
) {
  throw new Error("Stage 2 refuses protocol v2 submissions unless the exact launch is in the immutable grandfather registry");
}
if (
  launch.protocolVersion !== submission.protocolVersion
) {
  throw new Error("Submission protocol version does not match the validated launch");
}
if (
  ["3.0", "4.0"].includes(launch.protocolVersion)
  && launchEntry.release?.status !== "live-verified"
) {
  throw new Error("Stage 2 current-protocol integration requires a live-verified launch");
}
if (
  launch.taskPacket.id !== submission.taskPacket.id
  || launch.taskPacket.version !== submission.taskPacket.version
  || launch.taskPacket.digest !== submission.taskPacket.digest
  || launch.fairnessFingerprint !== submission.fairnessFingerprint
  || (
    ["3.0", "4.0"].includes(submission.protocolVersion)
    && (
      launch.taskPacket.bundleDigest !== submission.taskPacket.bundleDigest
      || launch.executionContractDigest !== submission.executionContractDigest
      || launch.promptSha256 !== submission.promptSha256
      || launch.launchDigest !== submission.launchDigest
    )
  )
) {
  throw new Error("Submission protocol identity does not match the validated launch");
}
if (
  submission.protocolVersion === "4.0"
  && canonicalJson(submission.v4Contract) !== canonicalJson(launch.v4Contract)
) {
  throw new Error("Submission v4 contract does not match the validated launch");
}
if (
  launch.protocolVersion === "2.0"
  && (
    launchEntry.v2Grandfathered !== true
    || packetEntry.layout !== "legacy-flat"
    || packetEntry.manifest.schemaVersion !== "1.0"
    || packetEntry.v2Grandfathered !== true
  )
) {
  throw new Error("Stage 2 rejects hybrid v2 launches that do not bind a grandfathered legacy-flat v2 packet");
}
if (
  ["3.0", "4.0"].includes(launch.protocolVersion)
  && (
    packetEntry.layout !== "versioned"
    || packetEntry.manifest.schemaVersion !== launch.protocolVersion
    || !packetEntry.lock
    || packetEntry.stage0Issues.length > 0
  )
) {
  throw new Error("Stage 2 current-protocol integration requires a clean locked versioned matching packet");
}
const artifactContract = await artifactContractValidator({
  candidateRoot: source,
  packetRoot: packetEntry.root,
  packet: packetEntry.manifest,
  submission,
});
if (artifactContract.status === "invalid" || artifactContract.status === "invalid-contract") {
  throw new Error(
    `Candidate bundle violates the task artifact contract:\n${artifactContract.admissionIssues
      .map((entry) => `${entry.code}: ${entry.message}`)
      .join("\n")}`,
  );
}
const requiredOutputIssues = validateSubmissionRequiredOutputBindings(
  packetEntry.manifest,
  submission,
);
if (requiredOutputIssues.length > 0) {
  throw new Error(
    `Candidate bundle required output bindings are invalid:\n${requiredOutputIssues
      .map((issue) => `${issue.code}: ${issue.message}`)
      .join("\n")}`,
  );
}
const availableRoles = new Set(
  submission.artifacts
    .filter((artifact) => artifact.status === "present")
    .map((artifact) => artifact.role),
);
const missingRoles = packetEntry.manifest.requiredOutputs
  .map((output) => typeof output === "string" ? output : output.role)
  .filter((role) => !availableRoles.has(role));
if (
  !["3.0", "4.0"].includes(submission.protocolVersion)
  && submission.status === "complete"
  && missingRoles.length > 0
) {
  throw new Error(
    `Candidate bundle is missing required output role(s): ${missingRoles.join(", ")}`,
  );
}
const cohortEntry = framework.cohorts.find(
  (entry) => entry.manifest?.id === cohortId,
);
if (
  !cohortEntry?.manifest
  || cohortEntry.validationIssues.length > 0
  || cohortEntry.manifest.status !== "open"
) {
  throw new Error("Cohort must exist, be valid, and remain open");
}
if (!cohortEntry.manifest.candidateIds.includes(candidateId)) {
  throw new Error("Candidate ID is not a member of the cohort");
}
if (
  cohortEntry.manifest.launchId !== submission.launchId
  || cohortEntry.manifest.fairnessFingerprint !== submission.fairnessFingerprint
) {
  throw new Error("Submission launch or fairness fingerprint does not match the cohort");
}
let measurementConditionsSha256 = null;
let measurementConditions = null;
if (submission.protocolVersion === "4.0") {
  const conditionsRef = cohortEntry.manifest.extensions?.measurementConditions;
  const conditionsPath = ensureInside(
    cohortEntry.root,
    conditionsRef?.path ?? "",
  );
  if (
    !conditionsPath
    || conditionsRef.path !== "measurement-conditions.json"
    || typeof conditionsRef.sha256 !== "string"
  ) {
    throw new Error("v4 cohort has no safe, hash-bound measurement conditions");
  }
  const conditionsBytes = await readFile(conditionsPath);
  if (sha256(conditionsBytes) !== conditionsRef.sha256) {
    throw new Error("v4 cohort measurement-condition bytes do not match their hash");
  }
  measurementConditionsSha256 = conditionsRef.sha256;
  const conditions = JSON.parse(conditionsBytes.toString("utf8"));
  measurementConditions = conditions;
  const conditionIssues = validateMeasurementConditions(conditions);
  if (conditionIssues.length > 0) {
    throw new Error(
      `v4 cohort measurement conditions are invalid:\n${conditionIssues
        .map(({ code, message }) => `${code}: ${message}`)
        .join("\n")}`,
    );
  }
  if (
    conditions.launchId !== launch.id
    || conditions.launchDigest !== launch.launchDigest
    || conditions.fairnessFingerprint !== launch.fairnessFingerprint
    || conditions.executionProfileDigest !== launch.executionProfile.digest
    || canonicalJson(conditions.candidateRunIds)
      !== canonicalJson(cohortEntry.manifest.candidateIds)
  ) {
    throw new Error("v4 cohort measurement conditions do not bind this launch and member list");
  }
}

const integratedAt = new Date().toISOString();
let runAuthorization = null;
let runAuthorizationBytes = null;
let candidateWorkspaceReceipt = null;
let candidateWorkspaceReceiptBytes = null;
if (
  submission.protocolVersion === "4.0"
  && launchEntry.profile?.extensions?.preRunAuthorizationRequired === true
) {
  const authorizationPath = ensureInside(
    path.join(cohortEntry.root, "run-authorizations"),
    `${candidateId}.json`,
  );
  if (!authorizationPath || !await pathExists(authorizationPath)) {
    throw new Error(
      "Official v4 integration requires a pre-run operator authorization for this opaque run ID",
    );
  }
  runAuthorizationBytes = await readFile(authorizationPath);
  try {
    runAuthorization = JSON.parse(runAuthorizationBytes.toString("utf8"));
  } catch {
    throw new Error("Pre-run operator authorization is not valid JSON");
  }
  const authorizationIssues = authorizationBindingIssues(runAuthorization, {
    cohort: cohortEntry.manifest,
    conditions: measurementConditions,
    conditionsSha256: measurementConditionsSha256,
    launch,
    profile: launchEntry.profile,
  });
  if (Date.parse(runAuthorization.issuedAt ?? "") > Date.parse(integratedAt)) {
    authorizationIssues.push({
      code: "authorization-after-integration",
      message: "pre-run authorization issuedAt is after the integration timestamp",
    });
  }
  if (authorizationIssues.length > 0) {
    throw new Error(
      `Pre-run operator authorization is invalid:\n${authorizationIssues
        .map(({ code, message }) => `${code}: ${message}`)
        .join("\n")}`,
    );
  }
  if (
    launchEntry.profile?.extensions?.candidateWorkspaceReceiptRequired === true
  ) {
    const receiptPath = ensureInside(source, "workspace-receipt.json");
    if (!receiptPath) {
      throw new Error("Candidate workspace receipt path is unsafe");
    }
    let receiptInfo;
    try {
      receiptInfo = await lstat(receiptPath);
    } catch {
      throw new Error(
        "Official integration requires candidate-output/workspace-receipt.json",
      );
    }
    if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink()) {
      throw new Error("Candidate workspace receipt must be a regular non-link file");
    }
    const [resolvedSource, resolvedReceipt] = await Promise.all([
      realpath(source),
      realpath(receiptPath),
    ]);
    if (!resolvedReceipt.startsWith(`${resolvedSource}${path.sep}`)) {
      throw new Error("Candidate workspace receipt escapes the submitted bundle");
    }
    candidateWorkspaceReceiptBytes = await readFile(receiptPath);
    if (
      sha256(candidateWorkspaceReceiptBytes)
      !== runAuthorization.externalRunConfigurationSha256
    ) {
      throw new Error(
        "Candidate workspace receipt does not match the pre-run authorization",
      );
    }
    try {
      candidateWorkspaceReceipt = JSON.parse(
        candidateWorkspaceReceiptBytes.toString("utf8"),
      );
    } catch {
      throw new Error("Candidate workspace receipt is not valid JSON");
    }
    const receiptIssues = workspaceReceiptBindingIssues(
      candidateWorkspaceReceipt,
      {
        launch,
        profile: launchEntry.profile,
        authorization: runAuthorization,
      },
    );
    if (receiptIssues.length > 0) {
      throw new Error(
        `Candidate workspace receipt is invalid:\n${receiptIssues.join("\n")}`,
      );
    }
  }
}

if (submission.protocolVersion === "4.0") {
  const checkpointById = new Map(packetEntry.manifest.checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const receiptByCheckpoint = new Map(
    submission.checkpointReceipts.map((receipt) => [receipt.checkpointId, receipt]),
  );
  for (const receipt of submission.checkpointReceipts) {
    if (!checkpointById.has(receipt.checkpointId)) {
      throw new Error(`v4 receipt references an unknown checkpoint ${receipt.checkpointId}`);
    }
  }
  for (const completedCheckpointId of submission.partialAttainment.completedCheckpointIds) {
    if (!receiptByCheckpoint.has(completedCheckpointId)) {
      throw new Error(`v4 completed checkpoint ${completedCheckpointId} has no receipt`);
    }
  }
  if (submission.status === "complete") {
    const missingCheckpoints = packetEntry.manifest.checkpoints
      .filter((checkpoint) => checkpoint.requiredForBaseline !== false)
      .map((checkpoint) => checkpoint.id)
      .filter((checkpointId) => !receiptByCheckpoint.has(checkpointId));
    if (missingCheckpoints.length > 0) {
      throw new Error(`v4 complete submission is missing checkpoint receipt(s): ${missingCheckpoints.join(", ")}`);
    }
  }
  const eventById = new Map(packetEntry.manifest.changeEvents.map((event) => [event.id, event]));
  const planRequirementIds = new Set(validation.plan.requirements.map((requirement) => requirement.id));
  for (const event of packetEntry.manifest.changeEvents) {
    for (const requirementRef of event.requirementRefs) {
      if (!planRequirementIds.has(requirementRef)) {
        throw new Error(`v4 change event ${event.id} references a requirement absent from the submitted plan: ${requirementRef}`);
      }
    }
    const responseReceipt = receiptByCheckpoint.get(event.responseCheckpointId);
    if (responseReceipt && responseReceipt.changeEventId !== event.id) {
      throw new Error(
        `v4 response checkpoint ${event.responseCheckpointId} must bind exact change event ${event.id}`,
      );
    }
  }
  for (const receipt of submission.checkpointReceipts) {
    if (!receipt.changeEventId) continue;
    const event = eventById.get(receipt.changeEventId);
    if (!event) throw new Error(`v4 receipt references unknown change event ${receipt.changeEventId}`);
    if (receipt.checkpointId !== event.responseCheckpointId) {
      throw new Error(`v4 change event ${event.id} must be received at ${event.responseCheckpointId}`);
    }
    if (!receiptByCheckpoint.has(event.triggerAfterCheckpointId)) {
      throw new Error(`v4 change event ${event.id} was received before its trigger checkpoint`);
    }
  }
  if (
    submission.sanitizationRequest.profileDigest
    !== packetEntry.manifest.v4Contract.sanitizationProfile.digest
  ) {
    throw new Error("v4 sanitization request does not bind the frozen sanitization profile");
  }
}

const sourceHash = await bundleTreeHash(source);
let destinationCreated = false;
try {
  await mkdir(destinationRoot, { recursive: false });
  destinationCreated = true;
  await cp(source, submittedRoot, { recursive: true, errorOnExist: true, force: false });
  const copiedHash = await bundleTreeHash(submittedRoot);
  if (sourceHash !== copiedHash) {
    throw new Error("Copied candidate bundle is not byte-identical");
  }
} catch (error) {
  if (destinationCreated) {
    await rm(destinationRoot, { recursive: true, force: true });
  }
  throw error;
}

const run = {
  schemaVersion: "1.0",
  id: candidateId,
  benchmarkId: submission.taskPacket.id,
  benchmarkVersion: submission.taskPacket.version,
  launchId: submission.launchId,
  cohortId,
  taskPacketDigest: submission.taskPacket.digest,
  ...(["3.0", "4.0"].includes(submission.protocolVersion) ? {
    taskPacketBundleDigest: submission.taskPacket.bundleDigest,
    executionContractDigest: submission.executionContractDigest,
    promptSha256: submission.promptSha256,
    launchDigest: submission.launchDigest,
  } : {}),
  fairnessFingerprint: submission.fairnessFingerprint,
  status: "validated",
  submittedAt: integratedAt,
  model: submission.model,
  seal: {
    sealed: true,
    bundlePath: "submitted",
    bundleSha256: sourceHash,
    algorithm: "sha256-tree-v1",
  },
  processEvidence: {
    initialPlan: {
      path: `submitted/${submission.initialPlan.path}`,
      sha256: submission.initialPlan.sha256,
    },
    workRecord: {
      path: `submitted/${submission.workRecord.path}`,
      sha256: submission.workRecord.sha256,
    },
  },
  artifacts: submission.artifacts.map((artifact) => ({
    ...artifact,
    path: `submitted/${artifact.path}`,
  })),
  extensions: {
    protocolVersion: submission.protocolVersion,
    submissionStatus: submission.status,
    ...(measurementConditionsSha256
      ? { measurementConditionsSha256 }
      : {}),
    ...(runAuthorization
      ? { preRunAuthorizationAssurance: runAuthorization.assurance }
      : {}),
    ...(candidateWorkspaceReceiptBytes
      ? {
          candidateWorkspaceReceiptSha256: sha256(
            candidateWorkspaceReceiptBytes,
          ),
          candidateWorkspaceIsolationAssurance:
            candidateWorkspaceReceipt.isolation.enforcementAssurance,
        }
      : {}),
  },
  ...(runAuthorization ? {
    authorization: {
      path: "run-authorization.json",
      sha256: sha256(runAuthorizationBytes),
      assurance: runAuthorization.assurance,
      issuedAt: runAuthorization.issuedAt,
    },
  } : {}),
  ...(submission.protocolVersion === "4.0" ? {
    checkpointReceipts: submission.checkpointReceipts.map((receipt) => ({
      ...receipt,
      path: `submitted/${receipt.path}`,
    })),
    partialAttainment: submission.partialAttainment,
    sanitization: {
      actor: "evaluator",
      profileDigest: submission.sanitizationRequest.profileDigest,
      status: "not-run",
      sanitizedArtifactIds: [],
    },
    evaluation: {
      contractDigest: submission.v4Contract.evaluationContract.digest,
      scoringVersion: submission.v4Contract.scoringVersion,
      recordPath: "evaluation-record.json",
    },
  } : {}),
};
try {
  if (runAuthorizationBytes) {
    await writeFile(
      path.join(destinationRoot, "run-authorization.json"),
      runAuthorizationBytes,
      { flag: "wx" },
    );
  }
  if (submission.protocolVersion === "4.0") {
    const evaluation = {
      schemaVersion: "4.0",
      runId: candidateId,
      evaluationContractDigest: run.evaluation.contractDigest,
      scoringVersion: run.evaluation.scoringVersion,
      status: "pending",
    };
    await writeFile(
      path.join(destinationRoot, "evaluation-record.json"),
      `${JSON.stringify(evaluation, null, 2)}\n`,
      { flag: "wx" },
    );
  }
  await writeFile(
    path.join(destinationRoot, "run.json"),
    `${JSON.stringify(run, null, 2)}\n`,
    { flag: "wx" },
  );
  const integrated = await validateFramework(projectRoot);
  const runIssues = integrated.issues.filter(
    (issue) => issue.scope === `runs/${candidateId}`,
  );
  if (runIssues.length > 0) {
    throw new Error(
      `Integrated run failed validation:\n${runIssues
        .map((issue) => `${issue.code}: ${issue.message}`)
        .join("\n")}`,
    );
  }
} catch (error) {
  await rm(destinationRoot, { recursive: true, force: true });
  throw error;
}
console.log(`Integrated sealed run ${candidateId} for publication review (${sourceHash}).`);
