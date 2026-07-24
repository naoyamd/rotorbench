import { cp, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  bundleTreeHash,
  loadFrozenContractValidators,
  readCandidateSubmissionIdentity,
  validateCandidateBundle,
} from "./stage-contract.mjs";
import {
  pathExists,
  validateFramework,
  validateRequiredOutputBindings,
} from "./framework-lib.mjs";
import { validateExecutionContractSnapshot } from "./stage0-lib.mjs";

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
let contractValidators;
if (launch.protocolVersion === "3.0") {
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
}
const validation = await validateCandidateBundle(source, { contractValidators });
if (validation.status !== "valid") {
  throw new Error(`Candidate bundle is invalid:\n${validation.issues.join("\n")}`);
}
const submission = validation.submission;
if (
  submission.protocolVersion !== "3.0"
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
  launch.protocolVersion === "3.0"
  && launchEntry.release?.status !== "live-verified"
) {
  throw new Error("Stage 2 v3 integration requires a live-verified launch");
}
if (
  launch.taskPacket.id !== submission.taskPacket.id
  || launch.taskPacket.version !== submission.taskPacket.version
  || launch.taskPacket.digest !== submission.taskPacket.digest
  || launch.fairnessFingerprint !== submission.fairnessFingerprint
  || (
    submission.protocolVersion === "3.0"
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
const packetEntry = framework.taskPackets.find(
  (entry) =>
    entry.manifest?.id === submission.taskPacket.id
    && entry.manifest?.version === submission.taskPacket.version,
);
if (!packetEntry?.manifest || packetEntry.validationIssues.length > 0) {
  throw new Error("Submission task packet is not valid");
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
  launch.protocolVersion === "3.0"
  && (
    packetEntry.layout !== "versioned"
    || packetEntry.manifest.schemaVersion !== "3.0"
    || !packetEntry.lock
    || packetEntry.stage0Issues.length > 0
  )
) {
  throw new Error("Stage 2 v3 integration requires a clean locked versioned v3 packet");
}
const requiredOutputIssues = validateRequiredOutputBindings(
  packetEntry.manifest,
  submission.artifacts,
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
if (missingRoles.length > 0) {
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
  ...(submission.protocolVersion === "3.0" ? {
    taskPacketBundleDigest: submission.taskPacket.bundleDigest,
    executionContractDigest: submission.executionContractDigest,
    promptSha256: submission.promptSha256,
    launchDigest: submission.launchDigest,
  } : {}),
  fairnessFingerprint: submission.fairnessFingerprint,
  status: "validated",
  submittedAt: new Date().toISOString(),
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
  },
};
try {
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
