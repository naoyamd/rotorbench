import "./official-execution-guard.mjs";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  ensureInside,
  isSafeRelativePath,
  sha256,
} from "./framework-lib.mjs";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";
import {
  validateExecutionContractSnapshot,
  validateLaunchFreeze,
} from "./stage0-lib.mjs";

const REVIEW_PACKAGE_PATH = "sanitized/review-package/review-package.json";
const REVIEW_DIRECTORY = "sanitized/reviews";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? null : process.argv[index + 1] ?? null;
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function issueText(label, issues) {
  return `${label}:\n${issues.map(({ code, message }) => `${code}: ${message}`).join("\n")}`;
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

async function readRegular(root, relative) {
  if (!isSafeRelativePath(relative)) throw new Error(`Unsafe evaluator-owned path: ${relative}`);
  const absolute = ensureInside(root, relative);
  if (!absolute) throw new Error(`Unsafe evaluator-owned path: ${relative}`);
  const [resolvedRoot, before, resolvedBefore] = await Promise.all([
    realpath(root).catch(() => null),
    lstat(absolute).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (!before?.isFile() || before.isSymbolicLink()) {
    throw new Error(`Expected a regular evaluator-owned file: ${relative}`);
  }
  if (
    !resolvedRoot
    || !resolvedBefore
    || (resolvedBefore !== resolvedRoot && !resolvedBefore.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    throw new Error(`Evaluator-owned path escapes its root: ${relative}`);
  }
  const bytes = await readFile(absolute);
  const [after, resolvedAfter] = await Promise.all([
    lstat(absolute).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (
    !after?.isFile()
    || after.isSymbolicLink()
    || after.size !== before.size
    || resolvedAfter !== resolvedBefore
  ) {
    throw new Error(`Evaluator-owned file changed while being read: ${relative}`);
  }
  return { absolute, bytes };
}

function evidenceReferences(input) {
  return [
    ...(input.gateRatings ?? []).flatMap(({ evidenceRefs }) => evidenceRefs ?? []),
    ...(input.expertRatings ?? []).flatMap(({ evidenceRefs }) => evidenceRefs ?? []),
  ];
}

function verifyReviewInputEvidence(input, validEvidenceIds) {
  const gateIds = new Set();
  for (const rating of input.gateRatings ?? []) {
    if (gateIds.has(rating.gateId)) {
      throw new Error(`Review input repeats gate ${rating.gateId}`);
    }
    gateIds.add(rating.gateId);
  }
  const dimensionIds = new Set();
  for (const rating of input.expertRatings ?? []) {
    if (dimensionIds.has(rating.dimensionId)) {
      throw new Error(`Review input repeats dimension ${rating.dimensionId}`);
    }
    dimensionIds.add(rating.dimensionId);
  }
  for (const evidenceId of evidenceReferences(input)) {
    if (!validEvidenceIds.has(evidenceId)) {
      throw new Error(`Review input references evidence absent from the sealed review package: ${evidenceId}`);
    }
  }
}

async function loadReviewPackage({ runRoot, validators }) {
  const { bytes: manifestBytes } = await readRegular(runRoot, REVIEW_PACKAGE_PATH);
  let manifest;
  try {
    manifest = JSON.parse(manifestBytes.toString("utf8"));
  } catch {
    throw new Error("Review package manifest is not valid JSON");
  }
  const issues = validators.validateReviewPackage(manifest);
  if (issues.length > 0) throw new Error(issueText("Review package is schema-invalid", issues));
  const packageRoot = path.dirname(REVIEW_PACKAGE_PATH);
  const scoring = await readRegular(runRoot, `${packageRoot}/${manifest.scoringContract.outputPath}`);
  if (sha256(scoring.bytes) !== manifest.scoringContract.outputSha256) {
    throw new Error("Review package scoring-contract bytes do not match the manifest");
  }
  const evidenceIds = new Set();
  for (const evidence of manifest.evidence) {
    if (evidenceIds.has(evidence.id)) throw new Error(`Review package repeats evidence ${evidence.id}`);
    evidenceIds.add(evidence.id);
    const file = await readRegular(runRoot, `${packageRoot}/${evidence.outputPath}`);
    if (file.bytes.length !== evidence.bytes || sha256(file.bytes) !== evidence.sha256) {
      throw new Error(`Review package evidence does not match its manifest: ${evidence.id}`);
    }
  }
  return {
    manifest,
    manifestSha256: sha256(manifestBytes),
    evidenceIds,
  };
}

async function loadFrozenRuntime({ root, run }) {
  const frozenLaunch = await validateLaunchFreeze(root, run.launchId);
  if (frozenLaunch.status !== "valid") {
    throw new Error(`Frozen launch is invalid: ${frozenLaunch.issues.map(({ code }) => code).join(", ")}`);
  }
  const launch = frozenLaunch.launch;
  if (
    launch.protocolVersion !== "4.0"
    || run.executionContractDigest !== launch.executionContractDigest
    || run.launchDigest !== launch.launchDigest
    || run.fairnessFingerprint !== launch.fairnessFingerprint
  ) {
    throw new Error("Run does not bind the verified frozen v4 launch");
  }
  const snapshotRoot = path.join(frozenLaunch.root, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(snapshotRoot, run.executionContractDigest);
  if (snapshot.status !== "valid") throw new Error("Frozen execution contract snapshot is invalid");
  const frozenToolPath = path.join(snapshotRoot, "scripts", "stage2-seal-review.mjs");
  const [frozenToolBytes, localToolBytes] = await Promise.all([
    readFile(frozenToolPath),
    readFile(fileURLToPath(import.meta.url)),
  ]);
  if (sha256(frozenToolBytes) !== sha256(localToolBytes)) {
    throw new Error("Current review-sealing implementation does not match the frozen execution-contract tool binding");
  }
  const validators = await loadFrozenContractValidators(snapshotRoot, {
    runSchemaPath: path.join(snapshotRoot, "schemas", "run.schema.json"),
  });
  const runIssues = validators.validateRun(run);
  if (runIssues.length > 0) throw new Error(issueText("Run manifest is schema-invalid", runIssues));
  return { validators };
}

function reviewerId() {
  return `rater-${randomBytes(8).toString("hex")}`;
}

/**
 * Seal one already-completed reviewer input. The source JSON intentionally has
 * no reviewer name or identity field; this evaluator-owned boundary allocates
 * the opaque pseudonym and writes an immutable record with `wx`.
 */
export async function sealReview({
  projectRoot = process.cwd(),
  runId,
  reviewPath,
  lockedAt = new Date().toISOString(),
} = {}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId ?? "")) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  if (Number.isNaN(Date.parse(lockedAt))) throw new Error("lockedAt must be an ISO-8601 date-time");
  const root = path.resolve(projectRoot);
  const runRoot = path.join(root, "runs", runId);
  const run = JSON.parse(await readFile(path.join(runRoot, "run.json"), "utf8"));
  if (run.id !== runId || run.status !== "validated" || run.seal?.sealed !== true || run.extensions?.protocolVersion !== "4.0") {
    throw new Error("Only a sealed, validated v4 run may receive a sealed review record");
  }
  if (typeof reviewPath !== "string" || !reviewPath) throw new Error("reviewPath is required");
  const runtime = await loadFrozenRuntime({ root, run });
  const reviewPackage = await loadReviewPackage({ runRoot, validators: runtime.validators });

  const sourceAbsolute = path.resolve(reviewPath);
  const sourceInfo = await lstat(sourceAbsolute).catch(() => null);
  if (!sourceInfo?.isFile() || sourceInfo.isSymbolicLink()) {
    throw new Error("Reviewer input must be a regular JSON file");
  }
  const sourceBytes = await readFile(sourceAbsolute);
  let input;
  try {
    input = JSON.parse(sourceBytes.toString("utf8"));
  } catch {
    throw new Error("Reviewer input is not valid JSON");
  }
  const inputIssues = runtime.validators.validateReviewSubmission(input);
  if (inputIssues.length > 0) throw new Error(issueText("Reviewer input is schema-invalid", inputIssues));
  verifyReviewInputEvidence(input, reviewPackage.evidenceIds);

  const reviewsRelative = REVIEW_DIRECTORY;
  const reviewsRoot = ensureInside(runRoot, reviewsRelative);
  if (!reviewsRoot) throw new Error("Review record root is unsafe");
  await mkdir(reviewsRoot, { recursive: true });
  const [resolvedRunRoot, reviewRootInfo, resolvedReviewsRoot] = await Promise.all([
    realpath(runRoot).catch(() => null),
    lstat(reviewsRoot).catch(() => null),
    realpath(reviewsRoot).catch(() => null),
  ]);
  if (
    !reviewRootInfo?.isDirectory()
    || reviewRootInfo.isSymbolicLink()
    || !resolvedRunRoot
    || !resolvedReviewsRoot
    || !resolvedReviewsRoot.startsWith(`${resolvedRunRoot}${path.sep}`)
  ) {
    throw new Error("Review record root is not a regular evaluator-owned directory");
  }
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const id = reviewerId();
    const relativePath = `${reviewsRelative}/${id}.json`;
    const destination = ensureInside(runRoot, relativePath);
    if (!destination) throw new Error("Review record destination is unsafe");
    const record = {
      schemaVersion: "1.0",
      reviewerId: id,
      role: input.role,
      lockedAt,
      reviewPackage: {
        id: reviewPackage.manifest.reviewPackageId,
        manifestSha256: reviewPackage.manifestSha256,
      },
      sourceReviewSha256: sha256(sourceBytes),
      attestations: input.attestations,
      gateRatings: input.gateRatings,
      expertRatings: input.expertRatings,
    };
    const recordIssues = runtime.validators.validateReviewRecord(record);
    if (recordIssues.length > 0) throw new Error(issueText("Generated review record is schema-invalid", recordIssues));
    const bytes = jsonBytes(record);
    try {
      await writeFile(destination, bytes, { flag: "wx" });
      return {
        reviewerId: id,
        role: record.role,
        path: relativePath,
        sha256: sha256(bytes),
        reviewPackageId: record.reviewPackage.id,
        reviewPackageManifestSha256: record.reviewPackage.manifestSha256,
      };
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EEXIST") continue;
      throw error;
    }
  }
  throw new Error("Unable to allocate a unique opaque reviewer pseudonym");
}

async function main() {
  const result = await sealReview({
    projectRoot: path.resolve(argument("--project-root", { required: true })),
    runId: argument("--run-id", { required: true }),
    reviewPath: path.resolve(argument("--review", { required: true })),
    ...(argument("--at") ? { lockedAt: argument("--at") } : {}),
  });
  console.log(`Sealed ${result.role} review ${result.reviewerId}: ${result.path} (${result.sha256}).`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
