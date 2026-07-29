import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  ensureInside,
  bundleTreeHash,
  readJson,
  sha256,
  validatePlan,
  validateSubmission,
  validateWorkRecord,
} from "./framework-lib.mjs";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";

async function regularFileInside(root, relativePath) {
  const candidate = ensureInside(root, relativePath);
  if (!candidate) return { issue: `unsafe path: ${relativePath}` };
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { issue: `not a regular file: ${relativePath}` };
    }
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      return { issue: `path escapes candidate-output: ${relativePath}` };
    }
    const data = await readFile(candidate);
    return { data, sha256: sha256(data) };
  } catch {
    return { issue: `missing file: ${relativePath}` };
  }
}

function duplicateIds(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return true;
      seen.add(item.id);
      return false;
    })
    .map((item) => item.id);
}

function v4Issue(issues, message) {
  issues.push(`v4: ${message}`);
}

async function validateV4ReceiptChain(root, submission, planFile, issues) {
  const receipts = submission.checkpointReceipts ?? [];
  const ids = new Set();
  const checkpointIds = new Set();
  let previousDigest = "0".repeat(64);
  let lastSequence = -1;
  const completed = new Set(submission.partialAttainment?.completedCheckpointIds ?? []);
  const attempted = new Set(submission.partialAttainment?.attemptedCheckpointIds ?? []);
  for (const receipt of receipts) {
    if (ids.has(receipt.id)) v4Issue(issues, `duplicate receipt id ${receipt.id}`);
    ids.add(receipt.id);
    if (checkpointIds.has(receipt.checkpointId)) {
      v4Issue(issues, `checkpoint ${receipt.checkpointId} has more than one receipt`);
    }
    checkpointIds.add(receipt.checkpointId);
    if (receipt.sequence <= lastSequence) v4Issue(issues, "receipt sequences must be strictly increasing");
    lastSequence = receipt.sequence;
    if (receipt.previousReceiptSha256 !== previousDigest) {
      v4Issue(issues, `receipt ${receipt.id} does not bind the prior receipt digest`);
    }
    const file = await regularFileInside(root, receipt.path);
    if (file.issue) {
      v4Issue(issues, file.issue);
      continue;
    }
    if (file.sha256 !== receipt.sha256) {
      v4Issue(issues, `receipt ${receipt.id} SHA-256 does not match submission.json`);
    }
    previousDigest = file.sha256;
    let record;
    try {
      record = JSON.parse(file.data.toString("utf8"));
    } catch {
      v4Issue(issues, `receipt ${receipt.id} is not valid JSON`);
      continue;
    }
    const expectedKeys = ["id", "sequence", "checkpointId", "previousReceiptSha256"];
    for (const key of expectedKeys) {
      if (record?.[key] !== receipt[key]) {
        v4Issue(issues, `receipt ${receipt.id} content does not match ${key}`);
      }
    }
    if (!Array.isArray(record?.evidence)) {
      v4Issue(issues, `receipt ${receipt.id} has no evidence declarations`);
    } else {
      for (const evidence of record.evidence) {
        const evidenceFile = await regularFileInside(root, evidence.path);
        if (evidenceFile.issue) v4Issue(issues, evidenceFile.issue);
        else if (evidenceFile.sha256 !== evidence.sha256) {
          v4Issue(issues, `receipt ${receipt.id} evidence hash does not match ${evidence.path}`);
        }
      }
    }
  }
  if (submission.status === "complete" && submission.partialAttainment?.stoppedReason !== "completed") {
    v4Issue(issues, "complete submissions must record stoppedReason completed");
  }
  if (submission.status === "partial" && submission.partialAttainment?.stoppedReason === "completed") {
    v4Issue(issues, "partial submissions cannot record stoppedReason completed");
  }
  for (const checkpointId of completed) {
    if (!checkpointIds.has(checkpointId)) v4Issue(issues, `completed checkpoint ${checkpointId} has no receipt`);
  }
  for (const checkpointId of checkpointIds) {
    if (!attempted.has(checkpointId)) v4Issue(issues, `receipt checkpoint ${checkpointId} is not listed as attempted`);
  }
  if (!checkpointIds.has(submission.partialAttainment?.highestVerifiedCheckpointId)) {
    v4Issue(issues, "highestVerifiedCheckpointId has no receipt");
  }
  const initialReceipt = receipts.find((receipt) => receipt.sequence === 0);
  if (initialReceipt && planFile.sha256) {
    const initialFile = await regularFileInside(root, initialReceipt.path);
    try {
      const initialRecord = JSON.parse(initialFile.data.toString("utf8"));
      const planBound = initialRecord.evidence?.some((evidence) => (
        evidence.path === "plan.json" && evidence.sha256 === planFile.sha256
      ));
      if (!planBound) v4Issue(issues, "first receipt must bind plan.json");
    } catch {
      // Other receipt diagnostics already provide the actionable error.
    }
  }
}

export async function readCandidateSubmissionIdentity(root) {
  if (path.basename(path.resolve(root)) !== "candidate-output") {
    throw new Error("Stage 1 bundle root must be named candidate-output");
  }
  const file = await regularFileInside(root, "submission.json");
  if (file.issue) throw new Error(file.issue);
  let submission;
  try {
    submission = JSON.parse(file.data.toString("utf8"));
  } catch {
    throw new Error("missing or invalid submission.json");
  }
  if (
    typeof submission.launchId !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submission.launchId)
    || !["2.0", "3.0", "4.0"].includes(submission.protocolVersion)
  ) {
    throw new Error("submission.json does not declare a safe launch identity");
  }
  return {
    launchId: submission.launchId,
    protocolVersion: submission.protocolVersion,
  };
}

