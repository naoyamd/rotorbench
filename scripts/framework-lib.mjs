import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

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

export function validateProcessTrace(plan, workRecord, artifacts = []) {
  const issues = [
    ...validatePlan(plan),
    ...validateWorkRecord(workRecord),
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

export function validateReport(report) {
  return schemaIssues(schemaValidators.report, report);
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

async function validateSealedSubmission(run, local, checks) {
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

  const schemaProblems = validateSubmission(submission);
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

export async function loadFramework(projectRoot) {
  const benchmarksRoot = path.join(projectRoot, "benchmarks");
  const taskPacketsRoot = path.join(projectRoot, "task-packets");
  const launchesRoot = path.join(projectRoot, "launches");
  const cohortsRoot = path.join(projectRoot, "cohorts");
  const runsRoot = path.join(projectRoot, "runs");
  const benchmarkDirectories = await listContentDirectories(benchmarksRoot);
  const taskPacketDirectories = await listContentDirectories(taskPacketsRoot);
  const launchDirectories = await listContentDirectories(launchesRoot);
  const cohortDirectories = await listContentDirectories(cohortsRoot);
  const runDirectories = await listContentDirectories(runsRoot);
  return {
    benchmarks: await Promise.all(
      benchmarkDirectories.map((directory) =>
        loadManifest(benchmarksRoot, directory, "benchmark.json"),
      ),
    ),
    taskPackets: await Promise.all(
      taskPacketDirectories.map((directory) =>
        loadManifest(taskPacketsRoot, directory, "packet.json"),
      ),
    ),
    launches: await Promise.all(
      launchDirectories.map((directory) =>
        loadManifest(launchesRoot, directory, "launch.json"),
      ),
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
  const issues = [];
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
    if (packet.manifest) {
      local.push(...validateTaskPacket(packet.manifest));
      if (packet.manifest.id !== packet.directory) {
        addIssue(local, "directory-id", "task packet directory and id must match", "id");
      }
      if (packetIds.has(packet.manifest.id)) {
        addIssue(local, "duplicate-id", "task packet id is duplicated", "id");
      }
      packetIds.add(packet.manifest.id);
      packetsById.set(packet.manifest.id, packet);
      const benchmark = benchmarksById.get(packet.manifest.id);
      if (!benchmark) {
        addIssue(local, "unknown-benchmark", "task packet id does not name a benchmark", "id");
      } else if (benchmark.version !== packet.manifest.version) {
        addIssue(local, "benchmark-version-mismatch", "task packet version does not match benchmark", "version");
      }
      if (validateTaskPacket(packet.manifest).length === 0) {
        await validateDeclaredFile(packet.root, packet.manifest.instructions, "task instructions", local);
        for (const input of packet.manifest.inputs) {
          await validateDeclaredFile(packet.root, input, `task input ${input.id}`, local);
        }
      }
    }
    packet.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `task-packets/${packet.directory}`, ...entry })));
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
      const packet = packetsById.get(launch.manifest.taskPacket?.id);
      if (!packet?.manifest) {
        addIssue(local, "unknown-task-packet", "launch taskPacket.id does not exist", "taskPacket.id");
      } else {
        if (packet.validationIssues.length > 0) {
          addIssue(local, "invalid-task-packet", "launch references an invalid task packet", "taskPacket.id");
        }
        if (packet.manifest.version !== launch.manifest.taskPacket.version) {
          addIssue(local, "task-packet-version-mismatch", "launch task packet version does not match", "taskPacket.version");
        }
        if (manifestDigest(packet.manifest) !== launch.manifest.taskPacket.digest) {
          addIssue(local, "task-packet-digest-mismatch", "launch task packet digest does not match", "taskPacket.digest");
        }
      }
      if (
        validateLaunch(launch.manifest).length === 0
        && computeFairnessFingerprint(launch.manifest) !== launch.manifest.fairnessFingerprint
      ) {
        addIssue(local, "fairness-fingerprint-mismatch", "launch fairness fingerprint does not match its common inputs", "fairnessFingerprint");
      }
    }
    launch.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `launches/${launch.directory}`, ...entry })));
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
      const schemaProblems = validateRun(run.manifest);
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
      } else if (run.manifest.benchmarkVersion !== benchmark.version) {
        addIssue(local, "benchmark-version-mismatch", "benchmarkVersion does not match the benchmark manifest", "benchmarkVersion");
        checks.push(check("Benchmark reference", "fail", "Benchmark version does not match"));
      } else {
        checks.push(check("Benchmark reference", "pass", `${benchmark.id} version ${benchmark.version}`));
      }
      const launch = launches.find((entry) => entry.manifest?.id === run.manifest.launchId);
      if (!launch?.manifest) {
        addIssue(local, "unknown-launch", "launchId does not name a checked-in launch", "launchId");
      } else {
        if (launch.validationIssues.length > 0) {
          addIssue(local, "invalid-launch", "launchId names an invalid launch", "launchId");
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
      const packet = packetsById.get(run.manifest.benchmarkId);
      if (!packet?.manifest) {
        addIssue(local, "unknown-task-packet", "benchmarkId does not name a checked-in task packet", "benchmarkId");
      } else {
        if (packet.validationIssues.length > 0) {
          addIssue(local, "invalid-task-packet", "run references an invalid task packet", "benchmarkId");
        }
        const availableRoles = new Set(
          (Array.isArray(run.manifest.artifacts) ? run.manifest.artifacts : [])
            .filter((artifact) => artifact.status === "present")
            .map((artifact) => artifact.role),
        );
        for (const role of packet.manifest.requiredOutputs ?? []) {
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
          } else if (validateArtifact(artifact).length === 0) {
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
          const processIssues = validateProcessTrace(plan, workRecord, run.manifest.artifacts ?? []);
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
        await validateSealedSubmission(run, local, checks);
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
