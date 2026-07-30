import "./official-execution-guard.mjs";
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  bundleTreeHash,
  canonicalJson,
  ensureInside,
  isSafeRelativePath,
  readJson,
  sha256,
  validateExecutionProfile,
} from "./framework-lib.mjs";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";
import {
  validateExecutionContractSnapshot,
  validateFrozenPacket,
  validateLaunchFreeze,
} from "./stage0-lib.mjs";

const MANIFEST_NAME = "review-package.json";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function relativeFor(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function extensionFor(mediaType) {
  switch (mediaType) {
    case "application/json": return "json";
    case "text/csv": return "csv";
    case "text/markdown": return "md";
    case "text/plain": return "txt";
    case "model/step": return "step";
    case "application/pdf": return "pdf";
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/svg+xml": return "svg";
    case "application/x-opaque-cad": return "cad";
    default: throw new Error(`Unsupported review evidence media type: ${mediaType}`);
  }
}

function limitFor(mediaType, limits) {
  switch (mediaType) {
    case "application/json": return limits.maxJsonBytes;
    case "text/csv":
    case "text/markdown":
    case "text/plain": return limits.maxTextBytes;
    case "model/step": return limits.maxStepBytes;
    case "application/pdf": return limits.maxPdfBytes;
    case "image/png":
    case "image/jpeg": return limits.maxImageBytes;
    case "image/svg+xml": return limits.maxImageBytes;
    case "application/x-opaque-cad": return limits.maxFileBytes;
    default: return 0;
  }
}

async function trustedRegularFile(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) {
    throw new Error(`Unsafe file path: ${relativePath}`);
  }
  const absolute = ensureInside(root, relativePath);
  if (!absolute) throw new Error(`Unsafe file path: ${relativePath}`);
  const [resolvedRoot, before] = await Promise.all([
    realpath(root),
    lstat(absolute),
  ]);
  if (before.isSymbolicLink() || !before.isFile()) {
    throw new Error(`Review evidence must be a regular file: ${relativePath}`);
  }
  const resolvedBefore = await realpath(absolute);
  if (resolvedBefore !== resolvedRoot && !resolvedBefore.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Review evidence path escapes its root: ${relativePath}`);
  }
  const bytes = await readFile(absolute);
  const [after, resolvedAfter] = await Promise.all([lstat(absolute), realpath(absolute)]);
  if (
    after.isSymbolicLink()
    || !after.isFile()
    || after.size !== before.size
    || resolvedAfter !== resolvedBefore
  ) {
    throw new Error(`Review evidence changed while being read: ${relativePath}`);
  }
  return { absolute, bytes };
}

async function trustedDirectory(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) throw new Error(`Unsafe directory path: ${relativePath}`);
  const absolute = ensureInside(root, relativePath);
  if (!absolute) throw new Error(`Unsafe directory path: ${relativePath}`);
  const [resolvedRoot, info] = await Promise.all([realpath(root), lstat(absolute)]);
  if (info.isSymbolicLink() || !info.isDirectory()) {
    throw new Error(`Review package directory is not a regular directory: ${relativePath}`);
  }
  const resolved = await realpath(absolute);
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Review package directory escapes its root: ${relativePath}`);
  }
  return absolute;
}

function assertOutputPath(runRoot, sanitizedRoot, outputRoot) {
  if (!isSafeRelativePath(outputRoot)) {
    throw new Error("--out must be a safe relative path below the sanitization output directory");
  }
  const absolute = ensureInside(runRoot, outputRoot);
  if (!absolute || !isInside(sanitizedRoot, absolute) || path.resolve(absolute) === path.resolve(sanitizedRoot)) {
    throw new Error("--out must name a new evaluator-owned directory below the sanitizer output");
  }
  return absolute;
}

function ensureNoIdentityKeys(value) {
  const forbidden = new Set(["model", "provider", "candidateId", "candidate-id", "runId", "run-id", "launchId", "launch-id"]);
  const visit = (node) => {
    if (Array.isArray(node)) return node.every(visit);
    if (!node || typeof node !== "object") return true;
    return Object.entries(node).every(([key, child]) => !forbidden.has(key) && visit(child));
  };
  if (!visit(value)) throw new Error("Review package would expose a forbidden framework identity field");
}

function reviewIdentityTokens(model) {
  const ignored = new Set([
    "",
    "unknown",
    "n/a",
    "na",
    "none",
    "null",
    "undefined",
    "not available",
    "unavailable",
    "unspecified",
  ]);
  return [model?.provider, model?.name, model?.version]
    .filter((value) => typeof value === "string")
    .map((value) => value.trim().replace(/\s+/g, " ").toLowerCase())
    .filter((value) => value.length >= 4 && !ignored.has(value))
    .filter((value, index, values) => values.indexOf(value) === index);
}

