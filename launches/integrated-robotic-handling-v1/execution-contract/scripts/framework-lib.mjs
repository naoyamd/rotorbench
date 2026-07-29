import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";

export const artifactRoles = new Set([
  "cad-source",
  "step",
  "drawing",
  "bom",
  "calculation",
  "supporting",
]);

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(moduleRoot, "schemas");
const schemaNames = [
  "artifact.schema.json",
  "stage-contract-v4.schema.json",
  "benchmark.schema.json",
  "task-packet.schema.json",
  "launch.schema.json",
  "cohort.schema.json",
  "measurement-conditions.schema.json",
  "run-authorization.schema.json",
  "candidate-workspace-isolation-policy.schema.json",
  "candidate-workspace-receipt.schema.json",
  "cohort-disclosure.schema.json",
  "cohort-evaluation-aggregate.schema.json",
  "plan.schema.json",
  "work-record.schema.json",
  "submission.schema.json",
  "run.schema.json",
  "validation-report.schema.json",
  "stage0-task-definition.schema.json",
  "task-packet-lock.schema.json",
  "execution-profile.schema.json",
  "baseline-attestation.schema.json",
  "engineering-review.schema.json",
  "protocol-review.schema.json",
  "launch-release.schema.json",
  "live-verification.schema.json",
  "evaluation-record.schema.json",
  "assessment-evidence.schema.json",
  "sanitization-report.schema.json",
  "review-package.schema.json",
  "review-submission.schema.json",
  "review-record.schema.json",
  "public-run-metadata.schema.json",
  "public-validation-summary.schema.json",
  "public-evaluation-summary.schema.json",
  "cohort-publication-bundle.schema.json",
];
const schemas = [];
for (const name of schemaNames) {
  schemas.push(JSON.parse(await readFile(path.join(schemaRoot, name), "utf8")));
}
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
const schemaValidators = {
  artifact: ajv.getSchema("https://rotorbench.example/schemas/artifact.schema.json"),
  benchmark: ajv.getSchema("https://rotorbench.example/schemas/benchmark.schema.json"),
  taskPacket: ajv.getSchema("https://rotorbench.example/schemas/task-packet.schema.json"),
  launch: ajv.getSchema("https://rotorbench.example/schemas/launch.schema.json"),
  cohort: ajv.getSchema("https://rotorbench.example/schemas/cohort.schema.json"),
  measurementConditions: ajv.getSchema("https://rotorbench.example/schemas/measurement-conditions.schema.json"),
  runAuthorization: ajv.getSchema("https://rotorbench.example/schemas/run-authorization.schema.json"),
  candidateWorkspaceReceipt: ajv.getSchema("https://rotorbench.example/schemas/candidate-workspace-receipt.schema.json"),
  cohortDisclosure: ajv.getSchema("https://rotorbench.example/schemas/cohort-disclosure.schema.json"),
  cohortEvaluationAggregate: ajv.getSchema("https://rotorbench.example/schemas/cohort-evaluation-aggregate.schema.json"),
  plan: ajv.getSchema("https://rotorbench.example/schemas/plan.schema.json"),
  workRecord: ajv.getSchema("https://rotorbench.example/schemas/work-record.schema.json"),
  submission: ajv.getSchema("https://rotorbench.example/schemas/submission.schema.json"),
  run: ajv.getSchema("https://rotorbench.example/schemas/run.schema.json"),
  report: ajv.getSchema("https://rotorbench.example/schemas/validation-report.schema.json"),
  taskDefinition: ajv.getSchema("https://rotorbench.example/schemas/stage0-task-definition.schema.json"),
  packetLock: ajv.getSchema("https://rotorbench.example/schemas/task-packet-lock.schema.json"),
  executionProfile: ajv.getSchema("https://rotorbench.example/schemas/execution-profile.schema.json"),
  baselineAttestation: ajv.getSchema("https://rotorbench.example/schemas/baseline-attestation.schema.json"),
  engineeringReview: ajv.getSchema("https://rotorbench.example/schemas/engineering-review.schema.json"),
  protocolReview: ajv.getSchema("https://rotorbench.example/schemas/protocol-review.schema.json"),
  launchRelease: ajv.getSchema("https://rotorbench.example/schemas/launch-release.schema.json"),
  liveVerification: ajv.getSchema("https://rotorbench.example/schemas/live-verification.schema.json"),
  evaluationRecord: ajv.getSchema("https://rotorbench.example/schemas/evaluation-record.schema.json"),
  assessmentEvidence: ajv.getSchema("https://rotorbench.example/schemas/assessment-evidence.schema.json"),
  sanitizationReport: ajv.getSchema("https://rotorbench.example/schemas/sanitization-report.schema.json"),
  reviewPackage: ajv.getSchema("https://rotorbench.example/schemas/review-package.schema.json"),
  reviewSubmission: ajv.getSchema("https://rotorbench.example/schemas/review-submission.schema.json"),
  reviewRecord: ajv.getSchema("https://rotorbench.example/schemas/review-record.schema.json"),
  publicRunMetadata: ajv.getSchema("https://rotorbench.example/schemas/public-run-metadata.schema.json"),
  publicValidationSummary: ajv.getSchema("https://rotorbench.example/schemas/public-validation-summary.schema.json"),
  publicEvaluationSummary: ajv.getSchema("https://rotorbench.example/schemas/public-evaluation-summary.schema.json"),
  cohortPublicationBundle: ajv.getSchema("https://rotorbench.example/schemas/cohort-publication-bundle.schema.json"),
};

if (Object.values(schemaValidators).some((validator) => typeof validator !== "function")) {
  throw new Error("Framework JSON Schemas could not be compiled");
}

