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
    || !["2.0", "3.0"].includes(submission.protocolVersion)
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
  const contractValidators = options.contractValidators ?? {
    validatePlan,
    validateSubmission,
    validateWorkRecord,
  };
  if (path.basename(path.resolve(root)) !== "candidate-output") {
    issues.push("Stage 1 bundle root must be named candidate-output");
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