function assertEvidenceHasNoIdentityLeak(evidence, model) {
  const tokens = reviewIdentityTokens(model);
  if (tokens.length === 0) return;
  for (const item of evidence) {
    const text = item._bytes.toString("utf8").toLowerCase();
    if (tokens.some((token) => text.includes(token))) {
      throw new Error(`Review evidence identity leak detected in ${item.id}`);
    }
  }
}

function requireNoValidatorIssues(label, issues) {
  if (issues.length > 0) {
    throw new Error(`${label} is invalid: ${issues.map(({ message }) => message).join("; ")}`);
  }
}

async function loadFrozenRuntime({ run, frozenLaunch }) {
  const snapshotRoot = path.join(frozenLaunch.root, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(snapshotRoot, run.executionContractDigest);
  if (snapshot.status !== "valid") throw new Error("Frozen execution contract snapshot is invalid");
  const reviewPackagePath = path.join(snapshotRoot, "scripts", "stage2-review-package.mjs");
  const reviewEvidencePath = path.join(snapshotRoot, "scripts", "review-evidence-lib.mjs");
  const frameworkPath = path.join(snapshotRoot, "scripts", "framework-lib.mjs");
  const stageContractPath = path.join(snapshotRoot, "scripts", "stage-contract.mjs");
  const localReviewEvidencePath = path.join(path.dirname(fileURLToPath(import.meta.url)), "review-evidence-lib.mjs");
  const [frozenReviewBytes, localReviewBytes, frozenReviewEvidenceBytes, localReviewEvidenceBytes, frameworkBytes, stageContractBytes] = await Promise.all([
    readFile(reviewPackagePath),
    readFile(fileURLToPath(import.meta.url)),
    readFile(reviewEvidencePath),
    readFile(localReviewEvidencePath),
    readFile(frameworkPath),
    readFile(stageContractPath),
  ]);
  if (sha256(frozenReviewBytes) !== sha256(localReviewBytes)) {
    throw new Error("Current review-package implementation does not match the frozen execution-contract tool binding");
  }
  if (sha256(frozenReviewEvidenceBytes) !== sha256(localReviewEvidenceBytes)) {
    throw new Error("Current neutral review-evidence implementation does not match the frozen execution-contract tool binding");
  }
  const frozenValidators = await loadFrozenContractValidators(snapshotRoot, {
    runSchemaPath: path.join(snapshotRoot, "schemas", "run.schema.json"),
  });
  const [frozenFramework, frozenStageContract, frozenReviewEvidence] = await Promise.all([
    import(`${pathToFileURL(frameworkPath).href}?sha256=${sha256(frameworkBytes)}`),
    import(`${pathToFileURL(stageContractPath).href}?sha256=${sha256(stageContractBytes)}`),
    import(`${pathToFileURL(reviewEvidencePath).href}?sha256=${sha256(frozenReviewEvidenceBytes)}`),
  ]);
  if (
    typeof frozenFramework.validateV4SanitizationReport !== "function"
    || typeof frozenStageContract.validateCandidateBundle !== "function"
    || typeof frozenStageContract.loadAuthoritativeOutputContract !== "function"
    || typeof frozenReviewEvidence.deriveNeutralReviewEvidence !== "function"
  ) {
    throw new Error("Frozen execution contract does not provide review-package validation helpers");
  }
  return { snapshotRoot, frozenValidators, frozenFramework, frozenStageContract, frozenReviewEvidence };
}

async function readPassedSanitizationReport({ runRoot, run, out, frozenFramework }) {
  const reportFile = await trustedRegularFile(runRoot, `${out}/${"sanitization-report.json"}`);
  let report;
  try {
    report = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(reportFile.bytes));
  } catch {
    throw new Error("Sanitization report is not strict UTF-8 JSON");
  }
  if (report.status !== "passed" || report.outputRoot !== out) {
    throw new Error("Review packages require a passed sanitization report at the requested output root");
  }
  const attestation = {
    actor: "evaluator",
    profileDigest: run.sanitization.profileDigest,
    status: "passed",
    sanitizedArtifactIds: (report.artifacts ?? []).map(({ id }) => id),
    report: { path: `${out}/sanitization-report.json`, sha256: sha256(reportFile.bytes) },
  };
  const integrityIssues = await frozenFramework.validateV4SanitizationReport(
    { root: runRoot, manifest: { ...run, sanitization: attestation } },
    attestation,
  );
  if (integrityIssues.length > 0) {
    throw new Error(`Passed sanitization report failed frozen integrity validation: ${integrityIssues.map(({ code }) => code).join(", ")}`);
  }
  return { report, reportSha256: sha256(reportFile.bytes) };
}

