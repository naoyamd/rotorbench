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
  "benchmark.schema.json",
  "task-packet.schema.json",
  "launch.schema.json",
  "cohort.schema.json",
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

export function computeFairnessFingerprint(launch) {
  const comparable = {
    protocolVersion: launch.protocolVersion,
    taskPacket: launch.taskPacket,
    baselineCommit: launch.baselineCommit,
    workspaceDigest: launch.workspaceDigest,
    outputRoot: launch.outputRoot,
    startAction: launch.startAction,
    stopConditions: launch.stopConditions,
    ...(launch.protocolVersion === "3.0"
      ? {
        executionProfile: launch.executionProfile,
        executionContractDigest: launch.executionContractDigest,
        canonicalBaseUrl: launch.canonicalBaseUrl,
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

export function validateRequiredOutputBindings(packet, artifacts = []) {
  const issues = [];
  if (packet?.schemaVersion !== "3.0") return issues;
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
    } else if (bound.length > 1) {
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
      submission.protocolVersion === "3.0"
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
    const frozenV3 = packet.manifest?.schemaVersion === "3.0" && packet.lock;
    if (frozenV3) {
      const { validateFrozenPacket } = await import("./stage0-lib.mjs");
      const frozen = await validateFrozenPacket(packet.root);
      local.push(...frozen.issues);
    }
    const draftV3 = packet.layout === "versioned" && !packet.lock;
    packet.stage0Issues = local;
    packet.validationIssues = draftV3 ? [] : local;
    if (!draftV3) {
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
          launch.manifest.protocolVersion === "3.0"
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
          launch.manifest.protocolVersion === "3.0"
          && (
            packet.layout !== "versioned"
            || packet.manifest.schemaVersion !== "3.0"
            || !packet.lock
            || packet.stage0Issues?.length > 0
          )
        ) {
          addIssue(
            local,
            "v3-packet-not-frozen",
            "Protocol v3 launches require a clean locked versioned v3 packet",
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
    const isV3 = launch.manifest?.protocolVersion === "3.0";
    if (isV3) {
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
    launch.publicEligible = isV3
      ? ["release-ready", "live-verified"].includes(launch.release?.status)
      : launch.v2Grandfathered === true;
    launch.stage0Issues = local;
    launch.validationIssues = isV3 && !launch.publicEligible ? [] : local;
    if (!isV3 || launch.publicEligible) {
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
          launch.manifest.protocolVersion === "3.0"
          && launch.release?.status !== "live-verified"
        ) {
          addIssue(
            local,
            "cohort-launch-not-live-verified",
            "Stage 2 v3 cohorts require a live-verified launch",
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
        launch?.manifest?.protocolVersion === "3.0"
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
          launch.manifest.protocolVersion === "3.0"
          && launch.release?.status !== "live-verified"
        ) {
          addIssue(
            local,
            "launch-not-live-verified",
            "Stage 2 v3 runs require a live-verified launch",
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
          launch.manifest.protocolVersion === "3.0"
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
            "run v3 digests do not match the frozen launch",
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
        for (const output of packet.manifest.requiredOutputs ?? []) {
          const role = typeof output === "string" ? output : output.role;
          if (!availableRoles.has(role)) {
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
