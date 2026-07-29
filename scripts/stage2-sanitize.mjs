import "./official-execution-guard.mjs";
import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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
  validateRun,
} from "./framework-lib.mjs";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";
import {
  validateExecutionContractSnapshot,
  validateFrozenPacket,
  validateLaunchFreeze,
} from "./stage0-lib.mjs";

const TOOL_NAME = "stage2-sanitize";
const TOOL_VERSION = "1.0";
const REPORT_NAME = "sanitization-report.json";
const TEXT_MEDIA_TYPES = new Set(["application/json", "text/csv", "text/markdown", "text/plain"]);
const MEDIA_EXTENSIONS = new Map([
  ["application/json", new Set([".json"])],
  ["text/csv", new Set([".csv"])],
  ["text/markdown", new Set([".md", ".markdown"])],
  ["text/plain", new Set([".txt"])],
  ["model/step", new Set([".step", ".stp"])],
  ["application/pdf", new Set([".pdf"])],
  ["image/png", new Set([".png"])],
  ["image/jpeg", new Set([".jpg", ".jpeg"])],
  ["application/x-opaque-cad", new Set([".fcstd", ".f3d", ".sldprt", ".sldasm", ".ipt", ".iam", ".catpart", ".catproduct", ".prt", ".asm", ".x_t", ".x_b"])],
]);

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function issue(code, message, relativePath = null) {
  return { code, message, ...(relativePath && isSafeRelativePath(relativePath) ? { path: relativePath } : {}) };
}

function sortIssues(issues) {
  return [...issues].sort((left, right) => (
    left.code.localeCompare(right.code)
    || (left.path ?? "").localeCompare(right.path ?? "")
    || left.message.localeCompare(right.message)
  ));
}