async function scoringContractFor(packetRoot, packet, expectedSha256) {
  const declarations = (packet.inputs ?? []).filter((input) => (
    input.id === "scoring-contract"
    && input.mediaType === "application/json"
    && input.sha256 === expectedSha256
  ));
  if (declarations.length !== 1) {
    throw new Error("Frozen packet does not resolve exactly one scoring-contract input for the evaluation digest");
  }
  const file = await trustedRegularFile(packetRoot, declarations[0].path);
  if (sha256(file.bytes) !== expectedSha256) {
    throw new Error("Frozen scoring-contract bytes do not match the evaluation digest");
  }
  let contract;
  try {
    contract = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes));
  } catch {
    throw new Error("Frozen scoring-contract input is not strict UTF-8 JSON");
  }
  if (typeof contract.id !== "string" || typeof contract.version !== "string") {
    throw new Error("Frozen scoring-contract input has no id/version");
  }
  return { bytes: file.bytes, contract };
}

function evidenceEntry({ id, kind, mediaType, bytes, role = null, derivation = null }) {
  return {
    id,
    kind,
    mediaType,
    sha256: sha256(bytes),
    bytes: bytes.length,
    outputPath: `evidence/${id}.${extensionFor(mediaType)}`,
    ...(role ? { role } : {}),
    ...(derivation ? { derivation } : {}),
    _bytes: bytes,
  };
}