export async function validateCandidateBundle(root, options = {}) {
  const issues = [];
  const expectedRootName = options.expectedRootName ?? "candidate-output";
  const contractValidators = options.contractValidators ?? {
    validatePlan,
    validateSubmission,
    validateWorkRecord,
  };
  if (path.basename(path.resolve(root)) !== expectedRootName) {
    issues.push(`Stage 1 bundle root must be named ${expectedRootName}`);
  }
  let submission;
  try {
    submission = await readJson(path.join(root, "submission.json"));
  } catch {
    return { status: "invalid", issues: ["missing or invalid submission.json"] };
  }
  issues.push(...contractValidators.validateSubmission(submission).map((issue) => issue.message));
  if (issues.length > 0) return { status: "invalid", issues };

  const planFile = await regularFileInside(root, submission.initialPlan.path);
  const checkpointFile = await regularFileInside(
    root,
    submission.initialPlanCheckpoint.path,
  );
  const recordFile = await regularFileInside(root, submission.workRecord.path);
  if (planFile.issue) issues.push(planFile.issue);
  if (checkpointFile.issue) issues.push(checkpointFile.issue);
  if (recordFile.issue) issues.push(recordFile.issue);
  if (planFile.sha256 && planFile.sha256 !== submission.initialPlan.sha256) {
    issues.push("initial plan SHA-256 does not match submission.json");
  }
  if (recordFile.sha256 && recordFile.sha256 !== submission.workRecord.sha256) {
    issues.push("work record SHA-256 does not match submission.json");
  }
  if (
    checkpointFile.sha256
    && checkpointFile.sha256 !== submission.initialPlanCheckpoint.sha256
  ) {
    issues.push("initial plan checkpoint SHA-256 does not match submission.json");
  }
  if (
    planFile.sha256
    && checkpointFile.data
    && checkpointFile.data.toString("utf8").trim() !== `${planFile.sha256}  plan.json`
  ) {
    issues.push("initial-plan.sha256 does not checkpoint the submitted initial plan");
  }

  let plan;
  let workRecord;
  try {
    if (planFile.data) plan = JSON.parse(planFile.data.toString("utf8"));
    if (recordFile.data) workRecord = JSON.parse(recordFile.data.toString("utf8"));
  } catch {
    issues.push("plan.json or work-record.json is not valid JSON");
  }
  if (plan) issues.push(...contractValidators.validatePlan(plan).map((issue) => issue.message));
  if (workRecord) {
    issues.push(...contractValidators.validateWorkRecord(workRecord).map((issue) => issue.message));
  }

  if (submission.protocolVersion === "4.0") {
    await validateV4ReceiptChain(root, submission, planFile, issues);
    if (!submission.sanitizationRequest?.profileDigest) {
      v4Issue(issues, "sanitizationRequest must bind the frozen evaluator profile");
    }
  }

  for (const duplicate of duplicateIds(plan?.requirements ?? [])) {
    issues.push(`duplicate requirement id: ${duplicate}`);
  }
  for (const collection of [
    plan?.steps ?? [],
    plan?.alternativesToEvaluate ?? [],
    plan?.verificationPlan ?? [],
    workRecord?.alternatives ?? [],
    workRecord?.decisions ?? [],
    workRecord?.planRevisions ?? [],
    workRecord?.verificationClaims ?? [],
    submission.artifacts,
  ]) {
    for (const duplicate of duplicateIds(collection)) issues.push(`duplicate id: ${duplicate}`);
  }

  const requirementIds = new Set((plan?.requirements ?? []).map(({ id }) => id));
  const stepIds = new Set((plan?.steps ?? []).map(({ id }) => id));
  const alternativeIds = new Set([
    ...(plan?.alternativesToEvaluate ?? []).map(({ id }) => id),
    ...(workRecord?.alternatives ?? []).map(({ id }) => id),
  ]);
  const artifactIds = new Set(submission.artifacts.map(({ id }) => id));
  const requireRefs = (items, key, known, label) => {
    for (const item of items ?? []) {
      for (const ref of item[key] ?? []) {
        if (!known.has(ref)) issues.push(`${label} ${item.id} has dangling reference ${ref}`);
      }
    }
  };
  requireRefs(plan?.steps, "requirementRefs", requirementIds, "plan step");
  requireRefs(plan?.alternativesToEvaluate, "requirementRefs", requirementIds, "planned alternative");
  requireRefs(plan?.verificationPlan, "requirementRefs", requirementIds, "verification plan");
  requireRefs(workRecord?.decisions, "requirementRefs", requirementIds, "decision");
  requireRefs(workRecord?.decisions, "alternativeRefs", alternativeIds, "decision");
  requireRefs(workRecord?.planRevisions, "affectedStepRefs", stepIds, "plan revision");
  requireRefs(workRecord?.verificationClaims, "requirementRefs", requirementIds, "verification claim");
  requireRefs(workRecord?.verificationClaims, "evidenceArtifactRefs", artifactIds, "verification claim");

  for (const artifact of submission.artifacts) {
    const file = await regularFileInside(root, artifact.path);
    if (file.issue) issues.push(file.issue);
    else if (file.sha256 !== artifact.sha256) {
      issues.push(`artifact ${artifact.id} SHA-256 does not match submission.json`);
    }
  }

  try {
    await bundleTreeHash(root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "bundle tree cannot be hashed");
  }

  return { status: issues.length === 0 ? "valid" : "invalid", issues, submission, plan, workRecord };
}

export { bundleTreeHash };
export { loadFrozenContractValidators };