function bytesForCanonicalJson(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function relativeFor(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

function isInside(root, candidate) {
  const relative = path.relative(path.resolve(root), path.resolve(candidate));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function outputRelativePath(outputRoot, artifactPath) {
  return `${outputRoot}/artifacts/${artifactPath}`;
}

function limitFor(mediaType, limits) {
  switch (mediaType) {
    case "application/json": return limits.maxJsonBytes;
    case "text/csv":
    case "text/markdown":
    case "text/plain": return limits.maxTextBytes;
    case "application/pdf": return limits.maxPdfBytes;
    case "model/step": return limits.maxStepBytes;
    case "image/png":
    case "image/jpeg": return limits.maxImageBytes;
    case "application/x-opaque-cad": return limits.maxFileBytes;
    default: return 0;
  }
}

function artifactLimit(expected, limits, { indexed = false } = {}) {
  // Native CAD source bytes are permitted only when the frozen
  // artifact-contract validator resolved them through sourceFiles. They stay
  // opaque: the evaluator neither opens nor interprets their native format.
  if (indexed && expected.role === "cad-source") return limits.maxFileBytes;
  return limitFor(expected.mediaType, limits);
}

function decoder() {
  return new TextDecoder("utf-8", { fatal: true });
}

function decodeText(bytes) {
  return decoder().decode(bytes);
}

function mediaIssues(expected, bytes) {
  const problems = [];
  const extension = path.extname(expected.path).toLowerCase();
  const permittedExtensions = MEDIA_EXTENSIONS.get(expected.mediaType);
  if (!permittedExtensions) {
    return [issue(
      "unsupported-artifact-media-type",
      `${expected.path} declares an evaluator-unsupported media type ${expected.mediaType}`,
      expected.path,
    )];
  }
  if (!permittedExtensions.has(extension)) {
    problems.push(issue(
      "unexpected-artifact-extension",
      `${expected.path} does not use an allowlisted extension for ${expected.mediaType}`,
      expected.path,
    ));
  }
  try {
    if (TEXT_MEDIA_TYPES.has(expected.mediaType)) {
      const text = decodeText(bytes);
      if (text.includes("\0")) {
        problems.push(issue("text-nul-byte", `${expected.path} contains a NUL byte`, expected.path));
      }
      if (expected.mediaType === "application/json") JSON.parse(text.replace(/^\uFEFF/, ""));
    } else if (expected.mediaType === "model/step") {
      const text = bytes.toString("latin1");
      if (!text.startsWith("ISO-10303-21;") || !text.includes("HEADER;") || !text.includes("DATA;") || !text.trimEnd().endsWith("END-ISO-10303-21;")) {
        problems.push(issue("artifact-step-invalid-envelope", `${expected.path} is not a recognizable ISO 10303-21 exchange file`, expected.path));
      }
    } else if (expected.mediaType === "application/pdf") {
      const prefix = bytes.subarray(0, 8).toString("latin1");
      const suffix = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
      if (!prefix.startsWith("%PDF-") || !suffix.includes("%%EOF")) {
        problems.push(issue("artifact-pdf-invalid-envelope", `${expected.path} is not a recognizable PDF file`, expected.path));
      }
    } else if (expected.mediaType === "image/png") {
      const signature = "89504e470d0a1a0a";
      if (bytes.subarray(0, 8).toString("hex") !== signature) {
        problems.push(issue("artifact-png-invalid-magic", `${expected.path} is not a PNG image`, expected.path));
      }
    } else if (expected.mediaType === "image/jpeg") {
      if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9) {
        problems.push(issue("artifact-jpeg-invalid-magic", `${expected.path} is not a JPEG image`, expected.path));
      }
    } else if (expected.mediaType === "application/x-opaque-cad") {
      // Opaque native CAD source is retained and hash-checked only. It is never opened or executed.
    }
  } catch {
    problems.push(issue(
      expected.mediaType === "application/json" ? "artifact-json-invalid" : "artifact-text-invalid-utf8",
      `${expected.path} cannot be read as strict UTF-8 ${expected.mediaType === "application/json" ? "JSON" : "text"}`,
      expected.path,
    ));
  }
  return problems;
}

function indexedMediaIssues(expected, bytes) {
  if (expected.role === "cad-source") {
    // The frozen artifact validator has already checked sourceFiles path root,
    // metadata, allowlisted media type, declaration hash, and regular-file
    // status.  Deliberately do not parse opaque native CAD source bytes here.
    return [];
  }
  return mediaIssues(expected, bytes);
}

async function readRegularFile(root, relativePath) {
  const absolute = ensureInside(root, relativePath);
  if (!absolute) return { error: "unsafe path" };
  try {
    const before = await lstat(absolute);
    if (before.isSymbolicLink() || !before.isFile()) return { error: "not a regular file" };
    const bytes = await readFile(absolute);
    const after = await lstat(absolute);
    if (after.isSymbolicLink() || !after.isFile() || after.size !== before.size) {
      return { error: "file changed while being read" };
    }
    return { absolute, bytes };
  } catch {
    return { error: "missing file" };
  }
}

async function scanCandidateTree(root, limits, issues) {
  const files = [];
  const rootInfo = await lstat(root).catch(() => null);
  if (!rootInfo || !rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    issues.push(issue("candidate-root-invalid", "submitted candidate bundle is missing, not a directory, or is a symbolic link"));
    return files;
  }
  const walk = async (directory) => {
    let entries;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      issues.push(issue("candidate-directory-unreadable", "candidate bundle contains an unreadable directory", relativeFor(root, directory)));
      return;
    }
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const absolute = path.join(directory, entry.name);
      const relativePath = relativeFor(root, absolute);
      if (!isSafeRelativePath(relativePath)) {
        issues.push(issue("unsafe-candidate-path", "candidate bundle contains an unsafe path"));
        continue;
      }
      if (relativePath.length > limits.maxPathLength) {
        issues.push(issue("candidate-path-too-long", `${relativePath} exceeds the frozen path-length limit`, relativePath));
      }
      const info = await lstat(absolute).catch(() => null);
      if (!info) {
        issues.push(issue("candidate-entry-unreadable", "candidate bundle entry cannot be inspected", relativePath));
      } else if (info.isSymbolicLink()) {
        issues.push(issue("candidate-symbolic-link", "symbolic links are never admissible", relativePath));
      } else if (info.isDirectory()) {
        await walk(absolute);
      } else if (info.isFile()) {
        files.push({ path: relativePath, size: info.size });
        if (files.length > limits.maxBundleFiles) {
          issues.push(issue("candidate-file-count-limit", "candidate bundle exceeds the frozen file-count limit"));
        }
        if (info.size > limits.maxFileBytes) {
          issues.push(issue("candidate-file-size-limit", `${relativePath} exceeds the frozen per-file limit`, relativePath));
        }
      } else {
        issues.push(issue("candidate-unsupported-filesystem-entry", "candidate bundle contains a non-regular filesystem entry", relativePath));
      }
    }
  };
  await walk(root);
  const totalBytes = files.reduce((sum, file) => sum + file.size, 0);
  if (totalBytes > limits.maxBundleBytes) {
    issues.push(issue("candidate-total-size-limit", "candidate bundle exceeds the frozen total-byte limit"));
  }
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

async function outputContract(packetRoot, packet) {
  const declaration = (packet.inputs ?? []).find(({ id }) => id === "output-contract");
  if (!declaration?.path) throw new Error("Frozen packet has no output-contract input");
  const file = await readRegularFile(packetRoot, declaration.path);
  if (file.error) throw new Error(`Frozen output contract is unavailable: ${file.error}`);
  try {
    const parsed = JSON.parse(decodeText(file.bytes));
    if (!Array.isArray(parsed.artefacts)) throw new Error("artefacts array is required");
    return parsed;
  } catch (error) {
    throw new Error(`Frozen output contract is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
}

async function sanitizationProfile(packetRoot, packet, digest) {
  const declarations = (packet.inputs ?? []).filter((entry) => entry.sha256 === digest);
  if (declarations.length !== 1) {
    throw new Error("Frozen v4 sanitization-profile commitment does not resolve to exactly one packet input");
  }
  const file = await readRegularFile(packetRoot, declarations[0].path);
  if (file.error) throw new Error(`Frozen sanitization profile is unavailable: ${file.error}`);
  if (sha256(file.bytes) !== digest) throw new Error("Frozen sanitization profile digest does not match the v4 commitment");
  try {
    const profile = JSON.parse(decodeText(file.bytes));
    if (!profile || typeof profile !== "object" || Array.isArray(profile)) throw new Error("profile must be a JSON object");
  } catch (error) {
    throw new Error(`Frozen sanitization profile is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }
  return { declaration: declarations[0], sha256: sha256(file.bytes) };
}

function reportBase({ run, launch, profile, sanitizerProfile, outputRoot, bundleSha256, artifactContractSha256, sanitizerSha256, generatedAt }) {
  return {
    schemaVersion: "1.0",
    generatedAt,
    runId: run.id,
    status: "failed",
    outputRoot,
    bundle: { path: "submitted", sha256: bundleSha256 },
    launch: {
      id: launch.id,
      digest: launch.launchDigest,
      fairnessFingerprint: launch.fairnessFingerprint,
    },
    packet: {
      id: launch.taskPacket.id,
      version: launch.taskPacket.version,
      digest: launch.taskPacket.digest,
      bundleDigest: launch.taskPacket.bundleDigest,
    },
    executionProfile: {
      id: profile.id,
      version: profile.version,
      digest: launch.executionProfile.digest,
      limits: profile.sanitization,
    },
    sanitizationProfile: {
      digest: run.sanitization.profileDigest,
      sha256: sanitizerProfile.sha256,
    },
    executionContract: {
      digest: run.executionContractDigest,
      artifactContractSha256,
      sanitizerSha256,
    },
    tool: { name: TOOL_NAME, version: TOOL_VERSION, sourceSha256: sanitizerSha256 },
    artifacts: [],
    issues: [],
  };
}

async function writeReportAndCommit({ runRoot, outputPath, report, artifacts }) {
  const parent = path.dirname(outputPath);
  const stagingPath = path.join(parent, `.${path.basename(outputPath)}.sanitize-${process.pid}-${Date.now()}`);
  try {
    await mkdir(stagingPath, { recursive: false });
    if (report.status === "passed") {
      for (const artifact of artifacts) {
        const target = ensureInside(stagingPath, `artifacts/${artifact.path}`);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, artifact.bytes, { flag: "wx" });
      }
    }
    await writeFile(path.join(stagingPath, REPORT_NAME), bytesForCanonicalJson(report), { flag: "wx" });
    await rename(stagingPath, outputPath);
  } catch (error) {
    await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  const reportPath = relativeFor(runRoot, path.join(outputPath, REPORT_NAME));
  const reportBytes = await readFile(path.join(outputPath, REPORT_NAME));
  return { reportPath, reportSha256: sha256(reportBytes) };
}

function assertOutputPath(runRoot, candidateRoot, outputRoot) {
  if (!isSafeRelativePath(outputRoot)) throw new Error("--out must be a safe relative path below the run directory");
  const absolute = ensureInside(runRoot, outputRoot);
  if (!absolute || !isInside(runRoot, absolute) || isInside(candidateRoot, absolute)) {
    throw new Error("--out must name an evaluator-owned directory outside submitted/");
  }
  return absolute;
}

/**
 * Statically admit declared v4 artefacts into an evaluator-owned directory.
 * This routine only reads candidate bytes; it never imports, renders, parses
 * native CAD, executes candidate content, or uses a network service.
 */
export async function sanitizeRun({
  projectRoot = process.cwd(),
  runId,
  out = "sanitized",
  generatedAt = new Date().toISOString(),
} = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId ?? "")) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  if (Number.isNaN(Date.parse(generatedAt))) throw new Error("generatedAt must be an ISO-8601 date-time");
  const root = path.resolve(projectRoot);
  const runRoot = path.join(root, "runs", runId);
  const runPath = path.join(runRoot, "run.json");
  const run = await readJson(runPath);
  const runProblems = validateRun(run);
  if (runProblems.length > 0) throw new Error(`Run manifest is schema-invalid: ${runProblems.map(({ message }) => message).join("; ")}`);
  if (run.id !== runId || run.status !== "validated" || run.seal?.sealed !== true || run.extensions?.protocolVersion !== "4.0") {
    throw new Error("Only an already sealed, validated v4 run may be sanitized");
  }
  if (run.sanitization?.status !== "not-run") {
    throw new Error("A v4 run may be sanitized only while its evaluator sanitization state is not-run");
  }
  const candidateRoot = ensureInside(runRoot, run.seal.bundlePath);
  if (!candidateRoot || path.basename(candidateRoot) !== "submitted") throw new Error("Run sealed bundle path is unsafe");
  const outputPath = assertOutputPath(runRoot, candidateRoot, out);
  if (await lstat(outputPath).then(() => true).catch(() => false)) {
    throw new Error(`Sanitization output already exists: ${out}`);
  }

  const frozenLaunch = await validateLaunchFreeze(root, run.launchId);
  if (frozenLaunch.status !== "valid") {
    throw new Error(`Frozen launch is invalid: ${frozenLaunch.issues.map(({ code }) => code).join(", ")}`);
  }
  const launch = frozenLaunch.launch;
  const profile = frozenLaunch.profile;
  if (launch.protocolVersion !== "4.0" || run.executionContractDigest !== launch.executionContractDigest || run.launchDigest !== launch.launchDigest || run.fairnessFingerprint !== launch.fairnessFingerprint) {
    throw new Error("Run does not bind the verified frozen v4 launch");
  }
  const profileIssues = validateExecutionProfile(profile);
  if (profileIssues.length > 0 || !profile.sanitization) throw new Error("Frozen execution profile does not define valid sanitizer limits");
  if (run.sanitization.profileDigest !== launch.v4Contract?.sanitizationProfile?.digest) {
    throw new Error("Run sanitization profile digest does not bind the frozen v4 launch");
  }
  const packetRoot = path.join(root, "task-packets", launch.taskPacket.id, launch.taskPacket.version);
  const frozenPacket = await validateFrozenPacket(packetRoot);
  if (frozenPacket.status !== "valid") throw new Error("Frozen task packet is invalid");
  if (frozenPacket.packet.id !== run.benchmarkId || frozenPacket.packet.version !== run.benchmarkVersion || frozenPacket.lock.packetDigest !== run.taskPacketDigest || frozenPacket.lock.bundleDigest !== run.taskPacketBundleDigest) {
    throw new Error("Run does not bind the verified frozen packet");
  }
  const snapshotRoot = path.join(frozenLaunch.root, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(snapshotRoot, run.executionContractDigest);
  if (snapshot.status !== "valid") throw new Error("Frozen execution contract snapshot is invalid");
  const frozenValidators = await loadFrozenContractValidators(snapshotRoot);
  const artifactContractPath = path.join(snapshotRoot, "scripts", "artifact-contract.mjs");
  const sanitizerSnapshotPath = path.join(snapshotRoot, "scripts", "stage2-sanitize.mjs");
  const [artifactContractBytes, frozenSanitizerBytes, localSanitizerBytes] = await Promise.all([
    readFile(artifactContractPath),
    readFile(sanitizerSnapshotPath),
    readFile(fileURLToPath(import.meta.url)),
  ]);
  const artifactContractSha256 = sha256(artifactContractBytes);
  const sanitizerSha256 = sha256(frozenSanitizerBytes);
  if (sha256(localSanitizerBytes) !== sanitizerSha256) {
    throw new Error("Current sanitizer implementation does not match the frozen execution-contract tool binding");
  }
  const frozenArtifactContract = await import(`${pathToFileURL(artifactContractPath).href}?sha256=${artifactContractSha256}`);
  if (typeof frozenArtifactContract.validateArtifactContract !== "function") {
    throw new Error("Frozen execution contract has no artifact-contract validator");
  }
  const sanitizerProfile = await sanitizationProfile(
    packetRoot,
    frozenPacket.packet,
    run.sanitization.profileDigest,
  );

  const issues = [];
  const files = await scanCandidateTree(candidateRoot, profile.sanitization, issues);
  let bundleSha256 = run.seal.bundleSha256;
  try {
    bundleSha256 = await bundleTreeHash(candidateRoot);
    if (bundleSha256 !== run.seal.bundleSha256) {
      issues.push(issue("sealed-bundle-hash-mismatch", "candidate bytes do not match the sealed bundle hash"));
    }
  } catch (error) {
    issues.push(issue("candidate-tree-unreadable", error instanceof Error ? error.message : "candidate bundle cannot be hashed"));
  }

  let submission = null;
  const submissionFile = await readRegularFile(candidateRoot, "submission.json");
  if (submissionFile.error) {
    issues.push(issue("sealed-submission-unreadable", "submission.json is missing or not a regular file", "submission.json"));
  } else {
    try {
      submission = JSON.parse(decodeText(submissionFile.bytes));
      for (const problem of frozenValidators.validateSubmission(submission)) {
        issues.push(issue("sealed-submission-invalid", problem.message, "submission.json"));
      }
    } catch {
      issues.push(issue("sealed-submission-invalid-json", "submission.json is not strict UTF-8 JSON", "submission.json"));
    }
  }

  const admitted = [];
  if (submission) {
    if (submission.protocolVersion !== "4.0" || submission.launchId !== run.launchId || submission.sanitizationRequest?.profileDigest !== run.sanitization.profileDigest) {
      issues.push(issue("sealed-submission-binding", "submission.json does not bind this sealed v4 run and sanitization profile", "submission.json"));
    }
    const expectedContract = await outputContract(packetRoot, frozenPacket.packet);
    const contractResult = await frozenArtifactContract.validateArtifactContract({
      candidateRoot,
      packetRoot,
      packet: frozenPacket.packet,
      submission,
    });
    for (const problem of contractResult.admissionIssues ?? []) {
      issues.push(issue(problem.code, problem.message, problem.path));
    }
    const expectedByPath = new Map(expectedContract.artefacts.map((artifact) => [artifact.path, artifact]));
    const indexedByPath = new Map();
    for (const indexed of contractResult.indexedArtifacts ?? []) {
      expectedByPath.set(indexed.path, indexed);
      indexedByPath.set(indexed.path, indexed);
    }
    const allowedFiles = new Set([
      "submission.json",
      submission.initialPlan?.path,
      submission.initialPlanCheckpoint?.path,
      submission.workRecord?.path,
      ...(submission.checkpointReceipts ?? []).map(({ path: receiptPath }) => receiptPath),
      ...(submission.artifacts ?? []).map(({ path: artifactPath }) => artifactPath),
    ].filter(isSafeRelativePath));
    for (const file of files) {
      if (!allowedFiles.has(file.path)) {
        issues.push(issue("unexpected-candidate-file", "candidate bundle contains an undeclared file", file.path));
      }
    }
    const declaredByPath = new Map();
    for (const artifact of submission.artifacts ?? []) {
      const entries = declaredByPath.get(artifact.path) ?? [];
      entries.push(artifact);
      declaredByPath.set(artifact.path, entries);
      if (!expectedByPath.has(artifact.path)) {
        issues.push(issue("unexpected-declared-artifact", "submission declares an artifact outside the frozen output contract", artifact.path));
      }
    }
    for (const expected of expectedByPath.values()) {
      const declared = declaredByPath.get(expected.path) ?? [];
      if (declared.length !== 1) continue;
      const declaredArtifact = declared[0];
      const file = await readRegularFile(candidateRoot, expected.path);
      if (file.error) {
        issues.push(issue("artifact-file-unreadable", `${expected.path}: ${file.error}`, expected.path));
        continue;
      }
      const isIndexed = indexedByPath.has(expected.path);
      if (file.bytes.length > artifactLimit(expected, profile.sanitization, { indexed: isIndexed })) {
        issues.push(issue("artifact-media-size-limit", `${expected.path} exceeds the frozen ${expected.mediaType} limit`, expected.path));
      }
      if (sha256(file.bytes) !== declaredArtifact.sha256) {
        issues.push(issue("artifact-input-hash-mismatch", `${expected.path} does not match submission.json`, expected.path));
      }
      issues.push(...(isIndexed ? indexedMediaIssues(expected, file.bytes) : mediaIssues(expected, file.bytes)));
      admitted.push({
        id: declaredArtifact.id,
        path: expected.path,
        mediaType: expected.mediaType,
        inputSha256: sha256(file.bytes),
        bytes: file.bytes,
      });
    }
  }

  let report = reportBase({
    run,
    launch,
    profile,
    sanitizerProfile,
    outputRoot: out,
    bundleSha256,
    artifactContractSha256,
    sanitizerSha256,
    generatedAt,
  });
  const initialIssues = sortIssues(issues);
  if (initialIssues.length === 0) {
    report = {
      ...report,
      status: "passed",
      artifacts: admitted
        .sort((left, right) => left.path.localeCompare(right.path))
        .map((artifact) => ({
          id: artifact.id,
          path: artifact.path,
          mediaType: artifact.mediaType,
          inputSha256: artifact.inputSha256,
          outputPath: outputRelativePath(out, artifact.path),
          outputSha256: artifact.inputSha256,
          status: "admitted",
        })),
      issues: [],
    };
  } else {
    report.issues = initialIssues;
  }
  const reportProblems = frozenValidators.validateSanitizationReport(report);
  if (reportProblems.length > 0) {
    throw new Error(`Sanitization report violates the frozen schema: ${reportProblems.map(({ message }) => message).join("; ")}`);
  }

  let committed;
  if (report.status === "passed") {
    const candidateAfterRead = await bundleTreeHash(candidateRoot).catch(() => null);
    if (candidateAfterRead !== run.seal.bundleSha256) {
      report = { ...report, status: "failed", artifacts: [], issues: [issue("candidate-bytes-changed", "candidate bytes changed while sanitization was running")] };
    }
  }
  if (report.status === "passed") {
    committed = await writeReportAndCommit({ runRoot, outputPath, report, artifacts: admitted });
  } else {
    report.issues = sortIssues(report.issues);
    committed = await writeReportAndCommit({ runRoot, outputPath, report, artifacts: [] });
  }
  const result = {
    report,
    reportPath: committed.reportPath,
    reportSha256: committed.reportSha256,
    attestation: {
      actor: "evaluator",
      profileDigest: run.sanitization.profileDigest,
      status: report.status,
      sanitizedArtifactIds: report.artifacts.map(({ id }) => id),
      report: { path: committed.reportPath, sha256: committed.reportSha256 },
    },
  };
  return result;
}

async function main() {
  const projectRoot = argument("--project-root", { required: true });
  const runId = argument("--run-id", { required: true });
  const out = argument("--out") ?? "sanitized";
  const result = await sanitizeRun({ projectRoot: path.resolve(projectRoot), runId, out });
  console.log(`${result.report.status === "passed" ? "Sanitized" : "Rejected"} ${runId}: ${result.reportPath} (${result.reportSha256}).`);
  if (result.report.status !== "passed") process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