async function writePackageAndCommit({ outputPath, manifest, scoringContractBytes, evidence }) {
  const parent = path.dirname(outputPath);
  const stagingPath = path.join(parent, `.${path.basename(outputPath)}.review-${process.pid}-${Date.now()}`);
  try {
    await mkdir(stagingPath, { recursive: false });
    await writeFile(path.join(stagingPath, "scoring-contract.json"), scoringContractBytes, { flag: "wx" });
    for (const item of evidence) {
      const target = ensureInside(stagingPath, item.outputPath);
      if (!target) throw new Error(`Unsafe review evidence output: ${item.outputPath}`);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, item._bytes, { flag: "wx" });
    }
    await writeFile(path.join(stagingPath, MANIFEST_NAME), canonicalBytes(manifest), { flag: "wx" });
    await rename(stagingPath, outputPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const manifestBytes = await readFile(path.join(outputPath, MANIFEST_NAME));
  return { manifestPath: path.join(outputPath, MANIFEST_NAME), manifestSha256: sha256(manifestBytes) };
}

/**
 * Build the only directory a blind engineering rater may receive. The package
 * contains verified static evidence with opaque labels; it never copies
 * submission.json, run.json, cohort metadata, or any model/provider identity.
 * Candidate code is never executed. Allowlisted static STEP is imported and
 * rendered by an isolated evaluator-owned worker; the allowlisted BOM,
 * requirements-trace, and drawing-index CSV artifacts are safely parsed and
 * normalized by the evaluator. Frozen output-contract and requirements JSON
 * is also parsed there; every other candidate artifact remains opaque.
 */
export async function prepareReviewPackage({
  projectRoot = process.cwd(),
  runId,
  sanitized = "sanitized",
  out = "sanitized/review-package",
  generatedAt = null,
} = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId ?? "")) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  if (!isSafeRelativePath(sanitized)) throw new Error("--sanitized must be a safe relative path");
  const root = path.resolve(projectRoot);
  const runRoot = path.join(root, "runs", runId);
  const run = await readJson(path.join(runRoot, "run.json"));
  if (run.id !== runId || run.status !== "validated" || run.seal?.sealed !== true || run.extensions?.protocolVersion !== "4.0") {
    throw new Error("Only an already sealed, validated v4 run may receive a review package");
  }
  const candidateRoot = ensureInside(runRoot, run.seal.bundlePath);
  if (!candidateRoot || path.basename(candidateRoot) !== "submitted") {
    throw new Error("Run sealed bundle path is unsafe");
  }
  const sanitizedRoot = await trustedDirectory(runRoot, sanitized);
  const outputPath = assertOutputPath(runRoot, sanitizedRoot, out);
  if (await lstat(outputPath).then(() => true).catch(() => false)) {
    throw new Error(`Review package output already exists: ${out}`);
  }

  const frozenLaunch = await validateLaunchFreeze(root, run.launchId);
  if (frozenLaunch.status !== "valid") {
    throw new Error(`Frozen launch is invalid: ${frozenLaunch.issues.map(({ code }) => code).join(", ")}`);
  }
  const launch = frozenLaunch.launch;
  const profile = frozenLaunch.profile;
  if (
    launch.protocolVersion !== "4.0"
    || run.executionContractDigest !== launch.executionContractDigest
    || run.launchDigest !== launch.launchDigest
    || run.fairnessFingerprint !== launch.fairnessFingerprint
  ) {
    throw new Error("Run does not bind the verified frozen v4 launch");
  }
  const profileIssues = validateExecutionProfile(profile);
  if (profileIssues.length > 0 || !profile.sanitization) {
    throw new Error("Frozen execution profile does not define valid sanitizer limits");
  }
  const packetRoot = path.join(root, "task-packets", launch.taskPacket.id, launch.taskPacket.version);
  const frozenPacket = await validateFrozenPacket(packetRoot);
  if (frozenPacket.status !== "valid") throw new Error("Frozen task packet is invalid");
  if (
    frozenPacket.packet.id !== run.benchmarkId
    || frozenPacket.packet.version !== run.benchmarkVersion
    || frozenPacket.lock.packetDigest !== run.taskPacketDigest
    || frozenPacket.lock.bundleDigest !== run.taskPacketBundleDigest
  ) {
    throw new Error("Run does not bind the verified frozen packet");
  }
  const runtime = await loadFrozenRuntime({ run, frozenLaunch });
  requireNoValidatorIssues("Run manifest", runtime.frozenValidators.validateRun(run));
  const { report, reportSha256 } = await readPassedSanitizationReport({
    runRoot,
    run,
    out: sanitized,
    frozenFramework: runtime.frozenFramework,
  });
  const authoritativeOutputContract = await runtime.frozenStageContract
    .loadAuthoritativeOutputContract(packetRoot, frozenPacket.packet);
  const candidate = await runtime.frozenStageContract.validateCandidateBundle(candidateRoot, {
    contractValidators: runtime.frozenValidators,
    expectedRootName: "submitted",
    ...authoritativeOutputContract,
  });
  if (candidate.status !== "valid" || !candidate.submission) {
    throw new Error(`Sealed candidate process evidence is invalid: ${(candidate.issues ?? []).join("; ")}`);
  }
  const submission = candidate.submission;
  const entryLimit = (mediaType) => limitFor(mediaType, profile.sanitization);
  const sourceEntries = [
    { kind: "initial-plan", declaration: submission.initialPlan, mediaType: "application/json" },
    { kind: "initial-plan-checkpoint", declaration: submission.initialPlanCheckpoint, mediaType: "text/plain" },
    { kind: "work-record", declaration: submission.workRecord, mediaType: "application/json" },
    ...(submission.checkpointReceipts ?? [])
      .slice()
      .sort((left, right) => left.sequence - right.sequence || left.id.localeCompare(right.id))
      .map((receipt) => ({ kind: "checkpoint-receipt", declaration: receipt, mediaType: "application/json" })),
  ];
  const evidence = [];
  const artifactEvidenceIds = new Map();
  const reviewArtifacts = [];
  let nextEvidenceNumber = 1;
  for (const source of sourceEntries) {
    const file = await trustedRegularFile(candidateRoot, source.declaration.path);
    if (file.bytes.length > entryLimit(source.mediaType)) {
      throw new Error(`Review process evidence exceeds the frozen ${source.mediaType} size limit`);
    }
    if (sha256(file.bytes) !== source.declaration.sha256) {
      throw new Error(`Review process evidence does not match its sealed hash: ${source.kind}`);
    }
    const id = `EVD-${String(nextEvidenceNumber).padStart(3, "0")}`;
    nextEvidenceNumber += 1;
    evidence.push(evidenceEntry({ id, kind: source.kind, mediaType: source.mediaType, bytes: file.bytes }));
  }
  const roleByArtifactId = new Map((run.artifacts ?? []).map((artifact) => [artifact.id, artifact.role]));
  for (const artifact of (report.artifacts ?? []).slice().sort((left, right) => left.id.localeCompare(right.id))) {
    const artifactOutput = ensureInside(runRoot, artifact.outputPath);
    if (!artifactOutput) throw new Error("Sanitized review artifact path is unsafe");
    const relativeOutput = relativeFor(runRoot, artifactOutput);
    const file = await trustedRegularFile(runRoot, relativeOutput);
    if (file.bytes.length > entryLimit(artifact.mediaType)) {
      throw new Error(`Sanitized review artifact exceeds the frozen ${artifact.mediaType} size limit`);
    }
    if (sha256(file.bytes) !== artifact.outputSha256) {
      throw new Error("Sanitized review artifact no longer matches the sanitization report");
    }
    const role = roleByArtifactId.get(artifact.id);
    if (!role) throw new Error("Sanitized review artifact has no sealed role");
    const id = `EVD-${String(nextEvidenceNumber).padStart(3, "0")}`;
    nextEvidenceNumber += 1;
    artifactEvidenceIds.set(artifact.id, id);
    // The sanitization report intentionally omits candidate-owned role
    // metadata. Rebind the sealed role before passing the artifact to neutral
    // derivation so STEP and drawing-only processing cannot be silently lost.
    reviewArtifacts.push({ ...artifact, role, bytes: file.bytes });
    evidence.push(evidenceEntry({ id, kind: "artifact", role, mediaType: artifact.mediaType, bytes: file.bytes }));
  }
  const derived = await runtime.frozenReviewEvidence.deriveNeutralReviewEvidence({
    packetRoot,
    packet: frozenPacket.packet,
    reportArtifacts: reviewArtifacts,
    artifactEvidenceIds,
    executionContractDigest: run.executionContractDigest,
  });
  for (const item of derived) {
    const id = `EVD-${String(nextEvidenceNumber).padStart(3, "0")}`;
    nextEvidenceNumber += 1;
    evidence.push(evidenceEntry({
      id,
      kind: "derived",
      mediaType: item.mediaType,
      bytes: item.bytes,
      derivation: {
        status: item.derivationStatus,
        sourceEvidenceIds: item.sourceEvidenceIds,
        tool: item.tool,
      },
    }));
  }
  const scoring = await scoringContractFor(
    packetRoot,
    frozenPacket.packet,
    launch.v4Contract?.evaluationContract?.digest,
  );
  assertEvidenceHasNoIdentityLeak(evidence, submission.model);
  const resolvedGeneratedAt = generatedAt ?? report.generatedAt;
  if (Number.isNaN(Date.parse(resolvedGeneratedAt))) {
    throw new Error("generatedAt must be an ISO-8601 date-time");
  }
  const reviewPackageId = `review-${sha256(`${run.seal.bundleSha256}\n${launch.launchDigest}`).slice(0, 16)}`;
  const manifest = {
    schemaVersion: "1.0",
    generatedAt: resolvedGeneratedAt,
    status: "ready",
    reviewPackageId,
    evidenceRoot: "evidence",
    scoringContract: {
      id: scoring.contract.id,
      version: scoring.contract.version,
      sha256: launch.v4Contract.evaluationContract.digest,
      outputPath: "scoring-contract.json",
      outputSha256: sha256(scoring.bytes),
    },
    sanitizationReport: { sha256: reportSha256, status: "passed" },
    evidence: evidence.map((item) => {
      const publicEntry = { ...item };
      delete publicEntry._bytes;
      return publicEntry;
    }),
  };
  const evidenceIds = new Set(manifest.evidence.map(({ id }) => id));
  for (const item of manifest.evidence.filter(({ kind }) => kind === "derived")) {
    if (item.derivation.sourceEvidenceIds.some((sourceId) => !evidenceIds.has(sourceId) || sourceId === item.id)) {
      throw new Error("Derived review evidence references an unknown source evidence identifier");
    }
  }
  ensureNoIdentityKeys(manifest);
  requireNoValidatorIssues("Review package", runtime.frozenValidators.validateReviewPackage(manifest));
  const afterReadBundle = await bundleTreeHash(candidateRoot);
  if (afterReadBundle !== run.seal.bundleSha256) {
    throw new Error("Candidate bytes changed while review evidence was being prepared");
  }
  const committed = await writePackageAndCommit({
    outputPath,
    manifest,
    scoringContractBytes: scoring.bytes,
    evidence,
  });
  return {
    reviewPackageId,
    manifestPath: relativeFor(runRoot, committed.manifestPath),
    manifestSha256: committed.manifestSha256,
    evidenceIds: manifest.evidence.map(({ id }) => id),
  };
}

async function main() {
  const projectRoot = argument("--project-root", { required: true });
  const runId = argument("--run-id", { required: true });
  const sanitized = argument("--sanitized") ?? "sanitized";
  const out = argument("--out") ?? `${sanitized}/review-package`;
  const result = await prepareReviewPackage({
    projectRoot: path.resolve(projectRoot),
    runId,
    sanitized,
    out,
  });
  console.log(`Prepared ${result.reviewPackageId}: ${result.manifestPath} (${result.manifestSha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