export function isSafeRelativePath(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function manifestDigest(value) {
  return sha256(Buffer.from(canonicalJson(value)));
}

function exactGroupMembership(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right)) return false;
  const normalized = (groups) => groups
    .map(({ groupId, runIds }) => ({ groupId, runIds: Array.isArray(runIds) ? [...runIds].sort() : [] }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  return canonicalJson(normalized(left)) === canonicalJson(normalized(right));
}

export function computeFairnessFingerprint(launch) {
  const comparable = {
    protocolVersion: launch.protocolVersion,
    taskPacket: launch.taskPacket,
    baselineCommit: launch.baselineCommit,
    workspaceDigest: launch.workspaceDigest,
    outputRoot: launch.outputRoot,
    startAction: launch.startAction,
    stopConditions: launch.stopConditions,
    ...(["3.0", "4.0"].includes(launch.protocolVersion)
      ? {
        executionProfile: launch.executionProfile,
        executionContractDigest: launch.executionContractDigest,
        canonicalBaseUrl: launch.canonicalBaseUrl,
        ...(launch.protocolVersion === "4.0" ? {
          v4Contract: launch.v4Contract,
          workspaceBootstrap: launch.workspaceBootstrap,
        } : {}),
      }
      : {}),
  };
  return manifestDigest(comparable);
}

function schemaIssues(validator, value, prefix = "") {
  if (validator(value)) return [];
  return (validator.errors ?? []).map((error) => {
    const instancePath = error.instancePath
      ? error.instancePath.slice(1).replaceAll("/", ".")
      : "";
    const missing = error.keyword === "required" ? error.params.missingProperty : "";
    const property = [prefix, instancePath, missing].filter(Boolean).join(".");
    return {
      code: `schema-${error.keyword}`,
      message: `${property || "manifest"} ${error.message ?? "is invalid"}`,
      ...(property ? { path: property } : {}),
    };
  });
}

export function validateArtifact(artifact, index = 0) {
  return schemaIssues(schemaValidators.artifact, artifact, `artifacts.${index}`);
}

export function validateBenchmark(manifest) {
  return schemaIssues(schemaValidators.benchmark, manifest);
}

export function validateTaskPacket(manifest) {
  return schemaIssues(schemaValidators.taskPacket, manifest);
}

export function validateLaunch(manifest) {
  return schemaIssues(schemaValidators.launch, manifest);
}

export function validateCohort(manifest) {
  return schemaIssues(schemaValidators.cohort, manifest);
}

export function validateMeasurementConditions(manifest) {
  const issues = schemaIssues(schemaValidators.measurementConditions, manifest);
  if (issues.length > 0) return issues;

  const expectedRunsPerModel = manifest.repetitionPolicy.runsPerModel;
  const declaredRuns = new Set(manifest.candidateRunIds);
  const groupedRuns = [];
  const groupIds = new Set();
  for (const group of manifest.modelGroups) {
    if (groupIds.has(group.groupId)) {
      issues.push({
        code: "measurement-duplicate-model-group",
        message: `model group ${group.groupId} is declared more than once`,
        path: "modelGroups",
      });
    }
    groupIds.add(group.groupId);
    if (group.runIds.length !== expectedRunsPerModel) {
      issues.push({
        code: "measurement-repeat-count",
        message: `${group.groupId} must declare exactly ${expectedRunsPerModel} run IDs`,
        path: "modelGroups",
      });
    }
    groupedRuns.push(...group.runIds);
  }
  const groupedSet = new Set(groupedRuns);
  if (groupedSet.size !== groupedRuns.length) {
    issues.push({
      code: "measurement-run-assigned-twice",
      message: "each run ID must belong to exactly one opaque model group",
      path: "modelGroups",
    });
  }
  if (
    groupedSet.size !== declaredRuns.size
    || [...groupedSet].some((runId) => !declaredRuns.has(runId))
  ) {
    issues.push({
      code: "measurement-run-group-coverage",
      message: "opaque model groups must cover the candidateRunIds set exactly",
      path: "modelGroups",
    });
  }
  return issues;
}

export function validateRunAuthorization(manifest) {
  return schemaIssues(schemaValidators.runAuthorization, manifest);
}

export function validateCohortDisclosure(manifest) {
  const issues = schemaIssues(schemaValidators.cohortDisclosure, manifest);
  if (issues.length > 0) return issues;
  const groupIds = new Set();
  const runIds = new Set();
  for (const group of manifest.modelGroups) {
    if (groupIds.has(group.groupId)) {
      addIssue(issues, "disclosure-duplicate-model-group", `model group ${group.groupId} is declared more than once`, "modelGroups");
    }
    groupIds.add(group.groupId);
    for (const runId of group.runIds) {
      if (runIds.has(runId)) {
        addIssue(issues, "disclosure-run-assigned-twice", `run ${runId} belongs to more than one model group`, "modelGroups");
      }
      runIds.add(runId);
    }
  }
  return issues;
}

export function validateCohortEvaluationAggregate(manifest) {
  const issues = schemaIssues(schemaValidators.cohortEvaluationAggregate, manifest);
  if (issues.length > 0) return issues;
  const expectedDimensions = Array.from({ length: 10 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`);
  const groupIds = new Set();
  const runIds = new Set();
  for (const group of manifest.modelGroups) {
    if (groupIds.has(group.groupId)) {
      addIssue(issues, "aggregate-duplicate-model-group", `model group ${group.groupId} is aggregated more than once`, "modelGroups");
    }
    groupIds.add(group.groupId);
    const dimensions = group.dimensions.map(({ id }) => id).sort();
    if (canonicalJson(dimensions) !== canonicalJson(expectedDimensions)) {
      addIssue(issues, "aggregate-dimension-coverage", `${group.groupId} must contain exactly D01-D10`, "modelGroups");
    }
    for (const runId of group.runIds) {
      if (runIds.has(runId)) addIssue(issues, "aggregate-run-assigned-twice", `run ${runId} belongs to more than one aggregate group`, "modelGroups");
      runIds.add(runId);
    }
  }
  const recordIds = manifest.evaluationRecords.map(({ runId }) => runId);
  if (new Set(recordIds).size !== recordIds.length) {
    addIssue(issues, "aggregate-duplicate-evaluation-record", "each run must have exactly one final evaluation record", "evaluationRecords");
  }
  return issues;
}

export function validatePublicRunMetadata(manifest) {
  return schemaIssues(schemaValidators.publicRunMetadata, manifest);
}

export function validatePublicValidationSummary(manifest) {
  return schemaIssues(schemaValidators.publicValidationSummary, manifest);
}

export function validatePublicEvaluationSummary(manifest) {
  return schemaIssues(schemaValidators.publicEvaluationSummary, manifest);
}

export function validateCohortPublicationBundle(manifest) {
  return schemaIssues(schemaValidators.cohortPublicationBundle, manifest);
}

export function validatePlan(manifest) {
  return schemaIssues(schemaValidators.plan, manifest);
}

export function validateWorkRecord(manifest) {
  return schemaIssues(schemaValidators.workRecord, manifest);
}

export function validateSubmission(manifest) {
  return schemaIssues(schemaValidators.submission, manifest);
}

export function validateProcessTrace(
  plan,
  workRecord,
  artifacts = [],
  contractValidators = null,
) {
  const issues = [
    ...(contractValidators?.validatePlan ?? validatePlan)(plan),
    ...(contractValidators?.validateWorkRecord ?? validateWorkRecord)(workRecord),
  ];
  const collections = [
    plan?.requirements ?? [],
    plan?.assumptions ?? [],
    plan?.steps ?? [],
    plan?.alternativesToEvaluate ?? [],
    plan?.verificationPlan ?? [],
    workRecord?.alternatives ?? [],
    workRecord?.decisions ?? [],
    workRecord?.planRevisions ?? [],
    workRecord?.verificationClaims ?? [],
    artifacts,
  ];
  for (const collection of collections) {
    const seen = new Set();
    for (const item of collection) {
      if (seen.has(item.id)) {
        issues.push({ code: "duplicate-process-id", message: `${item.id} is duplicated`, path: item.id });
      }
      seen.add(item.id);
    }
  }
  const requirementIds = new Set((plan?.requirements ?? []).map(({ id }) => id));
  const stepIds = new Set((plan?.steps ?? []).map(({ id }) => id));
  const alternativeIds = new Set([
    ...(plan?.alternativesToEvaluate ?? []).map(({ id }) => id),
    ...(workRecord?.alternatives ?? []).map(({ id }) => id),
  ]);
  const artifactIds = new Set(artifacts.map(({ id }) => id));
  const verifyRefs = (items, key, known, label) => {
    for (const item of items ?? []) {
      for (const ref of item[key] ?? []) {
        if (!known.has(ref)) {
          issues.push({
            code: "dangling-process-reference",
            message: `${label} ${item.id} references unknown ${ref}`,
            path: `${label}.${item.id}.${key}`,
          });
        }
      }
    }
  };
  verifyRefs(plan?.steps, "requirementRefs", requirementIds, "steps");
  verifyRefs(plan?.alternativesToEvaluate, "requirementRefs", requirementIds, "alternativesToEvaluate");
  verifyRefs(plan?.verificationPlan, "requirementRefs", requirementIds, "verificationPlan");
  verifyRefs(workRecord?.decisions, "requirementRefs", requirementIds, "decisions");
  verifyRefs(workRecord?.decisions, "alternativeRefs", alternativeIds, "decisions");
  verifyRefs(workRecord?.planRevisions, "affectedStepRefs", stepIds, "planRevisions");
  verifyRefs(workRecord?.verificationClaims, "requirementRefs", requirementIds, "verificationClaims");
  verifyRefs(workRecord?.verificationClaims, "evidenceArtifactRefs", artifactIds, "verificationClaims");
  return issues;
}

export function validateRun(manifest) {
  const issues = schemaIssues(schemaValidators.run, manifest);
  if (Array.isArray(manifest?.artifacts)) {
    const ids = new Set();
    manifest.artifacts.forEach((artifact, index) => {
      if (ids.has(artifact?.id)) {
        issues.push({
          code: "duplicate-artifact-id",
          message: `artifacts.${index}.id is duplicated`,
          path: `artifacts.${index}.id`,
        });
      }
      ids.add(artifact?.id);
    });
  }
  return issues;
}

export function validateCandidateWorkspaceReceipt(receipt) {
  return schemaIssues(schemaValidators.candidateWorkspaceReceipt, receipt);
}

async function validateRunAuthorizationStorage(run, cohort, launch) {
  const issues = [];
  const required =
    launch?.profile?.extensions?.preRunAuthorizationRequired === true
    || run.manifest?.extensions?.preRunAuthorizationAssurance
      === "operator-attested-pre-run";
  const reference = run.manifest?.authorization;
  if (!required && !reference) return issues;
  if (!reference) {
    addIssue(
      issues,
      "missing-run-authorization",
      "official run requires a pre-run operator authorization",
      "authorization",
    );
    return issues;
  }
  const authorizationPath = ensureInside(run.root, reference.path ?? "");
  if (!authorizationPath || reference.path !== "run-authorization.json") {
    addIssue(
      issues,
      "unsafe-run-authorization",
      "run authorization path must be the safe fixed path run-authorization.json",
      "authorization.path",
    );
    return issues;
  }
  try {
    const bytes = await readFile(authorizationPath);
    if (sha256(bytes) !== reference.sha256) {
      addIssue(
        issues,
        "run-authorization-hash",
        "run authorization bytes do not match run.json",
        "authorization.sha256",
      );
    }
    const authorization = JSON.parse(bytes.toString("utf8"));
    issues.push(...validateRunAuthorization(authorization));
    const conditions = cohort?.measurementConditions;
    const conditionsSha256 =
      cohort?.manifest?.extensions?.measurementConditions?.sha256;
    if (
      authorization.runId !== run.manifest.id
      || authorization.cohortId !== run.manifest.cohortId
      || authorization.launchId !== run.manifest.launchId
    ) {
      addIssue(
        issues,
        "run-authorization-identity",
        "run authorization does not bind this exact run, cohort, and launch",
        "authorization",
      );
    }
    if (
      !conditions
      || authorization.measurementConditionsSha256 !== conditionsSha256
      || authorization.runConditionsSha256
        !== sha256(Buffer.from(canonicalJson(conditions.runConditions), "utf8"))
    ) {
      addIssue(
        issues,
        "run-authorization-conditions",
        "run authorization does not bind the frozen measurement conditions",
        "authorization",
      );
    }
    if (
      authorization.launchDigest !== launch?.manifest?.launchDigest
      || authorization.fairnessFingerprint
        !== launch?.manifest?.fairnessFingerprint
      || authorization.executionProfileDigest
        !== launch?.manifest?.executionProfile?.digest
    ) {
      addIssue(
        issues,
        "run-authorization-launch",
        "run authorization does not bind the frozen launch",
        "authorization",
      );
    }
    if (
      authorization.assurance !== reference.assurance
      || authorization.issuedAt !== reference.issuedAt
    ) {
      addIssue(
        issues,
        "run-authorization-reference",
        "run authorization metadata differs from run.json",
        "authorization",
      );
    }
    if (
      launch?.profile?.extensions?.candidateWorkspaceReceiptRequired === true
    ) {
      const receiptRelativePath = "submitted/workspace-receipt.json";
      const receiptPath = ensureInside(run.root, receiptRelativePath);
      if (!receiptPath) {
        addIssue(
          issues,
          "unsafe-candidate-workspace-receipt",
          "candidate workspace receipt path is unsafe",
          receiptRelativePath,
        );
      } else {
        try {
          const receiptInfo = await lstat(receiptPath);
          if (!receiptInfo.isFile() || receiptInfo.isSymbolicLink()) {
            throw new Error("receipt is not a regular non-link file");
          }
          const [resolvedRoot, resolvedReceipt] = await Promise.all([
            realpath(run.root),
            realpath(receiptPath),
          ]);
          if (!resolvedReceipt.startsWith(`${resolvedRoot}${path.sep}`)) {
            throw new Error("receipt resolves outside the run directory");
          }
          const receiptBytes = await readFile(receiptPath);
          const receiptSha256 = sha256(receiptBytes);
          if (
            receiptSha256
              !== authorization.externalRunConfigurationSha256
            || receiptSha256
              !== run.manifest.extensions?.candidateWorkspaceReceiptSha256
          ) {
            addIssue(
              issues,
              "candidate-workspace-receipt-hash",
              "candidate workspace receipt does not match the pre-run authorization and run record",
              receiptRelativePath,
            );
          }
          const receipt = JSON.parse(receiptBytes.toString("utf8"));
          issues.push(...validateCandidateWorkspaceReceipt(receipt));
          const launchManifest = launch?.manifest;
          if (
            receipt.source?.launchId !== launchManifest?.id
            || receipt.source?.canonicalBaseUrl
              !== launchManifest?.canonicalBaseUrl
            || receipt.source?.launchDigest !== launchManifest?.launchDigest
            || receipt.source?.promptSha256 !== launchManifest?.promptSha256
            || receipt.source?.executionContractDigest
              !== launchManifest?.executionContractDigest
            || receipt.source?.taskPacket?.id
              !== launchManifest?.taskPacket?.id
            || receipt.source?.taskPacket?.version
              !== launchManifest?.taskPacket?.version
            || receipt.source?.taskPacket?.digest
              !== launchManifest?.taskPacket?.digest
            || receipt.source?.taskPacket?.bundleDigest
              !== launchManifest?.taskPacket?.bundleDigest
            || receipt.source?.workspaceBootstrap?.kind
              !== launchManifest?.workspaceBootstrap?.kind
            || receipt.source?.workspaceBootstrap?.location
              !== launchManifest?.workspaceBootstrap?.location
            || receipt.source?.workspaceBootstrap?.sha256
              !== launchManifest?.workspaceBootstrap?.sha256
          ) {
            addIssue(
              issues,
              "candidate-workspace-receipt-binding",
              "candidate workspace receipt does not bind the exact launch, packet, and bootstrap",
              receiptRelativePath,
            );
          }
          const requiredIsolationAssurance =
            launch?.profile?.extensions
              ?.candidateWorkspaceIsolationAssurance;
          if (
            receipt.isolation?.enforcementAssurance
              !== requiredIsolationAssurance
            || run.manifest.extensions
              ?.candidateWorkspaceIsolationAssurance
              !== requiredIsolationAssurance
          ) {
            addIssue(
              issues,
              "candidate-workspace-isolation-assurance",
              "candidate workspace receipt does not use the execution profile's isolation assurance",
              receiptRelativePath,
            );
          }
          if (
            Number.isNaN(Date.parse(receipt.createdAt ?? ""))
            || Date.parse(receipt.createdAt)
              > Date.parse(authorization.issuedAt)
          ) {
            addIssue(
              issues,
              "candidate-workspace-receipt-time-order",
              "candidate workspace receipt must precede the pre-run authorization",
              `${receiptRelativePath}.createdAt`,
            );
          }
        } catch {
          addIssue(
            issues,
            "candidate-workspace-receipt-unreadable",
            "candidate workspace receipt is missing, linked, unreadable, or invalid JSON",
            receiptRelativePath,
          );
        }
      }
    }
    if (
      Date.parse(authorization.issuedAt) < Date.parse(cohort?.manifest?.openedAt)
      || Date.parse(authorization.issuedAt) < Date.parse(conditions?.frozenAt)
      || Date.parse(authorization.issuedAt) > Date.parse(run.manifest.submittedAt)
    ) {
      addIssue(
        issues,
        "run-authorization-time-order",
        "authorization must follow cohort opening and precede integration",
        "authorization.issuedAt",
      );
    }
  } catch {
    addIssue(
      issues,
      "run-authorization-unreadable",
      "run authorization is missing, unreadable, or invalid JSON",
      "authorization",
    );
  }
  return issues;
}

export function validateRequiredOutputBindings(packet, artifacts = []) {
  const issues = [];
  if (!['3.0', '4.0'].includes(packet?.schemaVersion)) return issues;
  const outputs = new Map((packet.requiredOutputs ?? []).map((output) => [output.id, output]));
  const bindings = new Map();
  for (const [artifactIndex, artifact] of (artifacts ?? []).entries()) {
    const refs = Array.isArray(artifact?.requiredOutputRefs)
      ? artifact.requiredOutputRefs
      : [];
    if (refs.length === 0) {
      issues.push({
        code: "missing-required-output-ref",
        message: `artifact ${artifact?.id ?? artifactIndex} must bind at least one required output ID`,
        path: `artifacts.${artifactIndex}.requiredOutputRefs`,
      });
      continue;
    }
    for (const outputId of refs) {
      const output = outputs.get(outputId);
      if (!output) {
        issues.push({
          code: "unknown-required-output-ref",
          message: `artifact ${artifact?.id ?? artifactIndex} binds unknown output ${outputId}`,
          path: `artifacts.${artifactIndex}.requiredOutputRefs`,
        });
        continue;
      }
      const bound = bindings.get(outputId) ?? [];
      bound.push({ artifact, artifactIndex });
      bindings.set(outputId, bound);
      if (artifact.status !== "present") {
        issues.push({
          code: "required-output-not-present",
          message: `artifact ${artifact.id} binds ${outputId} but is not present`,
          path: `artifacts.${artifactIndex}.status`,
        });
      }
      if (artifact.role !== output.role) {
        issues.push({
          code: "required-output-role-mismatch",
          message: `artifact ${artifact.id} role does not match required output ${outputId}`,
          path: `artifacts.${artifactIndex}.role`,
        });
      }
    }
  }
  for (const [outputId] of outputs) {
    const bound = bindings.get(outputId) ?? [];
    if (bound.length === 0) {
      issues.push({
        code: "missing-required-output-binding",
        message: `required output ${outputId} has no bound artifact`,
        path: "artifacts",
      });
    } else if (packet.schemaVersion === "3.0" && bound.length > 1) {
      issues.push({
        code: "duplicate-required-output-binding",
        message: `required output ${outputId} is bound by more than one artifact`,
        path: "artifacts",
      });
    }
  }
  for (const criterion of packet.completionCriteria ?? []) {
    for (const outputId of criterion.requiredOutputRefs ?? []) {
      const bound = bindings.get(outputId) ?? [];
      for (const { artifact, artifactIndex } of bound) {
        if (!criterion.evidenceRoles?.includes(artifact.role)) {
          issues.push({
            code: "criterion-evidence-role-mismatch",
            message: `criterion ${criterion.id} does not admit the role bound to ${outputId}`,
            path: `artifacts.${artifactIndex}.requiredOutputRefs`,
          });
        }
      }
    }
  }
  return issues;
}

export function validateReport(report) {
  return schemaIssues(schemaValidators.report, report);
}

export function validateTaskDefinition(value) {
  return schemaIssues(schemaValidators.taskDefinition, value);
}

export function validatePacketLock(value) {
  return schemaIssues(schemaValidators.packetLock, value);
}

export function validateExecutionProfile(value) {
  return schemaIssues(schemaValidators.executionProfile, value);
}

export function validateBaselineAttestation(value) {
  return schemaIssues(schemaValidators.baselineAttestation, value);
}

export function validateEngineeringReview(value) {
  return schemaIssues(schemaValidators.engineeringReview, value);
}

export function validateProtocolReview(value) {
  return schemaIssues(schemaValidators.protocolReview, value);
}

export function validateLaunchRelease(value) {
  return schemaIssues(schemaValidators.launchRelease, value);
}

export function validateLiveVerification(value) {
  return schemaIssues(schemaValidators.liveVerification, value);
}

export function validateEvaluationRecord(value) {
  return schemaIssues(schemaValidators.evaluationRecord, value);
}

export function validateAssessmentEvidence(value) {
  return schemaIssues(schemaValidators.assessmentEvidence, value);
}

export function validateSanitizationReport(value) {
  return schemaIssues(schemaValidators.sanitizationReport, value);
}

export function validateReviewPackage(value) {
  return schemaIssues(schemaValidators.reviewPackage, value);
}

export function validateReviewSubmission(value) {
  return schemaIssues(schemaValidators.reviewSubmission, value);
}

export function validateReviewRecord(value) {
  return schemaIssues(schemaValidators.reviewRecord, value);
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function listContentDirectories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

async function listRegularFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`bundle contains a symbolic link: ${path.relative(root, absolute)}`);
    }
    if (entry.isDirectory()) files.push(...await listRegularFiles(root, absolute));
    else if (entry.isFile()) {
      files.push(path.relative(root, absolute).split(path.sep).join("/"));
    } else {
      throw new Error(`bundle contains an unsupported filesystem entry: ${path.relative(root, absolute)}`);
    }
  }
  return files.sort();
}

export async function bundleTreeHash(root) {
  const files = await listRegularFiles(root);
  const records = [];
  for (const relativePath of files) {
    records.push(`${relativePath}\0${sha256(await readFile(path.join(root, ...relativePath.split("/"))))}\n`);
  }
  return sha256(Buffer.from(records.join("")));
}

export function ensureInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  return candidate.startsWith(`${resolvedRoot}${path.sep}`) ? candidate : null;
}

function isPathUnderBundle(bundlePath, filePath) {
  return (
    isSafeRelativePath(bundlePath)
    && isSafeRelativePath(filePath)
    && filePath.startsWith(`${bundlePath}/`)
  );
}

async function validateSealedSubmission(
  run,
  local,
  checks,
  contractValidators = null,
) {
  const bundlePath = run.manifest.seal?.bundlePath;
  if (!isSafeRelativePath(bundlePath)) return;

  const submissionRelativePath = `${bundlePath}/submission.json`;
  const submissionPath = ensureInside(run.root, submissionRelativePath);
  let submission;
  try {
    submission = await readJson(submissionPath);
  } catch {
    addIssue(
      local,
      "missing-sealed-submission",
      "sealed bundle submission.json is missing or invalid",
      submissionRelativePath,
    );
    checks.push(check("Sealed submission manifest", "fail", "submission.json cannot be loaded"));
    return;
  }

  const schemaProblems = (
    contractValidators?.validateSubmission ?? validateSubmission
  )(submission);
  if (schemaProblems.length > 0) {
    for (const issue of schemaProblems) {
      addIssue(
        local,
        "invalid-sealed-submission",
        `sealed submission ${issue.message}`,
        submissionRelativePath,
      );
    }
    checks.push(check(
      "Sealed submission manifest",
      "fail",
      `${schemaProblems.length} submission schema issue(s)`,
    ));
    return;
  }
  checks.push(check("Sealed submission manifest", "pass", "submission.json schema validation passed"));

  const checkpointDeclaration = {
    path: `${bundlePath}/${submission.initialPlanCheckpoint.path}`,
    sha256: submission.initialPlanCheckpoint.sha256,
  };
  await validateDeclaredFile(
    run.root,
    checkpointDeclaration,
    "initial plan checkpoint",
    local,
    checks,
  );
  try {
    const checkpointText = (await readFile(
      ensureInside(run.root, checkpointDeclaration.path),
      "utf8",
    )).trim();
    if (checkpointText !== `${submission.initialPlan.sha256}  plan.json`) {
      addIssue(
        local,
        "initial-plan-checkpoint-mismatch",
        "sealed initial-plan.sha256 does not checkpoint the submitted initial plan",
        checkpointDeclaration.path,
      );
    }
  } catch {
    // validateDeclaredFile reports the missing or unreadable checkpoint.
  }

  if (
    submission.launchId !== run.manifest.launchId
    || submission.taskPacket.id !== run.manifest.benchmarkId
    || submission.taskPacket.version !== run.manifest.benchmarkVersion
    || submission.taskPacket.digest !== run.manifest.taskPacketDigest
    || submission.fairnessFingerprint !== run.manifest.fairnessFingerprint
    || (
      ["3.0", "4.0"].includes(submission.protocolVersion)
      && (
        submission.taskPacket.bundleDigest !== run.manifest.taskPacketBundleDigest
        || submission.executionContractDigest !== run.manifest.executionContractDigest
        || submission.promptSha256 !== run.manifest.promptSha256
        || submission.launchDigest !== run.manifest.launchDigest
      )
    )
  ) {
    addIssue(
      local,
      "sealed-submission-protocol-mismatch",
      "run protocol identity does not match sealed submission.json",
      submissionRelativePath,
    );
  }

  if (canonicalJson(submission.model) !== canonicalJson(run.manifest.model)) {
    addIssue(
      local,
      "sealed-submission-model-mismatch",
      "run model does not match sealed submission.json",
      "model",
    );
  }

  if (submission.protocolVersion === "4.0") {
    const expectedReceipts = submission.checkpointReceipts.map((receipt) => ({
      ...receipt,
      path: `${bundlePath}/${receipt.path}`,
    }));
    if (canonicalJson(expectedReceipts) !== canonicalJson(run.manifest.checkpointReceipts)) {
      addIssue(
        local,
        "sealed-submission-receipts-mismatch",
        "run checkpoint receipts do not match sealed submission.json",
        "checkpointReceipts",
      );
    }
    if (canonicalJson(submission.partialAttainment) !== canonicalJson(run.manifest.partialAttainment)) {
      addIssue(local, "sealed-submission-attainment-mismatch", "run attainment does not match sealed submission.json", "partialAttainment");
    }
    if (
      submission.sanitizationRequest?.profileDigest
        !== run.manifest.sanitization?.profileDigest
      || run.manifest.sanitization?.actor !== "evaluator"
    ) {
      addIssue(
        local,
        "sealed-submission-sanitization-binding",
        "evaluator sanitization does not bind the candidate-requested frozen profile",
        "sanitization",
      );
    }
    for (const receipt of run.manifest.checkpointReceipts ?? []) {
      await validateDeclaredFile(run.root, receipt, `checkpoint receipt ${receipt.id}`, local, checks);
    }
  }

  const expectedProcessEvidence = {
    initialPlan: {
      path: `${bundlePath}/${submission.initialPlan.path}`,
      sha256: submission.initialPlan.sha256,
    },
    workRecord: {
      path: `${bundlePath}/${submission.workRecord.path}`,
      sha256: submission.workRecord.sha256,
    },
  };
  if (
    canonicalJson(expectedProcessEvidence)
    !== canonicalJson(run.manifest.processEvidence)
  ) {
    addIssue(
      local,
      "sealed-submission-process-mismatch",
      "run process evidence paths or hashes do not match sealed submission.json",
      "processEvidence",
    );
  }

  const expectedArtifacts = submission.artifacts.map((artifact) => ({
    ...artifact,
    path: `${bundlePath}/${artifact.path}`,
  }));
  if (canonicalJson(expectedArtifacts) !== canonicalJson(run.manifest.artifacts)) {
    addIssue(
      local,
      "sealed-submission-artifacts-mismatch",
      "run artifacts do not match sealed submission.json",
      "artifacts",
    );
  }
}

async function readEvaluatorOwnedRegular(root, relativePath) {
  const absolute = ensureInside(root, relativePath);
  if (!absolute) return { error: "unsafe" };
  const [resolvedRoot, before, resolvedBefore] = await Promise.all([
    realpath(root).catch(() => null),
    lstat(absolute).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (!before?.isFile() || before.isSymbolicLink()) return { error: "not-regular" };
  if (
    !resolvedRoot
    || !resolvedBefore
    || (resolvedBefore !== resolvedRoot && !resolvedBefore.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    return { error: "escaped" };
  }
  const bytes = await readFile(absolute).catch(() => null);
  const [after, resolvedAfter] = await Promise.all([
    lstat(absolute).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (
    !bytes
    || !after?.isFile()
    || after.isSymbolicLink()
    || after.size !== before.size
    || resolvedAfter !== resolvedBefore
  ) {
    return { error: "changed" };
  }
  return { absolute, bytes };
}

function reviewEvidenceReferences(record) {
  return [
    ...(record?.gateRatings ?? []).flatMap((rating) => rating.evidenceRefs ?? []),
    ...(record?.expertRatings ?? []).flatMap((rating) => rating.evidenceRefs ?? []),
  ];
}

/**
 * Re-read the evaluator-owned blind-review bytes referenced by a conclusive
 * evaluation.  The evaluator result keeps only opaque record identifiers and
 * hashes; this verifier makes a later package or record swap fail closed.
 */
export async function validateReviewAuditStorage(run, evaluation) {
  const issues = [];
  const audit = evaluation?.reviewAudit;
  if (!audit) {
    if (evaluation?.status === "admitted") {
      addIssue(issues, "missing-review-audit", "an admitted evaluation must bind an evaluator-owned review package and sealed review records", "reviewAudit");
    }
    return issues;
  }

  const packageRef = audit.reviewPackage;
  if (
    packageRef?.path !== "sanitized/review-package/review-package.json"
    || !/^[a-f0-9]{64}$/.test(packageRef?.sha256 ?? "")
  ) {
    addIssue(issues, "review-package-reference", "review audit must bind the canonical review-package manifest with a concrete hash", "reviewAudit.reviewPackage");
    return issues;
  }
  const packageFile = await readEvaluatorOwnedRegular(run.root, packageRef.path);
  if (!packageFile.bytes) {
    addIssue(issues, "review-package-unreadable", "review-package manifest must be an unchanged evaluator-owned regular file", "reviewAudit.reviewPackage.path");
    return issues;
  }
  if (sha256(packageFile.bytes) !== packageRef.sha256) {
    addIssue(issues, "review-package-hash-mismatch", "stored review-package bytes do not match the final evaluation audit binding", "reviewAudit.reviewPackage.sha256");
    return issues;
  }

  let reviewPackage;
  try {
    reviewPackage = JSON.parse(packageFile.bytes.toString("utf8"));
  } catch {
    addIssue(issues, "review-package-json", "review-package manifest is not valid JSON", "reviewAudit.reviewPackage.path");
    return issues;
  }
  issues.push(...validateReviewPackage(reviewPackage));
  if (reviewPackage?.reviewPackageId !== packageRef.id) {
    addIssue(issues, "review-package-id-mismatch", "review-package ID does not match the final evaluation audit binding", "reviewAudit.reviewPackage.id");
  }
  if (reviewPackage?.scoringContract?.sha256 !== evaluation.evaluationContractDigest) {
    addIssue(issues, "review-package-scoring-binding", "review package does not bind this evaluation's frozen scoring contract", "reviewAudit.reviewPackage");
  }

  const packageRoot = "sanitized/review-package";
  const scoringFile = await readEvaluatorOwnedRegular(
    run.root,
    `${packageRoot}/${reviewPackage?.scoringContract?.outputPath ?? ""}`,
  );
  if (!scoringFile.bytes || sha256(scoringFile.bytes) !== reviewPackage?.scoringContract?.outputSha256) {
    addIssue(issues, "review-package-scoring-bytes", "review package scoring-contract bytes are missing or changed", "reviewAudit.reviewPackage");
  }

  const evidenceIds = new Set();
  for (const evidence of reviewPackage.evidence ?? []) {
    if (evidenceIds.has(evidence.id)) {
      addIssue(issues, "review-package-duplicate-evidence", `review package repeats evidence ${evidence.id}`, "reviewAudit.reviewPackage");
      continue;
    }
    evidenceIds.add(evidence.id);
    const evidenceFile = await readEvaluatorOwnedRegular(run.root, `${packageRoot}/${evidence.outputPath ?? ""}`);
    if (
      !evidenceFile.bytes
      || evidenceFile.bytes.length !== evidence.bytes
      || sha256(evidenceFile.bytes) !== evidence.sha256
    ) {
      addIssue(issues, "review-package-evidence-bytes", `review package evidence is missing or changed: ${evidence.id}`, "reviewAudit.reviewPackage");
    }
  }

  const reviewerIds = new Set();
  const recordPaths = new Set();
  for (const recordRef of audit.records ?? []) {
    if (recordPaths.has(recordRef.path)) {
      addIssue(issues, "review-record-duplicate-path", `review audit repeats record path ${recordRef.path}`, "reviewAudit.records");
      continue;
    }
    recordPaths.add(recordRef.path);
    if (
      !/^[a-f0-9]{64}$/.test(recordRef.sha256 ?? "")
      || recordRef.path !== `sanitized/reviews/${recordRef.reviewerId}.json`
    ) {
      addIssue(issues, "review-record-reference", "review audit record must use its opaque reviewer ID as a canonical path and concrete hash", "reviewAudit.records");
      continue;
    }
    const recordFile = await readEvaluatorOwnedRegular(run.root, recordRef.path);
    if (!recordFile.bytes) {
      addIssue(issues, "review-record-unreadable", `review record is not an unchanged evaluator-owned regular file: ${recordRef.path}`, "reviewAudit.records");
      continue;
    }
    if (sha256(recordFile.bytes) !== recordRef.sha256) {
      addIssue(issues, "review-record-hash-mismatch", `stored review-record bytes do not match final evaluation audit: ${recordRef.path}`, "reviewAudit.records");
      continue;
    }
    let record;
    try {
      record = JSON.parse(recordFile.bytes.toString("utf8"));
    } catch {
      addIssue(issues, "review-record-json", `review record is not valid JSON: ${recordRef.path}`, "reviewAudit.records");
      continue;
    }
    issues.push(...validateReviewRecord(record));
    if (
      record.reviewerId !== recordRef.reviewerId
      || record.role !== recordRef.role
      || record.reviewPackage?.id !== packageRef.id
      || record.reviewPackage?.manifestSha256 !== packageRef.sha256
    ) {
      addIssue(issues, "review-record-binding", `review record does not bind its audited role, opaque ID, and review package: ${recordRef.path}`, "reviewAudit.records");
    }
    if (reviewerIds.has(record.reviewerId)) {
      addIssue(issues, "review-record-duplicate-reviewer", `review audit repeats reviewer ${record.reviewerId}`, "reviewAudit.records");
    }
    reviewerIds.add(record.reviewerId);
    for (const evidenceId of reviewEvidenceReferences(record)) {
      if (!evidenceIds.has(evidenceId)) {
        addIssue(issues, "review-record-unknown-evidence", `review record references evidence absent from the immutable package: ${evidenceId}`, "reviewAudit.records");
      }
    }
  }

  if (evaluation?.status === "admitted") {
    const roles = new Set((audit.records ?? []).map((record) => record.role));
    if (!roles.has("primary") || !roles.has("secondary")) {
      addIssue(issues, "review-record-required-roles", "an admitted result requires distinct primary and secondary sealed reviews", "reviewAudit.records");
    }
  }
  return issues;
}

/**
 * Validate the evaluator-owned side of a v4 run.  Candidate-owned bytes live
 * exclusively below `submitted/`; the only mutable evaluation state is the
 * run manifest plus the evaluator record beside it.  A pending record is
 * intentionally admissible while a run is being evaluated, but it is never
 * admissible for publication.
 */
export async function validateV4EvaluationStorage(
  run,
  {
    cohortManifest = null,
    requireFinalized = false,
  } = {},
) {
  const issues = [];
  const manifest = run?.manifest;
  if (manifest?.extensions?.protocolVersion !== "4.0") return issues;

  const evaluationPath = manifest.evaluation?.recordPath;
  const absoluteEvaluationPath = ensureInside(run.root, evaluationPath);
  if (!absoluteEvaluationPath) {
    addIssue(issues, "unsafe-evaluation-record", "v4 evaluation record path is unsafe", "evaluation.recordPath");
    return issues;
  }

  let evaluationBytes;
  let evaluation;
  try {
    evaluationBytes = await readFile(absoluteEvaluationPath);
    evaluation = JSON.parse(evaluationBytes.toString("utf8"));
  } catch {
    addIssue(issues, "missing-evaluation-record", "v4 run is missing a valid evaluator-owned evaluation record", "evaluation.recordPath");
    return issues;
  }

  issues.push(...validateEvaluationRecord(evaluation));
  if (
    evaluation.runId !== manifest.id
    || evaluation.evaluationContractDigest !== manifest.evaluation?.contractDigest
    || evaluation.scoringVersion !== manifest.evaluation?.scoringVersion
  ) {
    addIssue(issues, "evaluation-record-binding", "v4 evaluation record does not bind this run's frozen contract", "evaluation");
  }
  if (
    evaluation.candidateBundleSha256
    && evaluation.candidateBundleSha256 !== manifest.seal?.bundleSha256
  ) {
    addIssue(issues, "evaluation-bundle-binding", "v4 evaluation record does not bind the sealed candidate bundle", "candidateBundleSha256");
  }

  const finalization = evaluation.finalization;
  const runFinalization = manifest.extensions?.evaluationFinalization;
  const finalizedStatus = ["admitted", "artifact-invalid"].includes(evaluation.status);
  const pendingStatus = evaluation.status === "pending";
  if (!pendingStatus && !finalizedStatus) {
    addIssue(issues, "unfinalized-evaluation-record", "v4 evaluation record must be pending or finalized by the Stage 2 finalizer", "status");
    return issues;
  }

  if (pendingStatus) {
    if (finalization || runFinalization) {
      addIssue(issues, "pending-evaluation-finalization", "pending v4 evaluation record cannot carry finalization state", "finalization");
    }
    if (manifest.sanitization?.status !== "not-run") {
      addIssue(issues, "pending-evaluation-sanitization", "pending v4 evaluation requires evaluator sanitization state not-run", "sanitization.status");
    }
    if (requireFinalized) {
      addIssue(issues, "pending-evaluation-record", "publication requires a finalized v4 evaluation record", "evaluation.recordPath");
    }
    return issues;
  }

  if (
    evaluation.launchId !== manifest.launchId
    || evaluation.fairnessFingerprint !== manifest.fairnessFingerprint
  ) {
    addIssue(issues, "evaluation-record-binding", "finalized v4 evaluation record does not bind this run's launch and fairness fingerprint", "evaluation");
  }

  const expectedFinalization = {
    schemaVersion: "1.0",
    status: "finalized",
    runId: manifest.id,
    cohortId: manifest.cohortId,
    launchId: manifest.launchId,
    fairnessFingerprint: manifest.fairnessFingerprint,
    candidateBundleSha256: manifest.seal?.bundleSha256,
  };
  for (const [key, value] of Object.entries(expectedFinalization)) {
    if (finalization?.[key] !== value) {
      addIssue(issues, "evaluation-finalization-binding", `finalized evaluation is missing or mismatches ${key}`, `finalization.${key}`);
    }
  }
  if (!/^\d{4}-\d{2}-\d{2}T/.test(finalization?.finalizedAt ?? "")) {
    addIssue(issues, "evaluation-finalization-time", "finalized evaluation must record finalizedAt", "finalization.finalizedAt");
  }
  if (!/^[a-f0-9]{64}$/.test(finalization?.candidateSubmissionSha256 ?? "")) {
    addIssue(issues, "evaluation-submission-binding", "finalized evaluation must bind submitted/submission.json bytes", "finalization.candidateSubmissionSha256");
  }
  if (!/^[a-f0-9]{64}$/.test(finalization?.pendingRecordSha256 ?? "")) {
    addIssue(issues, "evaluation-pending-binding", "finalized evaluation must bind the pending evaluator record it replaced", "finalization.pendingRecordSha256");
  }
  if (!/^[a-f0-9]{64}$/.test(finalization?.sourceEvaluationSha256 ?? "")) {
    addIssue(issues, "evaluation-source-binding", "finalized evaluation must bind the evaluator result bytes used for finalization", "finalization.sourceEvaluationSha256");
  }
  if (cohortManifest) {
    if (
      cohortManifest.id !== manifest.cohortId
      || cohortManifest.launchId !== manifest.launchId
      || cohortManifest.fairnessFingerprint !== manifest.fairnessFingerprint
      || !cohortManifest.candidateIds?.includes(manifest.id)
    ) {
      addIssue(issues, "evaluation-cohort-binding", "finalized evaluation does not bind a matching cohort membership", "finalization.cohortId");
    }
  }
  if (
    canonicalJson(evaluation.sanitization) !== canonicalJson(manifest.sanitization)
    || !["passed", "failed"].includes(manifest.sanitization?.status)
  ) {
    addIssue(issues, "evaluation-sanitization-binding", "finalized evaluation and run sanitization states must match and be conclusive", "sanitization");
  }
  issues.push(...await validateV4SanitizationReport(run, manifest.sanitization));
  const recordSha256 = sha256(evaluationBytes);
  if (
    runFinalization?.status !== "finalized"
    || runFinalization?.recordSha256 !== recordSha256
    || runFinalization?.candidateBundleSha256 !== manifest.seal?.bundleSha256
    || runFinalization?.candidateSubmissionSha256 !== finalization?.candidateSubmissionSha256
    || runFinalization?.finalizedAt !== finalization?.finalizedAt
  ) {
    addIssue(issues, "run-evaluation-finalization", "run.json must attest the exact finalized evaluator record and candidate bytes", "extensions.evaluationFinalization");
  }

  const submissionPath = ensureInside(run.root, `${manifest.seal?.bundlePath}/submission.json`);
  try {
    const actualSubmissionSha256 = sha256(await readFile(submissionPath));
    if (actualSubmissionSha256 !== finalization?.candidateSubmissionSha256) {
      addIssue(issues, "evaluation-submission-bytes-mismatch", "finalized evaluation does not bind the currently stored candidate submission bytes", "finalization.candidateSubmissionSha256");
    }
  } catch {
    addIssue(issues, "evaluation-submission-unreadable", "cannot read candidate submission bytes required by finalized evaluation", "finalization.candidateSubmissionSha256");
  }
  issues.push(...await validateReviewAuditStorage(run, evaluation));
  return issues;
}

/**
 * Verify the evaluator-owned report and copied static artifacts attached to a
 * conclusive v4 sanitization attestation.  No candidate content is executed:
 * this only lstat()s and hashes bytes below the evaluator-owned output root.
 */
export async function validateV4SanitizationReport(run, attestation = run?.manifest?.sanitization) {
  const issues = [];
  const manifest = run?.manifest;
  if (!manifest || !["passed", "failed"].includes(attestation?.status)) return issues;
  const declaration = attestation.report;
  const reportPath = ensureInside(run.root, declaration?.path);
  if (!reportPath || isPathUnderBundle(manifest.seal?.bundlePath, declaration?.path)) {
    addIssue(issues, "unsafe-sanitization-report", "sanitization report must be evaluator-owned and outside submitted/", "sanitization.report.path");
    return issues;
  }
  let reportBytes;
  let report;
  try {
    const info = await lstat(reportPath);
    if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
    reportBytes = await readFile(reportPath);
    report = JSON.parse(reportBytes.toString("utf8"));
  } catch {
    addIssue(issues, "sanitization-report-unreadable", "sanitization report is missing, invalid, or not a regular file", "sanitization.report.path");
    return issues;
  }
  issues.push(...validateSanitizationReport(report));
  if (sha256(reportBytes) !== declaration?.sha256) {
    addIssue(issues, "sanitization-report-hash", "sanitization report bytes do not match the attestation", "sanitization.report.sha256");
  }
  if (
    report.runId !== manifest.id
    || report.status !== attestation.status
    || report.bundle?.path !== manifest.seal?.bundlePath
    || report.bundle?.sha256 !== manifest.seal?.bundleSha256
    || report.launch?.id !== manifest.launchId
    || report.launch?.digest !== manifest.launchDigest
    || report.launch?.fairnessFingerprint !== manifest.fairnessFingerprint
    || report.packet?.id !== manifest.benchmarkId
    || report.packet?.version !== manifest.benchmarkVersion
    || report.packet?.digest !== manifest.taskPacketDigest
    || report.packet?.bundleDigest !== manifest.taskPacketBundleDigest
    || report.sanitizationProfile?.digest !== attestation.profileDigest
    || report.sanitizationProfile?.sha256 !== attestation.profileDigest
    || report.executionContract?.digest !== manifest.executionContractDigest
    || report.tool?.name !== "stage2-sanitize"
    || report.tool?.sourceSha256 !== report.executionContract?.sanitizerSha256
    || report.outputRoot !== path.posix.dirname(declaration.path)
    || declaration.path !== `${report.outputRoot}/sanitization-report.json`
  ) {
    addIssue(issues, "sanitization-report-binding", "sanitization report does not bind the sealed run, frozen contracts, or evaluator output location", "sanitization.report");
  }
  const reportedIds = new Set();
  const expectedById = new Map((manifest.artifacts ?? []).map((artifact) => [artifact.id, artifact]));
  for (const artifact of report.artifacts ?? []) {
    if (reportedIds.has(artifact.id)) {
      addIssue(issues, "sanitization-report-duplicate-artifact", `sanitization report repeats artifact ${artifact.id}`, "sanitization.report");
      continue;
    }
    reportedIds.add(artifact.id);
    const expected = expectedById.get(artifact.id);
    const expectedPath = expected?.path?.startsWith(`${manifest.seal?.bundlePath}/`)
      ? expected.path.slice(manifest.seal.bundlePath.length + 1)
      : null;
    if (
      !expected
      || !expectedPath
      || artifact.path !== expectedPath
      || artifact.mediaType !== expected.mediaType
      || artifact.inputSha256 !== expected.sha256
      || artifact.outputSha256 !== artifact.inputSha256
      || artifact.outputPath !== `${report.outputRoot}/artifacts/${artifact.path}`
    ) {
      addIssue(issues, "sanitization-artifact-binding", `sanitized artifact ${artifact.id} does not bind its sealed declaration`, "sanitization.report");
      continue;
    }
    const copiedPath = ensureInside(run.root, artifact.outputPath);
    if (!copiedPath || !copiedPath.startsWith(`${ensureInside(run.root, report.outputRoot)}${path.sep}`)) {
      addIssue(issues, "sanitization-output-path", `sanitized artifact ${artifact.id} has an unsafe evaluator output path`, "sanitization.report");
      continue;
    }
    try {
      const info = await lstat(copiedPath);
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("not a regular file");
      if (sha256(await readFile(copiedPath)) !== artifact.outputSha256) throw new Error("hash mismatch");
    } catch {
      addIssue(issues, "sanitization-output-hash", `sanitized artifact ${artifact.id} is missing, unsafe, or changed`, "sanitization.report");
    }
  }
  const expectedIds = [...expectedById.keys()].sort();
  const attestedIds = [...(attestation.sanitizedArtifactIds ?? [])].sort();
  const reportedIdList = [...reportedIds].sort();
  if (canonicalJson(attestedIds) !== canonicalJson(reportedIdList)) {
    addIssue(issues, "sanitization-attested-artifacts", "sanitization attestation IDs do not match the evaluator-owned report", "sanitization.sanitizedArtifactIds");
  }
  if (attestation.status === "passed") {
    if (canonicalJson(expectedIds) !== canonicalJson(reportedIdList) || (report.issues ?? []).length !== 0) {
      addIssue(issues, "sanitization-passed-coverage", "passed sanitization must admit every sealed declared artifact with no issues", "sanitization.report");
    }
  } else if (reportedIdList.length !== 0) {
    addIssue(issues, "sanitization-failed-output", "failed sanitization may not expose admitted artifact copies", "sanitization.report");
  }
  return issues;
}

async function validatePublicationAttestation(run, local, checks) {
  const declaration = run.manifest.publicationReport;
  if (!declaration) {
    addIssue(
      local,
      "missing-publication-report",
      "published run must reference its immutable publication report",
      "publicationReport",
    );
    return;
  }
  await validateDeclaredFile(
    run.root,
    declaration,
    "publication report",
    local,
    checks,
  );
  let report;
  try {
    report = await readJson(ensureInside(run.root, declaration.path));
  } catch {
    addIssue(
      local,
      "invalid-publication-report",
      "publication report is not valid JSON",
      declaration.path,
    );
    return;
  }
  const reportProblems = validateReport(report);
  const sealAttestation = report.checks?.some(
    (entry) =>
      entry.name === "Sealed candidate bundle"
      && entry.status === "pass"
      && entry.inputSha256 === run.manifest.seal?.bundleSha256,
  );
  if (
    reportProblems.length > 0
    || report.runId !== run.manifest.id
    || report.status !== "valid"
    || report.issues?.length !== 0
    || report.checks?.some((entry) => entry.status === "fail")
    || !sealAttestation
  ) {
    addIssue(
      local,
      "invalid-publication-report",
      "publication report does not attest a successful validation of this sealed run",
      declaration.path,
    );
    return;
  }
  run.publicationReportContent = report;
}

async function loadManifest(root, directory, name) {
  const entryRoot = path.join(root, directory);
  const manifestPath = path.join(entryRoot, name);
  try {
    return {
      directory,
      root: entryRoot,
      manifest: await readJson(manifestPath),
      loadIssues: [],
    };
  } catch (error) {
    const code = error && typeof error === "object" && error.code === "ENOENT"
      ? "missing-manifest"
      : "invalid-json";
    return {
      directory,
      root: entryRoot,
      manifest: null,
      loadIssues: [{
        code,
        message: `${name} ${code === "missing-manifest" ? "is missing" : "is not valid JSON"}`,
        path: name,
      }],
    };
  }
}

async function readOptionalJson(filePath) {
  try {
    return { value: await readJson(filePath), issues: [] };
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { value: null, issues: [] };
    }
    return {
      value: null,
      issues: [{
        code: "invalid-json",
        message: `${path.basename(filePath)} is not valid JSON`,
        path: path.basename(filePath),
      }],
    };
  }
}

async function loadV2GrandfatherRegistry(projectRoot) {
  const registryPath = path.join(projectRoot, "legacy-v2-grandfather.json");
  const loaded = await readOptionalJson(registryPath);
  if (!loaded.value) {
    return { entries: [], issues: loaded.issues };
  }
  const registry = loaded.value;
  const issues = [...loaded.issues];
  const validEntry = (entry) =>
    entry
    && typeof entry === "object"
    && Object.keys(entry).sort().join(",") === "launch,taskPacket"
    && entry.taskPacket
    && typeof entry.taskPacket.id === "string"
    && typeof entry.taskPacket.version === "string"
    && /^[a-f0-9]{64}$/.test(entry.taskPacket.digest)
    && entry.launch
    && typeof entry.launch.id === "string"
    && /^[a-f0-9]{64}$/.test(entry.launch.fairnessFingerprint);
  if (
    !registry
    || registry.schemaVersion !== "1.0"
    || registry.status !== "immutable"
    || !Array.isArray(registry.entries)
    || Object.keys(registry).sort().join(",") !== "entries,schemaVersion,status"
    || registry.entries.some((entry) => !validEntry(entry))
  ) {
    issues.push({
      code: "invalid-v2-grandfather-registry",
      message: "legacy-v2-grandfather.json must be an explicit immutable registry of exact packet and launch identities",
      path: "legacy-v2-grandfather.json",
    });
    return { entries: [], issues };
  }
  return { entries: registry.entries, issues };
}

function isV2PacketGrandfathered(entries, packet) {
  const packetDigest = manifestDigest(packet);
  return entries.some((entry) =>
    entry.taskPacket.id === packet.id
    && entry.taskPacket.version === packet.version
    && entry.taskPacket.digest === packetDigest,
  );
}

function isV2LaunchGrandfathered(entries, launch) {
  return entries.some((entry) =>
    entry.taskPacket.id === launch.taskPacket?.id
    && entry.taskPacket.version === launch.taskPacket?.version
    && entry.taskPacket.digest === launch.taskPacket?.digest
    && entry.launch.id === launch.id
    && entry.launch.fairnessFingerprint === launch.fairnessFingerprint,
  );
}

async function loadTaskPacketVersions(taskPacketsRoot) {
  const packetIds = await listContentDirectories(taskPacketsRoot);
  const entries = [];
  for (const packetId of packetIds) {
    const packetIdRoot = path.join(taskPacketsRoot, packetId);
    if (await pathExists(path.join(packetIdRoot, "packet.json"))) {
      const legacy = await loadManifest(taskPacketsRoot, packetId, "packet.json");
      legacy.packetId = packetId;
      legacy.packetVersion = legacy.manifest?.version ?? null;
      legacy.layout = "legacy-flat";
      entries.push(legacy);
    }
    for (const version of await listContentDirectories(packetIdRoot)) {
      const directory = `${packetId}/${version}`;
      const entry = await loadManifest(taskPacketsRoot, directory, "packet.json");
      entry.packetId = packetId;
      entry.packetVersion = version;
      entry.layout = "versioned";
      const lock = await readOptionalJson(path.join(entry.root, "packet-lock.json"));
      const task = await readOptionalJson(path.join(entry.root, "task.json"));
      entry.lock = lock.value;
      entry.taskDefinition = task.value;
      entry.loadIssues.push(...lock.issues, ...task.issues);
      entries.push(entry);
    }
  }
  return entries.sort((left, right) =>
    `${left.packetId}@${left.packetVersion ?? ""}`.localeCompare(
      `${right.packetId}@${right.packetVersion ?? ""}`,
    ));
}

export async function loadFramework(projectRoot) {
  const benchmarksRoot = path.join(projectRoot, "benchmarks");
  const taskPacketsRoot = path.join(projectRoot, "task-packets");
  const launchesRoot = path.join(projectRoot, "launches");
  const cohortsRoot = path.join(projectRoot, "cohorts");
  const runsRoot = path.join(projectRoot, "runs");
  const benchmarkDirectories = await listContentDirectories(benchmarksRoot);
  const launchDirectories = await listContentDirectories(launchesRoot);
  const cohortDirectories = await listContentDirectories(cohortsRoot);
  const runDirectories = await listContentDirectories(runsRoot);
  return {
    benchmarks: await Promise.all(
      benchmarkDirectories.map((directory) =>
        loadManifest(benchmarksRoot, directory, "benchmark.json"),
      ),
    ),
    taskPackets: await loadTaskPacketVersions(taskPacketsRoot),
    launches: await Promise.all(
      launchDirectories.map(async (directory) => {
        const entry = await loadManifest(launchesRoot, directory, "launch.json");
        const release = await readOptionalJson(path.join(entry.root, "release.json"));
        const verification = await readOptionalJson(
          path.join(entry.root, "live-verification.json"),
        );
        entry.release = release.value;
        entry.liveVerification = verification.value;
        entry.loadIssues.push(...release.issues, ...verification.issues);
        return entry;
      }),
    ),
    cohorts: await Promise.all(
      cohortDirectories.map((directory) =>
        loadManifest(cohortsRoot, directory, "cohort.json"),
      ),
    ),
    runs: await Promise.all(
      runDirectories.map((directory) => loadManifest(runsRoot, directory, "run.json")),
    ),
  };
}

async function validateDeclaredFile(root, declaration, label, local, checks = null) {
  const candidate = ensureInside(root, declaration.path);
  if (!candidate) {
    addIssue(local, "unsafe-path", `${label} path is unsafe`, declaration.path);
    return;
  }
  let stats;
  try {
    stats = await lstat(candidate);
  } catch {
    addIssue(local, "missing-file", `${label} is missing`, declaration.path);
    return;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    addIssue(local, "file-not-regular", `${label} must be a regular file`, declaration.path);
    return;
  }
  try {
    const [resolvedRoot, resolvedFile] = await Promise.all([
      realpath(root),
      realpath(candidate),
    ]);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      addIssue(local, "file-escape", `${label} resolves outside its content directory`, declaration.path);
      return;
    }
  } catch {
    addIssue(local, "file-realpath", `${label} real path cannot be resolved`, declaration.path);
    return;
  }
  const actual = sha256(await readFile(candidate));
  if (actual !== declaration.sha256) {
    addIssue(local, "hash-mismatch", `${label} SHA-256 does not match`, declaration.path);
  } else if (checks) {
    checks.push(check(`Hash ${label}`, "pass", "SHA-256 matches", { inputSha256: actual }));
  }
}

function addIssue(target, code, message, issuePath) {
  target.push({ code, message, ...(issuePath ? { path: issuePath } : {}) });
}

function check(name, status, detail, extra = {}) {
  return { name, status, ...(detail ? { detail } : {}), ...extra };
}

async function validateArtifactFile(run, artifact, localIssues, checks) {
  const candidate = ensureInside(run.root, artifact.path);
  if (!candidate) {
    addIssue(localIssues, "unsafe-path", `artifact ${artifact.id} path is unsafe`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", "Path is not a safe relative file path", { artifactId: artifact.id }));
    return;
  }

  let stats;
  try {
    stats = await lstat(candidate);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact cannot be read";
    addIssue(localIssues, "missing-artifact", `artifact ${artifact.id} is missing`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
    return;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    addIssue(localIssues, "artifact-not-file", `artifact ${artifact.id} must be a regular file`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", "Artifact is not a regular file", { artifactId: artifact.id }));
    return;
  }

  try {
    const [resolvedRunRoot, resolvedArtifact] = await Promise.all([
      realpath(run.root),
      realpath(candidate),
    ]);
    if (!resolvedArtifact.startsWith(`${resolvedRunRoot}${path.sep}`)) {
      addIssue(localIssues, "artifact-escape", `artifact ${artifact.id} resolves outside the run directory`, artifact.path);
      checks.push(check(`Path ${artifact.id}`, "fail", "Resolved path escapes the run directory", { artifactId: artifact.id }));
      return;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact real path cannot be resolved";
    addIssue(localIssues, "artifact-realpath", `artifact ${artifact.id} real path cannot be resolved`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
    return;
  }

  checks.push(check(`Path ${artifact.id}`, "pass", "Regular file resolves inside the run directory", { artifactId: artifact.id }));
  try {
    const actualHash = sha256(await readFile(candidate));
    if (actualHash !== artifact.sha256) {
      addIssue(localIssues, "hash-mismatch", `artifact ${artifact.id} SHA-256 does not match`, artifact.path);
      checks.push(check(`Hash ${artifact.id}`, "fail", "Declared and actual SHA-256 differ", { artifactId: artifact.id, inputSha256: actualHash }));
    } else {
      checks.push(check(`Hash ${artifact.id}`, "pass", "SHA-256 matches the manifest", { artifactId: artifact.id, inputSha256: actualHash }));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact hash cannot be calculated";
    addIssue(localIssues, "hash-read-failed", `artifact ${artifact.id} cannot be hashed`, artifact.path);
    checks.push(check(`Hash ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
  }
}

export async function validateFramework(projectRoot) {
  const {
    benchmarks,
    taskPackets,
    launches,
    cohorts,
    runs,
  } = await loadFramework(projectRoot);
  const v2GrandfatherRegistry = await loadV2GrandfatherRegistry(projectRoot);
  const issues = [];
  issues.push(...v2GrandfatherRegistry.issues.map((entry) => ({
    scope: "legacy-v2-grandfather.json",
    ...entry,
  })));
  const benchmarkIds = new Set();
  const packetIds = new Set();
  const launchIds = new Set();
  const cohortIds = new Set();
  const runIds = new Set();
  const benchmarksById = new Map();
  const packetsById = new Map();
  const cohortsById = new Map();

  for (const benchmark of benchmarks) {
    const local = [...benchmark.loadIssues];
    if (benchmark.manifest) {
      local.push(...validateBenchmark(benchmark.manifest));
      if (benchmark.manifest.id !== benchmark.directory) {
        addIssue(local, "directory-id", "benchmark directory and id must match", "id");
      }
      if (benchmarkIds.has(benchmark.manifest.id)) {
        addIssue(local, "duplicate-id", "benchmark id is duplicated", "id");
      }
      benchmarkIds.add(benchmark.manifest.id);
      benchmarksById.set(benchmark.manifest.id, benchmark.manifest);
    }
    benchmark.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `benchmarks/${benchmark.directory}`, ...entry })));
  }

  for (const packet of taskPackets) {
    const local = [...packet.loadIssues];
    if (packet.taskDefinition) {
      local.push(...validateTaskDefinition(packet.taskDefinition));
      if (
        packet.taskDefinition.id !== packet.packetId
        || packet.taskDefinition.version !== packet.packetVersion
      ) {
        addIssue(
          local,
          "directory-id",
          "task definition id/version must match its versioned directory",
          "id",
        );
      }
    }
    if (packet.manifest) {
      local.push(...validateTaskPacket(packet.manifest));
      if (
        packet.manifest.id !== packet.packetId
        || (packet.layout === "versioned" && packet.manifest.version !== packet.packetVersion)
      ) {
        addIssue(local, "directory-id", "task packet id/version and directory must match", "id");
      }
      const packetKey = `${packet.manifest.id}@${packet.manifest.version}`;
      if (packetIds.has(packetKey)) {
        addIssue(local, "duplicate-id", "task packet id/version is duplicated", "id");
      }
      packetIds.add(packetKey);
      packetsById.set(packetKey, packet);
      packet.v2Grandfathered = packet.manifest.schemaVersion !== "1.0"
        || isV2PacketGrandfathered(v2GrandfatherRegistry.entries, packet.manifest);
      if (packet.manifest.schemaVersion === "1.0" && !packet.v2Grandfathered) {
        addIssue(
          local,
          "v2-not-grandfathered",
          "Protocol v2 task packets are read-only legacy records and require an exact immutable grandfather registry entry",
          "schemaVersion",
        );
      }
      const benchmark = benchmarksById.get(packet.manifest.id);
      if (!benchmark) {
        addIssue(local, "unknown-benchmark", "task packet id does not name a benchmark", "id");
      }
      if (validateTaskPacket(packet.manifest).length === 0) {
        await validateDeclaredFile(packet.root, packet.manifest.instructions, "task instructions", local);
        for (const input of packet.manifest.inputs) {
          await validateDeclaredFile(packet.root, input, `task input ${input.id}`, local);
        }
      }
    }
    const frozenCurrent = ["3.0", "4.0"].includes(packet.manifest?.schemaVersion) && packet.lock;
    if (frozenCurrent) {
      const { validateFrozenPacket } = await import("./stage0-lib.mjs");
      const frozen = await validateFrozenPacket(packet.root);
      local.push(...frozen.issues);
    }
    const draftCurrent = packet.layout === "versioned" && !packet.lock;
    packet.stage0Issues = local;
    packet.validationIssues = draftCurrent ? [] : local;
    if (!draftCurrent) {
      issues.push(...local.map((entry) => ({
        scope: `task-packets/${packet.directory}`,
        ...entry,
      })));
    }
  }

  for (const launch of launches) {
    const local = [...launch.loadIssues];
    if (launch.manifest) {
      local.push(...validateLaunch(launch.manifest));
      if (launch.manifest.id !== launch.directory) {
        addIssue(local, "directory-id", "launch directory and id must match", "id");
      }
      if (launchIds.has(launch.manifest.id)) {
        addIssue(local, "duplicate-id", "launch id is duplicated", "id");
      }
      launchIds.add(launch.manifest.id);
      const v2RegistryMatched = isV2LaunchGrandfathered(
        v2GrandfatherRegistry.entries,
        launch.manifest,
      );
      launch.v2Grandfathered = launch.manifest.protocolVersion !== "2.0";
      const packet = packetsById.get(
        `${launch.manifest.taskPacket?.id}@${launch.manifest.taskPacket?.version}`,
      );
      if (!packet?.manifest) {
        addIssue(local, "unknown-task-packet", "launch taskPacket.id does not exist", "taskPacket.id");
      } else {
        if (packet.validationIssues.length > 0) {
          addIssue(local, "invalid-task-packet", "launch references an invalid task packet", "taskPacket.id");
        }
        if (manifestDigest(packet.manifest) !== launch.manifest.taskPacket.digest) {
          addIssue(local, "task-packet-digest-mismatch", "launch task packet digest does not match", "taskPacket.digest");
        }
        if (
          ["3.0", "4.0"].includes(launch.manifest.protocolVersion)
          && packet.lock?.bundleDigest !== launch.manifest.taskPacket.bundleDigest
        ) {
          addIssue(
            local,
            "task-packet-bundle-digest-mismatch",
            "launch task packet bundle digest does not match its lock",
            "taskPacket.bundleDigest",
          );
        }
        if (launch.manifest.protocolVersion === "2.0") {
          launch.v2Grandfathered = (
            v2RegistryMatched
            && packet.layout === "legacy-flat"
            && packet.manifest.schemaVersion === "1.0"
            && packet.v2Grandfathered === true
          );
          if (!launch.v2Grandfathered) {
            addIssue(
              local,
              "v2-hybrid-packet",
              "Protocol v2 launches require an exact registry match and a grandfathered legacy-flat v2 packet",
              "taskPacket",
            );
          }
        }
        if (
          ["3.0", "4.0"].includes(launch.manifest.protocolVersion)
          && (
            packet.layout !== "versioned"
            || packet.manifest.schemaVersion !== launch.manifest.protocolVersion
            || !packet.lock
            || packet.stage0Issues?.length > 0
          )
        ) {
          addIssue(
            local,
            "current-packet-not-frozen",
            "Current protocol launches require a clean locked versioned packet of the same version",
            "taskPacket",
          );
        }
      }
      if (
        launch.manifest.protocolVersion === "2.0"
        && !launch.v2Grandfathered
        && !local.some(({ code }) => code === "v2-hybrid-packet")
      ) {
        addIssue(
          local,
          "v2-not-grandfathered",
          "Protocol v2 launches are read-only legacy records and require an exact immutable grandfather registry entry",
          "protocolVersion",
        );
      }
      if (
        validateLaunch(launch.manifest).length === 0
        && computeFairnessFingerprint(launch.manifest) !== launch.manifest.fairnessFingerprint
      ) {
        addIssue(local, "fairness-fingerprint-mismatch", "launch fairness fingerprint does not match its common inputs", "fairnessFingerprint");
      }
    }
    const isCurrent = ["3.0", "4.0"].includes(launch.manifest?.protocolVersion);
    if (isCurrent) {
      if (!launch.release) {
        addIssue(local, "missing-release", "Stage 1 v3 launch requires release.json", "release.json");
      } else {
        local.push(...validateLaunchRelease(launch.release));
        if (
          launch.release.launchId !== launch.manifest.id
          || launch.release.launchDigest !== launch.manifest.launchDigest
          || launch.release.packetDigest !== launch.manifest.taskPacket.digest
          || launch.release.packetBundleDigest !== launch.manifest.taskPacket.bundleDigest
          || launch.release.executionContractDigest !== launch.manifest.executionContractDigest
          || launch.release.canonicalBaseUrl !== launch.manifest.canonicalBaseUrl
          || launch.release.promptSha256 !== launch.manifest.promptSha256
        ) {
          addIssue(local, "release-binding-mismatch", "release.json does not bind launch.json");
        }
        const { validateLaunchFreeze } = await import("./stage0-lib.mjs");
        const frozen = await validateLaunchFreeze(projectRoot, launch.directory);
        // Retain the byte-verified profile only in this in-memory validation
        // result. Post-review publication reads the official repeat count from
        // this frozen launch record; it must never consult a mutable profile.
        launch.profile = frozen.profile ?? null;
        local.push(...frozen.issues);
        if (["approved", "release-ready", "live-verified", "retired"].includes(
          launch.release.status,
        )) {
          const { validateReviews } = await import("./stage0-lib.mjs");
          const reviewed = await validateReviews(projectRoot, launch.directory);
          local.push(...reviewed.issues);
        }
        if (launch.release.status === "live-verified") {
          if (!launch.liveVerification) {
            addIssue(local, "missing-live-verification", "live-verified launch requires live-verification.json");
          } else {
            local.push(...validateLiveVerification(launch.liveVerification));
            const { validateLiveVerificationBindings } =
              await import("./stage0-lib.mjs");
            local.push(...await validateLiveVerificationBindings(
              launch.root,
              launch.manifest,
              launch.liveVerification,
            ));
            if (
              manifestDigest(launch.liveVerification)
              !== launch.release.liveVerificationDigest
            ) {
              addIssue(local, "live-verification-digest-mismatch", "live verification digest differs from release");
            }
          }
        }
      }
    }
    launch.publicEligible = isCurrent
      ? ["release-ready", "live-verified"].includes(launch.release?.status)
      : launch.v2Grandfathered === true;
    launch.stage0Issues = local;
    launch.validationIssues = isCurrent && !launch.publicEligible ? [] : local;
    if (!isCurrent || launch.publicEligible) {
      issues.push(...local.map((entry) => ({ scope: `launches/${launch.directory}`, ...entry })));
    }
  }

  for (const cohort of cohorts) {
    const local = [...cohort.loadIssues];
    if (cohort.manifest) {
      local.push(...validateCohort(cohort.manifest));
      if (cohort.manifest.id !== cohort.directory) {
        addIssue(local, "directory-id", "cohort directory and id must match", "id");
      }
      if (cohortIds.has(cohort.manifest.id)) {
        addIssue(local, "duplicate-id", "cohort id is duplicated", "id");
      }
      cohortIds.add(cohort.manifest.id);
      cohortsById.set(cohort.manifest.id, cohort);
      const launch = launches.find(
        (entry) => entry.manifest?.id === cohort.manifest.launchId,
      );
      if (!launch?.manifest) {
        addIssue(local, "unknown-launch", "cohort launchId does not exist", "launchId");
      } else {
        if (launch.validationIssues.length > 0) {
          addIssue(local, "invalid-launch", "cohort references an invalid launch", "launchId");
        }
        if (
          ["3.0", "4.0"].includes(launch.manifest.protocolVersion)
          && launch.release?.status !== "live-verified"
        ) {
          addIssue(
            local,
            "cohort-launch-not-live-verified",
            "Current-protocol cohorts require a live-verified launch",
            "launchId",
          );
        }
        if (
          launch.manifest.fairnessFingerprint
          !== cohort.manifest.fairnessFingerprint
        ) {
          addIssue(
            local,
            "cohort-fingerprint-mismatch",
            "cohort fairness fingerprint does not match its launch",
            "fairnessFingerprint",
          );
        }
      }
      if (cohort.manifest.extensions?.protocolVersion === "4.0") {
        const conditionsRef = cohort.manifest.extensions?.measurementConditions;
        const conditionsPath = ensureInside(cohort.root, conditionsRef?.path ?? "");
        let conditions = null;
        if (!conditionsPath || conditionsRef?.path !== "measurement-conditions.json") {
          addIssue(local, "cohort-measurement-conditions", "v4 cohort must bind a safe measurement-conditions.json", "extensions.measurementConditions");
        } else {
          try {
            const bytes = await readFile(conditionsPath);
            if (sha256(bytes) !== conditionsRef.sha256) {
              addIssue(local, "cohort-measurement-conditions-hash", "measurement conditions do not match the opening hash", "extensions.measurementConditions.sha256");
            }
            conditions = JSON.parse(bytes.toString("utf8"));
            local.push(...validateMeasurementConditions(conditions));
          } catch {
            addIssue(local, "cohort-measurement-conditions", "v4 cohort measurement conditions are unreadable", "extensions.measurementConditions");
          }
        }
        if (conditions) {
          if (
            conditions.launchId !== cohort.manifest.launchId
            || canonicalJson(conditions.candidateRunIds) !== canonicalJson(cohort.manifest.candidateIds)
            || (launch?.manifest && (
              conditions.launchDigest !== launch.manifest.launchDigest
              || conditions.fairnessFingerprint !== launch.manifest.fairnessFingerprint
              || conditions.executionProfileDigest !== launch.manifest.executionProfile?.digest
            ))
          ) {
            addIssue(local, "cohort-measurement-conditions-binding", "measurement conditions do not exactly bind the cohort and launch", "measurement-conditions.json");
          }
          if (Date.parse(conditions.frozenAt) > Date.parse(cohort.manifest.openedAt)) {
            addIssue(local, "cohort-freeze-after-open", "measurement conditions frozenAt must be at or before cohort openedAt", "openedAt");
          }
          const officialRepeatCount = launch?.profile?.extensions?.officialRepeatCountPerModel;
          if (
            !Number.isInteger(officialRepeatCount)
            || officialRepeatCount < 1
            || conditions.repetitionPolicy.runsPerModel !== officialRepeatCount
            || conditions.modelGroups.some((group) => group.runIds.length !== officialRepeatCount)
          ) {
            addIssue(
              local,
              "cohort-official-repeat-policy",
              "measurement conditions must retain the exact official repeat count from the frozen execution profile",
              "measurement-conditions.json",
            );
          }
          cohort.measurementConditions = conditions;
        }
        const postReview = cohort.manifest.extensions?.postReview;
        const disclosurePath = path.join(cohort.root, "cohort-disclosure.json");
        const aggregatePath = path.join(cohort.root, "cohort-evaluation-aggregate.json");
        if (cohort.manifest.status === "open") {
          if (postReview || await pathExists(disclosurePath) || await pathExists(aggregatePath)) {
            addIssue(local, "premature-post-review-disclosure", "model disclosure and aggregate are operator-owned publication outputs and cannot exist in an open cohort", "extensions.postReview");
          }
        } else if (
          !postReview
          || postReview.disclosure?.path !== "cohort-disclosure.json"
          || postReview.aggregate?.path !== "cohort-evaluation-aggregate.json"
          || !/^[a-f0-9]{64}$/.test(postReview.disclosure?.sha256 ?? "")
          || !/^[a-f0-9]{64}$/.test(postReview.aggregate?.sha256 ?? "")
        ) {
          addIssue(local, "missing-post-review-publication", "published v4 cohort must hash-bind disclosure and aggregate files", "extensions.postReview");
        }
      }
    }
    cohort.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `cohorts/${cohort.directory}`, ...entry })));
  }

  const candidateMemberships = new Map();
  for (const cohort of cohorts) {
    const candidateIds = Array.isArray(cohort.manifest?.candidateIds)
      ? cohort.manifest.candidateIds
      : [];
    for (const candidateId of candidateIds) {
      const memberships = candidateMemberships.get(candidateId) ?? [];
      memberships.push(cohort);
      candidateMemberships.set(candidateId, memberships);
    }
  }
  for (const [candidateId, memberships] of candidateMemberships) {
    if (memberships.length < 2) continue;
    for (const cohort of memberships) {
      const issue = {
        code: "duplicate-cohort-member",
        message: `candidate ${candidateId} belongs to more than one cohort`,
        path: "candidateIds",
      };
      cohort.validationIssues.push(issue);
      issues.push({ scope: `cohorts/${cohort.directory}`, ...issue });
    }
  }

  for (const run of runs) {
    const local = [...run.loadIssues];
    const checks = [];
    if (!run.manifest) {
      checks.push(check("Run manifest", "fail", "run.json could not be loaded"));
    } else {
      const launch = launches.find(
        (entry) => entry.manifest?.id === run.manifest.launchId,
      );
      let contractValidators = null;
      if (
        ["3.0", "4.0"].includes(launch?.manifest?.protocolVersion)
        && launch.validationIssues.length === 0
      ) {
        try {
          contractValidators = await loadFrozenContractValidators(
            path.join(launch.root, "execution-contract"),
            { runSchemaPath: path.join(projectRoot, "schemas", "run.schema.json") },
          );
        } catch (error) {
          addIssue(
            local,
            "frozen-contract-validator",
            error instanceof Error
              ? error.message
              : "Frozen execution contract validators could not be loaded",
            "launchId",
          );
        }
      }
      const schemaProblems = (
        contractValidators?.validateRun ?? validateRun
      )(run.manifest);
      local.push(...schemaProblems);
      checks.push(check(
        "Run manifest",
        schemaProblems.length === 0 ? "pass" : "fail",
        schemaProblems.length === 0 ? "Draft 2020-12 schema validation passed" : `${schemaProblems.length} schema issue(s)`,
      ));
      if (run.manifest.id !== run.directory) {
        addIssue(local, "directory-id", "run directory and id must match", "id");
      }
      if (runIds.has(run.manifest.id)) {
        addIssue(local, "duplicate-id", "run id is duplicated", "id");
      }
      runIds.add(run.manifest.id);
      const benchmark = benchmarksById.get(run.manifest.benchmarkId);
      if (!benchmark) {
        addIssue(local, "unknown-benchmark", "benchmarkId does not name a checked-in benchmark", "benchmarkId");
        checks.push(check("Benchmark reference", "fail", "Referenced benchmark does not exist"));
      } else {
        checks.push(check("Benchmark reference", "pass", `${benchmark.id} is registered`));
      }
      if (!launch?.manifest) {
        addIssue(local, "unknown-launch", "launchId does not name a checked-in launch", "launchId");
      } else {
        if (launch.validationIssues.length > 0) {
          addIssue(local, "invalid-launch", "launchId names an invalid launch", "launchId");
        }
        if (
          ["3.0", "4.0"].includes(launch.manifest.protocolVersion)
          && launch.release?.status !== "live-verified"
        ) {
          addIssue(
            local,
            "launch-not-live-verified",
            "Current-protocol runs require a live-verified launch",
            "launchId",
          );
        }
        if (launch.manifest.fairnessFingerprint !== run.manifest.fairnessFingerprint) {
          addIssue(local, "run-fingerprint-mismatch", "run fairness fingerprint does not match the launch", "fairnessFingerprint");
        }
        if (
          launch.manifest.taskPacket.id !== run.manifest.benchmarkId
          || launch.manifest.taskPacket.version !== run.manifest.benchmarkVersion
          || launch.manifest.taskPacket.digest !== run.manifest.taskPacketDigest
        ) {
          addIssue(local, "run-task-packet-mismatch", "run task packet identity does not match the launch", "taskPacketDigest");
        }
        if (
          ["3.0", "4.0"].includes(launch.manifest.protocolVersion)
          && (
            launch.manifest.taskPacket.bundleDigest !== run.manifest.taskPacketBundleDigest
            || launch.manifest.executionContractDigest !== run.manifest.executionContractDigest
            || launch.manifest.promptSha256 !== run.manifest.promptSha256
            || launch.manifest.launchDigest !== run.manifest.launchDigest
          )
        ) {
          addIssue(
            local,
            "run-launch-binding-mismatch",
            "run current-protocol digests do not match the frozen launch",
            "launchDigest",
          );
        }
      }
      const cohort = cohortsById.get(run.manifest.cohortId);
      if (!cohort?.manifest) {
        addIssue(local, "unknown-cohort", "cohortId does not name a checked-in cohort", "cohortId");
      } else {
        if (cohort.validationIssues.length > 0) {
          addIssue(local, "invalid-cohort", "run references an invalid cohort", "cohortId");
        }
        if (
          !Array.isArray(cohort.manifest.candidateIds)
          || !cohort.manifest.candidateIds.includes(run.manifest.id)
        ) {
          addIssue(local, "cohort-member-mismatch", "run id is not a member of its cohort", "cohortId");
        }
        if (
          cohort.manifest.launchId !== run.manifest.launchId
          || cohort.manifest.fairnessFingerprint !== run.manifest.fairnessFingerprint
        ) {
          addIssue(
            local,
            "run-cohort-mismatch",
            "run launch or fairness fingerprint does not match its cohort",
            "cohortId",
          );
        }
        if (
          run.manifest.status === "published"
          && cohort.manifest.status !== "published"
        ) {
          addIssue(
            local,
            "unpublished-cohort",
            "published run belongs to a cohort that is not published",
            "cohortId",
          );
        }
      }
      const packet = packetsById.get(
        `${run.manifest.benchmarkId}@${run.manifest.benchmarkVersion}`,
      );
      if (!packet?.manifest) {
        addIssue(local, "unknown-task-packet", "benchmarkId does not name a checked-in task packet", "benchmarkId");
      } else {
        if (packet.validationIssues.length > 0) {
          addIssue(local, "invalid-task-packet", "run references an invalid task packet", "benchmarkId");
        }
        local.push(...validateRequiredOutputBindings(
          packet.manifest,
          run.manifest.artifacts,
        ));
        const availableRoles = new Set(
          (Array.isArray(run.manifest.artifacts) ? run.manifest.artifacts : [])
            .filter((artifact) => artifact.status === "present")
            .map((artifact) => artifact.role),
        );
        const requiresCompleteArtifacts = !(
          run.manifest.extensions?.protocolVersion === "4.0"
          && run.manifest.extensions?.submissionStatus === "partial"
        );
        for (const output of packet.manifest.requiredOutputs ?? []) {
          const role = typeof output === "string" ? output : output.role;
          if (requiresCompleteArtifacts && !availableRoles.has(role)) {
            addIssue(
              local,
              "missing-required-output",
              `run has no present artifact for required output role ${role}`,
              "artifacts",
            );
          }
        }
      }
      if (Array.isArray(run.manifest.artifacts)) {
        for (const artifact of run.manifest.artifacts) {
          if (!isPathUnderBundle(run.manifest.seal?.bundlePath, artifact.path)) {
            addIssue(
              local,
              "artifact-outside-sealed-bundle",
              `artifact ${artifact.id} must be inside seal.bundlePath`,
              artifact.path,
            );
          } else if (
            (contractValidators?.validateArtifact ?? validateArtifact)(artifact).length
              === 0
          ) {
            await validateArtifactFile(run, artifact, local, checks);
          }
        }
      }
      if (run.manifest.processEvidence) {
        let processEvidenceIsSealed = true;
        for (const [key, label] of [
          ["initialPlan", "initial plan"],
          ["workRecord", "work record"],
        ]) {
          const declaration = run.manifest.processEvidence[key];
          if (!isPathUnderBundle(run.manifest.seal?.bundlePath, declaration?.path)) {
            addIssue(
              local,
              "process-evidence-outside-sealed-bundle",
              `${label} must be inside seal.bundlePath`,
              declaration?.path,
            );
            processEvidenceIsSealed = false;
          } else {
            await validateDeclaredFile(
              run.root,
              declaration,
              label,
              local,
              checks,
            );
          }
        }
        try {
          if (!processEvidenceIsSealed) {
            throw new Error("process evidence is outside the sealed bundle");
          }
          const [plan, workRecord] = await Promise.all([
            readJson(path.join(run.root, run.manifest.processEvidence.initialPlan.path)),
            readJson(path.join(run.root, run.manifest.processEvidence.workRecord.path)),
          ]);
          const processIssues = validateProcessTrace(
            plan,
            workRecord,
            run.manifest.artifacts ?? [],
            contractValidators,
          );
          local.push(...processIssues);
          checks.push(check(
            "Design process trace",
            processIssues.length === 0 ? "pass" : "fail",
            processIssues.length === 0
              ? "Requirements, decisions, and verification references resolve"
              : `${processIssues.length} process evidence issue(s)`,
          ));
          run.processEvidenceContent = { plan, workRecord };
        } catch {
          addIssue(local, "invalid-process-evidence", "initial plan or work record is not valid JSON", "processEvidence");
          checks.push(check("Design process trace", "fail", "Process evidence cannot be parsed"));
        }
      }
      if (run.manifest.extensions?.protocolVersion === "4.0") {
        const authorizationIssues = await validateRunAuthorizationStorage(
          run,
          cohortsById.get(run.manifest.cohortId),
          launch,
        );
        local.push(...authorizationIssues);
        checks.push(check(
          "Pre-run operator authorization",
          authorizationIssues.length === 0 ? "pass" : "fail",
          authorizationIssues.length === 0
            ? "Opaque run, frozen conditions, and launch are hash-bound by an operator-attested pre-run record"
            : `${authorizationIssues.length} authorization issue(s)`,
        ));
        const evaluationIssues = await validateV4EvaluationStorage(run, {
          cohortManifest: cohortsById.get(run.manifest.cohortId)?.manifest ?? null,
          requireFinalized: run.manifest.status === "published",
        });
        local.push(...evaluationIssues);
        checks.push(check(
          "Evaluator-owned assessment record",
          evaluationIssues.length === 0 ? "pass" : "fail",
          evaluationIssues.length === 0
            ? "Evaluator record is valid for the run state"
            : `${evaluationIssues.length} evaluation record issue(s)`,
        ));
      }
      if (run.manifest.seal?.sealed === true) {
        const submitted = ensureInside(run.root, run.manifest.seal.bundlePath);
        try {
          const actualTreeHash = await bundleTreeHash(submitted);
          if (actualTreeHash !== run.manifest.seal.bundleSha256) {
            addIssue(local, "bundle-seal-mismatch", "sealed bundle tree hash does not match", "seal.bundleSha256");
            checks.push(check("Sealed candidate bundle", "fail", "Tree hash differs"));
          } else {
            checks.push(check("Sealed candidate bundle", "pass", "Byte tree hash matches", { inputSha256: actualTreeHash }));
          }
        } catch {
          addIssue(local, "missing-sealed-bundle", "sealed candidate bundle is missing", "seal.bundlePath");
          checks.push(check("Sealed candidate bundle", "fail", "Bundle is unavailable"));
        }
        await validateSealedSubmission(run, local, checks, contractValidators);
      }
      if (run.manifest.status === "published") {
        await validatePublicationAttestation(run, local, checks);
      }
    }
    run.validationChecks = checks;
    run.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `runs/${run.directory}`, ...entry })));
  }

  for (const cohort of cohorts) {
    if (cohort.manifest?.status !== "published") continue;
    const completionIssues = [];
    const candidateIds = Array.isArray(cohort.manifest.candidateIds)
      ? cohort.manifest.candidateIds
      : [];
    for (const candidateId of candidateIds) {
      const run = runs.find((entry) => entry.manifest?.id === candidateId);
      if (
        !run?.manifest
        || run.manifest.status !== "published"
        || run.manifest.cohortId !== cohort.manifest.id
        || run.validationIssues.length > 0
      ) {
        addIssue(
          completionIssues,
          "incomplete-published-cohort",
          `published cohort member ${candidateId} is missing, unpublished, or invalid`,
          "candidateIds",
        );
      }
    }
    if (cohort.manifest.extensions?.protocolVersion === "4.0") {
      const postReview = cohort.manifest.extensions?.postReview;
      let disclosure = null;
      let aggregate = null;
      try {
        const bytes = await readFile(path.join(cohort.root, postReview?.disclosure?.path ?? ""));
        if (sha256(bytes) !== postReview?.disclosure?.sha256) throw new Error("hash");
        disclosure = JSON.parse(bytes.toString("utf8"));
        completionIssues.push(...validateCohortDisclosure(disclosure));
      } catch {
        addIssue(completionIssues, "published-disclosure-invalid", "published v4 cohort disclosure is unreadable, invalid, or hash-mismatched", "extensions.postReview.disclosure");
      }
      try {
        const bytes = await readFile(path.join(cohort.root, postReview?.aggregate?.path ?? ""));
        if (sha256(bytes) !== postReview?.aggregate?.sha256) throw new Error("hash");
        aggregate = JSON.parse(bytes.toString("utf8"));
        completionIssues.push(...validateCohortEvaluationAggregate(aggregate));
      } catch {
        addIssue(completionIssues, "published-aggregate-invalid", "published v4 cohort aggregate is unreadable, invalid, or hash-mismatched", "extensions.postReview.aggregate");
      }
      if (disclosure && aggregate) {
        const conditions = cohort.measurementConditions;
        if (
          disclosure.cohortId !== cohort.manifest.id
          || disclosure.launchId !== cohort.manifest.launchId
          || disclosure.measurementConditionsSha256 !== cohort.manifest.extensions.measurementConditions?.sha256
          || !conditions
          || !exactGroupMembership(disclosure.modelGroups, conditions.modelGroups)
        ) {
          addIssue(completionIssues, "published-disclosure-binding", "published disclosure does not exactly bind cohort measurement conditions", "cohort-disclosure.json");
        }
        if (
          aggregate.cohortId !== cohort.manifest.id
          || aggregate.launchId !== cohort.manifest.launchId
          || aggregate.measurementConditionsSha256 !== cohort.manifest.extensions.measurementConditions?.sha256
          || aggregate.disclosureSha256 !== postReview.disclosure?.sha256
          || aggregate.binding?.fairnessFingerprint !== cohort.manifest.fairnessFingerprint
          || !exactGroupMembership(aggregate.modelGroups, disclosure.modelGroups)
        ) {
          addIssue(completionIssues, "published-aggregate-binding", "published aggregate does not exactly bind disclosure and cohort identity", "cohort-evaluation-aggregate.json");
        }
        const aggregateRecordIds = aggregate.evaluationRecords?.map(({ runId }) => runId).sort() ?? [];
        if (canonicalJson(aggregateRecordIds) !== canonicalJson([...candidateIds].sort())) {
          addIssue(completionIssues, "published-aggregate-record-coverage", "aggregate must reference every cohort member exactly once", "cohort-evaluation-aggregate.json");
        }
        for (const entry of aggregate.evaluationRecords ?? []) {
          const run = runs.find((candidate) => candidate.manifest?.id === entry.runId);
          try {
            const bytes = await readFile(path.join(run?.root ?? "", run?.manifest?.evaluation?.recordPath ?? ""));
            const record = JSON.parse(bytes.toString("utf8"));
            if (
              sha256(bytes) !== entry.sha256
              || record.status !== entry.status
              || record.runId !== entry.runId
              || record.fairnessFingerprint !== aggregate.binding?.fairnessFingerprint
              || record.evaluationContractDigest !== aggregate.binding?.evaluationContractDigest
              || record.scoringVersion !== aggregate.binding?.scoringVersion
              || record.scoringContract?.sha256 !== aggregate.binding?.scoringContractSha256
              || record.panel !== aggregate.binding?.panel
            ) throw new Error("binding");
          } catch {
            addIssue(completionIssues, "published-aggregate-record-binding", `aggregate evaluator record binding is invalid for ${entry.runId}`, "cohort-evaluation-aggregate.json");
          }
        }
      }
    }
    if (completionIssues.length === 0) continue;
    cohort.validationIssues.push(...completionIssues);
    issues.push(...completionIssues.map((entry) => ({
      scope: `cohorts/${cohort.directory}`,
      ...entry,
    })));
    for (const run of runs.filter(
      (entry) => entry.manifest?.cohortId === cohort.manifest.id,
    )) {
      const issue = {
        code: "invalid-cohort",
        message: "run belongs to an incomplete published cohort",
        path: "cohortId",
      };
      run.validationIssues.push(issue);
      issues.push({ scope: `runs/${run.directory}`, ...issue });
    }
  }
  return { benchmarks, taskPackets, launches, cohorts, runs, issues };
}
