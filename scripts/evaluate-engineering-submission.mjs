import "./official-execution-guard.mjs";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bundleTreeHash,
  loadFrozenContractValidators,
  validateCandidateBundle,
} from "./stage-contract.mjs";
import {
  canonicalJson,
  manifestDigest,
  sha256,
  validateRun,
} from "./framework-lib.mjs";
import { validateArtifactContract } from "./artifact-contract.mjs";
import {
  validateExecutionContractSnapshot,
  validateFrozenPacket,
  validateLaunchFreeze,
} from "./stage0-lib.mjs";

function parseArgument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function problemList(label, issues) {
  return `${label}:\n${issues
    .map((issue) => typeof issue === "string"
      ? issue
      : `${issue.code}: ${issue.message}`)
    .join("\n")}`;
}

function pathInside(root, relativePath) {
  const candidate = path.resolve(root, relativePath);
  const relative = path.relative(path.resolve(root), candidate);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Unsafe path outside ${root}: ${relativePath}`);
  }
  return candidate;
}

async function readRegularInside(root, relativePath) {
  if (typeof relativePath !== "string" || !relativePath) {
    throw new Error("Evaluator-owned review path is missing");
  }
  const absolute = pathInside(root, relativePath);
  const [resolvedRoot, before, resolvedBefore] = await Promise.all([
    realpath(root).catch(() => null),
    lstat(absolute).catch(() => null),
    realpath(absolute).catch(() => null),
  ]);
  if (!before?.isFile() || before.isSymbolicLink()) {
    throw new Error(`Evaluator-owned review path is not a regular file: ${relativePath}`);
  }
  if (
    !resolvedRoot
    || !resolvedBefore
    || (resolvedBefore !== resolvedRoot && !resolvedBefore.startsWith(`${resolvedRoot}${path.sep}`))
  ) {
    throw new Error(`Evaluator-owned review path escapes its root: ${relativePath}`);
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
    throw new Error(`Evaluator-owned review path changed while being read: ${relativePath}`);
  }
  return { absolute, bytes };
}

function reviewEvidenceRefs(record) {
  return [
    ...(record.gateRatings ?? []).flatMap(({ evidenceRefs }) => evidenceRefs ?? []),
    ...(record.expertRatings ?? []).flatMap(({ evidenceRefs }) => evidenceRefs ?? []),
  ];
}

/**
 * The assessment is deliberately a manifest of immutable evaluator-owned
 * records, not a place where an operator can retype reviewer votes. Re-read
 * every declared byte before scoring so review-package or review-record swaps
 * fail closed.
 */
export async function loadBoundReviewRecords({
  runRoot,
  assessment,
  validators,
  scoringContractDigest,
}) {
  const packageRef = assessment.reviewPackage;
  const recordRefs = assessment.reviewRecords ?? [];
  if (packageRef === null) {
    if (recordRefs.length > 0) throw new Error("Review records require a bound review package");
    return { reviewAudit: null, reviewers: [], gateRatings: [], ratings: [] };
  }
  if (!packageRef || packageRef.path !== "sanitized/review-package/review-package.json") {
    throw new Error("Assessment must bind the canonical evaluator-owned review package manifest");
  }
  if (!/^[a-f0-9]{64}$/.test(packageRef.sha256 ?? "")) {
    throw new Error("Assessment review-package hash must be a concrete SHA-256 value");
  }
  const packageFile = await readRegularInside(runRoot, packageRef.path);
  if (sha256(packageFile.bytes) !== packageRef.sha256) {
    throw new Error("Review package manifest bytes do not match the assessment binding");
  }
  let reviewPackage;
  try {
    reviewPackage = JSON.parse(packageFile.bytes.toString("utf8"));
  } catch {
    throw new Error("Review package manifest is not valid JSON");
  }
  const packageIssues = validators.validateReviewPackage(reviewPackage);
  if (packageIssues.length > 0) throw new Error(problemList("Review package is schema-invalid", packageIssues));
  if (reviewPackage.reviewPackageId !== packageRef.id) {
    throw new Error("Review package ID does not match the assessment binding");
  }
  if (reviewPackage.scoringContract.sha256 !== scoringContractDigest) {
    throw new Error("Review package does not bind the frozen scoring contract");
  }
  const packageRoot = path.dirname(packageRef.path);
  const scoringFile = await readRegularInside(runRoot, `${packageRoot}/${reviewPackage.scoringContract.outputPath}`);
  if (sha256(scoringFile.bytes) !== reviewPackage.scoringContract.outputSha256) {
    throw new Error("Review package scoring-contract bytes do not match the manifest");
  }
  const validEvidenceIds = new Set();
  for (const evidence of reviewPackage.evidence) {
    if (validEvidenceIds.has(evidence.id)) throw new Error(`Review package repeats evidence ${evidence.id}`);
    validEvidenceIds.add(evidence.id);
    const evidenceFile = await readRegularInside(runRoot, `${packageRoot}/${evidence.outputPath}`);
    if (evidenceFile.bytes.length !== evidence.bytes || sha256(evidenceFile.bytes) !== evidence.sha256) {
      throw new Error(`Review package evidence does not match its manifest: ${evidence.id}`);
    }
  }
  const reviewerIds = new Set();
  const recordPaths = new Set();
  const reviewers = [];
  const gateRatings = [];
  const ratings = [];
  const auditRecords = [];
  for (const ref of recordRefs) {
    if (!/^[a-f0-9]{64}$/.test(ref.sha256 ?? "")) {
      throw new Error("Review-record hash must be a concrete SHA-256 value");
    }
    if (recordPaths.has(ref.path)) throw new Error(`Assessment repeats review-record path ${ref.path}`);
    recordPaths.add(ref.path);
    const recordFile = await readRegularInside(runRoot, ref.path);
    if (sha256(recordFile.bytes) !== ref.sha256) {
      throw new Error(`Review-record bytes do not match the assessment binding: ${ref.path}`);
    }
    let record;
    try {
      record = JSON.parse(recordFile.bytes.toString("utf8"));
    } catch {
      throw new Error(`Review record is not valid JSON: ${ref.path}`);
    }
    const recordIssues = validators.validateReviewRecord(record);
    if (recordIssues.length > 0) throw new Error(problemList(`Review record ${ref.path} is schema-invalid`, recordIssues));
    if (ref.path !== `sanitized/reviews/${record.reviewerId}.json`) {
      throw new Error(`Review record path does not match its opaque reviewer pseudonym: ${ref.path}`);
    }
    if (reviewerIds.has(record.reviewerId)) throw new Error(`Assessment repeats reviewer ${record.reviewerId}`);
    reviewerIds.add(record.reviewerId);
    if (
      record.reviewPackage.id !== reviewPackage.reviewPackageId
      || record.reviewPackage.manifestSha256 !== packageRef.sha256
    ) {
      throw new Error(`Review record ${record.reviewerId} binds a different review package`);
    }
    for (const evidenceId of reviewEvidenceRefs(record)) {
      if (!validEvidenceIds.has(evidenceId)) {
        throw new Error(`Review record ${record.reviewerId} references unknown package evidence ${evidenceId}`);
      }
    }
    reviewers.push({ id: record.reviewerId, role: record.role, ...record.attestations });
    gateRatings.push(...record.gateRatings.map((rating) => ({ ...rating, raterId: record.reviewerId })));
    ratings.push(...record.expertRatings.map((rating) => ({ ...rating, raterId: record.reviewerId })));
    auditRecords.push({ path: ref.path, sha256: ref.sha256, reviewerId: record.reviewerId, role: record.role });
  }
  return {
    reviewAudit: {
      reviewPackage: { id: packageRef.id, path: packageRef.path, sha256: packageRef.sha256 },
      records: auditRecords.sort((left, right) => left.reviewerId.localeCompare(right.reviewerId)),
    },
    reviewers,
    gateRatings,
    ratings,
  };
}

async function loadFrozenEvaluationContext(projectRoot, runId) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(runId)) {
    throw new Error("run ID must use lowercase kebab-case");
  }
  const runRoot = path.join(projectRoot, "runs", runId);
  const run = await readJson(path.join(runRoot, "run.json"));
  const runIssues = validateRun(run);
  if (runIssues.length > 0) {
    throw new Error(problemList("Run manifest is invalid", runIssues));
  }
  if (
    run.id !== runId
    || run.extensions?.protocolVersion !== "4.0"
    || run.status !== "validated"
    || run.seal?.sealed !== true
  ) {
    throw new Error("Evaluation requires the named sealed, validated v4 run");
  }
  const candidateRoot = pathInside(runRoot, run.seal.bundlePath);
  const candidateBundleSha256 = await bundleTreeHash(candidateRoot);
  if (candidateBundleSha256 !== run.seal.bundleSha256) {
    throw new Error("Sealed candidate bundle hash no longer matches run.json");
  }

  const launchFreeze = await validateLaunchFreeze(projectRoot, run.launchId);
  if (launchFreeze.status !== "valid") {
    throw new Error(problemList(
      "Frozen launch is invalid",
      launchFreeze.issues,
    ));
  }
  if (launchFreeze.release?.status !== "live-verified") {
    throw new Error("Evaluation requires a live-verified launch");
  }
  const launch = launchFreeze.launch;
  if (
    launch.id !== run.launchId
    || launch.taskPacket.id !== run.benchmarkId
    || launch.taskPacket.version !== run.benchmarkVersion
    || launch.taskPacket.digest !== run.taskPacketDigest
    || launch.taskPacket.bundleDigest !== run.taskPacketBundleDigest
    || launch.executionContractDigest !== run.executionContractDigest
    || launch.promptSha256 !== run.promptSha256
    || launch.launchDigest !== run.launchDigest
    || launch.fairnessFingerprint !== run.fairnessFingerprint
  ) {
    throw new Error("Run does not exactly bind the frozen live launch");
  }

  const packetRoot = path.join(
    projectRoot,
    "task-packets",
    launch.taskPacket.id,
    launch.taskPacket.version,
  );
  const frozenPacket = await validateFrozenPacket(packetRoot);
  if (frozenPacket.status !== "valid") {
    throw new Error(problemList(
      "Frozen task packet is invalid",
      frozenPacket.issues,
    ));
  }
  const packet = frozenPacket.packet;
  const snapshotRoot = path.join(launchFreeze.root, "execution-contract");
  const snapshot = await validateExecutionContractSnapshot(
    snapshotRoot,
    launch.executionContractDigest,
  );
  if (snapshot.status !== "valid") {
    throw new Error(problemList(
      "Frozen execution contract is invalid",
      snapshot.issues,
    ));
  }
  const assessmentSchemaPath = path.join(
    snapshotRoot,
    "evaluation",
    "integrated-robotic-handling-v1",
    "assessment.schema.json",
  );
  const contractValidators = await loadFrozenContractValidators(snapshotRoot, {
    assessmentSchemaPath,
  });
  if (typeof contractValidators.validateAssessment !== "function") {
    throw new Error("Frozen execution contract has no assessment schema validator");
  }
  const frozenArtifactModule = await import(
    pathToFileURL(
      path.join(snapshotRoot, "scripts", "artifact-contract.mjs"),
    ).href,
  );
  if (typeof frozenArtifactModule.validateArtifactContract !== "function") {
    throw new Error("Frozen execution contract has no artifact validator");
  }

  const scoringInput = packet.inputs.find(({ id }) => id === "scoring-contract");
  if (!scoringInput) {
    throw new Error("Frozen task packet has no public scoring contract");
  }
  const scoringPath = pathInside(packetRoot, scoringInput.path);
  const scoringBytes = await readFile(scoringPath);
  const scoringContractDigest = sha256(scoringBytes);
  if (
    scoringContractDigest !== scoringInput.sha256
    || scoringContractDigest !== launch.v4Contract?.evaluationContract?.digest
    || scoringContractDigest !== run.evaluation?.contractDigest
  ) {
    throw new Error("Scoring contract bytes do not match the packet, launch, and run");
  }
  return {
    run,
    runRoot,
    candidateRoot,
    packetRoot,
    packet,
    launch,
    scoringBytes,
    scoringContractDigest,
    contractValidators,
    artifactContractValidator: frozenArtifactModule.validateArtifactContract,
  };
}

function compareCheckpoint(left, right, contract) {
  const order = new Map(
    contract.checkpoints.map(({ id }, index) => [id, index]),
  );
  return (order.get(left) ?? -1) - (order.get(right) ?? -1);
}

function resultFromChecks(checks) {
  if (checks.length === 0) return "not-evaluable";
  if (checks.some(({ result }) => result === "fail")) return "fail";
  if (checks.every(({ result }) => result === "pass")) return "pass";
  if (checks.some(({ result }) => result === "evaluator-unsupported")) {
    return "evaluator-unsupported";
  }
  if (checks.some(({ result }) => result === "evaluator-uncertain")) {
    return "evaluator-uncertain";
  }
  return "not-evaluable";
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function normalizeCheck(check) {
  const permitted = new Set([
    "pass",
    "fail",
    "not-evaluable",
    "evaluator-unsupported",
    "evaluator-uncertain",
  ]);
  if (!check || typeof check.id !== "string" || typeof check.gateId !== "string") {
    throw new Error("Every automatic check requires id and gateId");
  }
  if (!permitted.has(check.result)) {
    throw new Error(`Unsupported automatic-check result: ${check.result}`);
  }
  return {
    id: check.id,
    gateId: check.gateId,
    result: check.result,
    evidenceRefs: Array.isArray(check.evidenceRefs) ? check.evidenceRefs : [],
    detail: typeof check.detail === "string" ? check.detail : "",
  };
}

function reviewerVoteResult(ratings) {
  if (ratings.length === 0) return "not-evaluable";
  const counts = new Map();
  for (const { result } of ratings) {
    counts.set(result, (counts.get(result) ?? 0) + 1);
  }
  const ranked = [...counts.entries()].sort((left, right) => right[1] - left[1]);
  if (ranked.length === 1 || ranked[0][1] > ranked[1][1]) return ranked[0][0];
  return "evaluator-uncertain";
}

function combineGateResults(automaticResult, reviewerResult, hasAutomaticChecks) {
  const values = hasAutomaticChecks
    ? [automaticResult, reviewerResult]
    : [reviewerResult];
  if (values.includes("fail")) return "fail";
  if (values.every((value) => value === "pass")) return "pass";
  if (values.includes("evaluator-unsupported")) return "evaluator-unsupported";
  if (values.includes("evaluator-uncertain")) return "evaluator-uncertain";
  return "not-evaluable";
}

function buildGateResults(contract, checks, admissionStatus, gateRatings) {
  const gates = [contract.admissionGate, ...contract.baselineGates];
  return gates.map(({ id, label }) => {
    if (id === "A0") {
      return {
        id,
        label,
        result: admissionStatus,
        checks: checks.filter(({ gateId }) => gateId === id),
      };
    }
    const gateChecks = checks.filter(({ gateId }) => gateId === id);
    const reviewerRatings = gateRatings.filter(({ gateId }) => gateId === id);
    return {
      id,
      label,
      result: combineGateResults(
        resultFromChecks(gateChecks),
        reviewerVoteResult(reviewerRatings),
        gateChecks.length > 0,
      ),
      checks: gateChecks,
      reviewerRatings,
    };
  });
}

function dimensionResult(dimension, ratings, minimumRaters, highestCheckpoint) {
  const relevant = ratings.filter(({ dimensionId }) => dimensionId === dimension.id);
  const scored = relevant.filter(({ status }) => status === "scored");
  const distinctRaters = new Set(scored.map(({ raterId }) => raterId));
  const statuses = new Set(relevant.map(({ status }) => status));
  const evidenceRefs = [...new Set(
    relevant.flatMap(({ evidenceRefs }) => evidenceRefs ?? []),
  )].sort();
  if (statuses.has("evaluator-unsupported")) {
    return {
      id: dimension.id,
      label: dimension.label,
      attempted: relevant.length > 0,
      evidenceCoverage: evidenceRefs.length,
      evaluable: false,
      passFail: "not-evaluable",
      score: null,
      scoreInterval: null,
      failureCause: "evaluator-unsupported",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: relevant,
    };
  }
  if (statuses.has("evaluator-uncertain")) {
    return {
      id: dimension.id,
      label: dimension.label,
      attempted: true,
      evidenceCoverage: evidenceRefs.length,
      evaluable: false,
      passFail: "not-evaluable",
      score: null,
      scoreInterval: null,
      failureCause: "evaluator-uncertain",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: relevant,
    };
  }
  if (distinctRaters.size < minimumRaters) {
    return {
      id: dimension.id,
      label: dimension.label,
      attempted: relevant.length > 0,
      evidenceCoverage: evidenceRefs.length,
      evaluable: false,
      passFail: "not-evaluable",
      score: null,
      scoreInterval: null,
      failureCause: relevant.length > 0 ? "missing-evidence" : "not-attempted",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: relevant,
    };
  }
  const scores = scored.map(({ score }) => score);
  const minimum = Math.min(...scores);
  const maximum = Math.max(...scores);
  const requiresAdjudication = maximum - minimum > 1 && distinctRaters.size < 3;
  return {
    id: dimension.id,
    label: dimension.label,
    attempted: true,
    evidenceCoverage: evidenceRefs.length,
    evaluable: !requiresAdjudication,
    passFail: requiresAdjudication ? "not-evaluable" : "scored",
    score: requiresAdjudication ? null : median(scores),
    scoreInterval: requiresAdjudication ? null : [minimum, maximum],
    failureCause: requiresAdjudication ? "evaluator-uncertain" : null,
    highestVerifiedCheckpoint: highestCheckpoint,
    ratings: relevant,
  };
}

export function validateReviewers(contract, reviewers, gateRatings, expertRatings) {
  const minimumRaters = contract.reviewProtocol.minimumIndependentRaters;
  const reviewerIds = new Set();
  for (const reviewer of reviewers) {
    if (reviewerIds.has(reviewer.id)) {
      throw new Error(`Duplicate reviewer ${reviewer.id}`);
    }
    reviewerIds.add(reviewer.id);
    if (
      reviewer.independentFromCandidate !== true
      || reviewer.independentFromOtherReviewers !== true
      || reviewer.blindToCandidateIdentity !== true
      || reviewer.reviewedSanitizedEvidenceOnly !== true
      || reviewer.ratingLockedBeforeAdjudication !== true
    ) {
      throw new Error(`Reviewer ${reviewer.id} lacks the required independence and blinding attestations`);
    }
  }
  if (reviewerIds.size < minimumRaters) {
    throw new Error(`At least ${minimumRaters} independent reviewers are required`);
  }
  if (!reviewers.some(({ role }) => role === "primary") || !reviewers.some(({ role }) => role === "secondary")) {
    throw new Error("A scored review requires distinct sealed primary and secondary reviewers");
  }
  for (const rating of [...gateRatings, ...expertRatings]) {
    if (!reviewerIds.has(rating.raterId)) {
      throw new Error(`Rating references undeclared reviewer ${rating.raterId}`);
    }
  }
  const adjudicatorIds = new Set(
    reviewers
      .filter(({ role }) => role === "adjudicator")
      .map(({ id }) => id),
  );
  for (const gate of contract.baselineGates) {
    const relevant = gateRatings.filter(({ gateId }) => gateId === gate.id);
    const raters = new Set(relevant.map(({ raterId }) => raterId));
    if (raters.size < minimumRaters) {
      throw new Error(`Gate ${gate.id} requires ${minimumRaters} independent reviewer verdicts`);
    }
    if (relevant.length !== raters.size) {
      throw new Error(`Gate ${gate.id} has duplicate verdicts from one reviewer`);
    }
    const distinctResults = new Set(relevant.map(({ result }) => result));
    if (
      distinctResults.size > 1
      && (
        raters.size < 3
        || !relevant.some(({ raterId }) => adjudicatorIds.has(raterId))
      )
    ) {
      throw new Error(`Gate ${gate.id} conflict requires a third independent adjudicator`);
    }
  }
  for (const dimension of contract.dimensions) {
    const relevant = expertRatings.filter(
      ({ dimensionId }) => dimensionId === dimension.id,
    );
    const raters = new Set(relevant.map(({ raterId }) => raterId));
    if (raters.size < minimumRaters) {
      throw new Error(`Dimension ${dimension.id} requires ${minimumRaters} independent ratings`);
    }
    if (relevant.length !== raters.size) {
      throw new Error(`Dimension ${dimension.id} has duplicate ratings from one reviewer`);
    }
    const scored = relevant.filter(({ status }) => status === "scored");
    if (
      scored.length > 1
      && Math.max(...scored.map(({ score }) => score))
        - Math.min(...scored.map(({ score }) => score)) > 1
      && (
        raters.size < 3
        || !relevant.some(({ raterId }) => adjudicatorIds.has(raterId))
      )
    ) {
      throw new Error(`Dimension ${dimension.id} disagreement requires a third independent adjudicator`);
    }
  }
  return reviewerIds;
}

function validateGateRatings(contract, ratings) {
  const gateIds = new Set(contract.baselineGates.map(({ id }) => id));
  const permitted = new Set([
    "pass",
    "fail",
    "not-evaluable",
    "evaluator-unsupported",
    "evaluator-uncertain",
  ]);
  return ratings.map((rating) => {
    if (!gateIds.has(rating.gateId)) {
      throw new Error(`Unknown baseline gate ${rating.gateId}`);
    }
    if (typeof rating.raterId !== "string" || rating.raterId.length === 0) {
      throw new Error("Every gate rating requires a raterId");
    }
    if (!permitted.has(rating.result)) {
      throw new Error(`Unsupported gate-rating result ${rating.result}`);
    }
    return {
      raterId: rating.raterId,
      gateId: rating.gateId,
      result: rating.result,
      evidenceRefs: Array.isArray(rating.evidenceRefs)
        ? [...new Set(rating.evidenceRefs)].sort()
        : [],
      rationale: typeof rating.rationale === "string" ? rating.rationale : "",
    };
  });
}

function validateRatings(contract, ratings) {
  const dimensionIds = new Set(contract.dimensions.map(({ id }) => id));
  const permittedStatuses = new Set(contract.reviewProtocol.permittedStatuses);
  return ratings.map((rating) => {
    if (!dimensionIds.has(rating.dimensionId)) {
      throw new Error(`Unknown dimension ${rating.dimensionId}`);
    }
    if (typeof rating.raterId !== "string" || rating.raterId.length === 0) {
      throw new Error("Every expert rating requires a raterId");
    }
    if (!permittedStatuses.has(rating.status)) {
      throw new Error(`Unsupported expert-rating status ${rating.status}`);
    }
    if (
      rating.status === "scored"
      && (
        !Number.isInteger(rating.score)
        || rating.score < contract.ratingScale.minimum
        || rating.score > contract.ratingScale.maximum
      )
    ) {
      throw new Error(
        `Scored rating ${rating.raterId}/${rating.dimensionId} is outside the ordinal scale`,
      );
    }
    return {
      raterId: rating.raterId,
      dimensionId: rating.dimensionId,
      status: rating.status,
      ...(rating.status === "scored" ? { score: rating.score } : {}),
      evidenceRefs: Array.isArray(rating.evidenceRefs)
        ? [...new Set(rating.evidenceRefs)].sort()
        : [],
      rationale: typeof rating.rationale === "string" ? rating.rationale : "",
    };
  });
}

function outputCoverage(packet, submission, artifactContract = null) {
  const required = (packet.requiredOutputs ?? [])
    .filter((output) => typeof output === "object")
    .map(({ id }) => id);
  const present = new Set(
    (submission?.artifacts ?? [])
      .filter(({ status }) => status === "present" || status === "processed")
      .flatMap(({ requiredOutputRefs }) => requiredOutputRefs ?? []),
  );
  const covered = required.filter((id) => present.has(id));
  return {
    required: required.length,
    covered: covered.length,
    ratio: required.length === 0 ? 1 : covered.length / required.length,
    missingOutputRefs: required.filter((id) => !present.has(id)),
    ...(artifactContract?.coverage ? { artifactContract: artifactContract.coverage } : {}),
    ...(artifactContract?.deferred?.length
      ? { deferredArtifactObligations: artifactContract.deferred }
      : {}),
  };
}

export async function evaluateEngineeringSubmission({
  candidateRoot,
  packetRoot,
  packet,
  launch,
  assessment,
  scoringContract,
  scoringContractDigest,
  contractValidators,
  artifactContractValidator = validateArtifactContract,
  boundReviews = null,
}) {
  if (scoringContract.schemaVersion !== "4.0") {
    throw new Error("Scoring contract must use schemaVersion 4.0");
  }
  if (assessment.schemaVersion !== "4.0") {
    throw new Error("Assessment must use schemaVersion 4.0");
  }
  if (!scoringContract.panels.some(({ id }) => id === assessment.panel)) {
    throw new Error(`Unknown assessment panel ${assessment.panel}`);
  }
  const scoringDigest = scoringContractDigest
    ?? sha256(Buffer.from(`${canonicalJson(scoringContract)}\n`));
  const declaredDigest = assessment.scoringContract?.sha256;
  if (declaredDigest && !/^<.*>$/.test(declaredDigest) && declaredDigest !== scoringDigest) {
    throw new Error("Assessment scoring-contract digest does not match");
  }

  const candidateValidation = await validateCandidateBundle(candidateRoot, {
    ...(contractValidators ? { contractValidators } : {}),
  });
  const submission = candidateValidation.submission;
  if (!submission) {
    throw new Error("Candidate submission manifest is unavailable");
  }
  if (!launch || launch.protocolVersion !== "4.0") {
    throw new Error("Evaluation requires the frozen Stage 1 v4 launch");
  }
  if (
    launch.id !== assessment.launchId
    || submission.launchId !== launch.id
    || submission.fairnessFingerprint !== launch.fairnessFingerprint
    || assessment.fairnessFingerprint !== launch.fairnessFingerprint
  ) {
    throw new Error("Assessment, submission, and frozen launch bindings do not match");
  }
  if (
    packet.id !== launch.taskPacket.id
    || packet.version !== launch.taskPacket.version
    || submission.taskPacket.id !== launch.taskPacket.id
    || submission.taskPacket.version !== launch.taskPacket.version
    || submission.taskPacket.digest !== launch.taskPacket.digest
    || submission.taskPacket.bundleDigest !== launch.taskPacket.bundleDigest
    || manifestDigest(packet) !== launch.taskPacket.digest
    || submission.executionContractDigest !== launch.executionContractDigest
    || submission.promptSha256 !== launch.promptSha256
    || submission.launchDigest !== launch.launchDigest
    || canonicalJson(submission.v4Contract) !== canonicalJson(launch.v4Contract)
    || canonicalJson(packet.v4Contract) !== canonicalJson(launch.v4Contract)
  ) {
    throw new Error("Assessment packet does not match the frozen launch and submission");
  }
  if (
    launch.v4Contract?.evaluationContract?.digest !== scoringDigest
    || packet.v4Contract?.evaluationContract?.digest !== scoringDigest
  ) {
    throw new Error("Frozen v4 evaluation contract does not match the scoring contract bytes");
  }
  if (
    submission.sanitizationRequest?.profileDigest
      !== launch.v4Contract?.sanitizationProfile?.digest
    || assessment.sanitization?.profileDigest
      !== launch.v4Contract?.sanitizationProfile?.digest
  ) {
    throw new Error("Candidate and evaluator sanitization records do not bind the frozen profile");
  }
  const artifactContract = await artifactContractValidator({
    candidateRoot,
    packetRoot,
    packet,
    submission,
  });
  let candidateBundleSha256 = null;
  try {
    candidateBundleSha256 = await bundleTreeHash(candidateRoot);
  } catch {
    // The A0 result below retains an invalid tree as artifact-invalid.
  }
  if (
    assessment.candidateBundleSha256
    && !/^<.*>$/.test(assessment.candidateBundleSha256)
    && candidateBundleSha256
    && assessment.candidateBundleSha256 !== candidateBundleSha256
  ) {
    throw new Error("Assessment candidate bundle digest does not match");
  }

  const checks = (assessment.automaticChecks ?? []).map(normalizeCheck);
  const a0Checks = checks.filter(({ gateId }) => gateId === "A0");
  const receiptByCheckpoint = new Map(
    (submission.checkpointReceipts ?? []).map((receipt) => [receipt.checkpointId, receipt]),
  );
  let receiptAttestationValid = true;
  const assessmentReceiptIds = new Set();
  for (const receipt of assessment.checkpointReceipts ?? []) {
    if (assessmentReceiptIds.has(receipt.checkpointId)) {
      throw new Error(`Assessment repeats checkpoint ${receipt.checkpointId}`);
    }
    assessmentReceiptIds.add(receipt.checkpointId);
    const sealed = receiptByCheckpoint.get(receipt.checkpointId);
    if (
      !sealed
      || sealed.sha256 !== receipt.receiptSha256
      || receipt.status !== "verified"
    ) {
      receiptAttestationValid = false;
    }
  }
  for (const [checkpointId] of receiptByCheckpoint) {
    if (!assessmentReceiptIds.has(checkpointId)) receiptAttestationValid = false;
  }
  const admissionResult =
    candidateValidation.status === "valid"
    && (artifactContract.status === "valid" || artifactContract.status === "not-applicable")
    && assessment.sanitization.status === "passed"
    && a0Checks.length > 0
    && a0Checks.every(({ result }) => result === "pass")
    && receiptAttestationValid
      ? "pass"
      : "fail";
  if (!boundReviews) {
    throw new Error("Scoring requires evaluator-verified immutable review records");
  }
  const gateRatings = validateGateRatings(scoringContract, boundReviews.gateRatings);
  const ratings = validateRatings(scoringContract, boundReviews.ratings);
  if (admissionResult === "pass") {
    if (!boundReviews.reviewAudit) {
      throw new Error("An admitted result requires a bound review package and sealed review records");
    }
    validateReviewers(
      scoringContract,
      boundReviews.reviewers,
      gateRatings,
      ratings,
    );
  }
  const gates = buildGateResults(
    scoringContract,
    checks,
    admissionResult,
    gateRatings,
  );
  const verifiedReceipts = (
    candidateValidation.status === "valid"
      ? submission.partialAttainment.completedCheckpointIds
      : []
  )
    .filter((checkpointId) =>
      scoringContract.checkpoints.some(({ id }) => id === checkpointId),
    )
    .sort((left, right) => compareCheckpoint(left, right, scoringContract));
  const highestCheckpoint = verifiedReceipts.at(-1) ?? null;
  const dimensions = scoringContract.dimensions.map((dimension) =>
    dimensionResult(
      dimension,
      ratings,
      scoringContract.reviewProtocol.minimumIndependentRaters,
      highestCheckpoint,
    ),
  );
  const gateMap = new Map(gates.map((gate) => [gate.id, gate.result]));
  const baselineQualified = scoringContract.baselineGates
    .filter(({ id }) => id !== "B0")
    .every(({ id }) => gateMap.get(id) === "pass");
  const completeness = outputCoverage(packet, submission, artifactContract);

  return {
    schemaVersion: "4.0",
    runId: assessment.runId,
    evaluationContractDigest: scoringDigest,
    scoringVersion: scoringContract.version,
    benchmarkId: scoringContract.benchmarkId,
    scoringContract: {
      id: scoringContract.id,
      version: scoringContract.version,
      sha256: scoringDigest,
    },
    panel: assessment.panel,
    launchId: assessment.launchId,
    fairnessFingerprint: assessment.fairnessFingerprint,
    candidateBundleSha256,
    evaluatedAt: assessment.evaluatedAt,
    sanitization: assessment.sanitization,
    status: admissionResult === "pass" ? "admitted" : "artifact-invalid",
    admissionIssues: [
      ...(candidateValidation.issues ?? []),
      ...(artifactContract.admissionIssues ?? []),
    ],
    qualification: {
      baselineQualified,
      changeQualified: assessment.panel === "change-response"
        ? baselineQualified
        : null,
      changeFailureDoesNotEraseBaseline: true,
    },
    gates,
    outputCoverage: completeness,
    attainment: {
      highestVerifiedCheckpoint: highestCheckpoint,
      verifiedCheckpointRefs: verifiedReceipts,
    },
    dimensions,
    rawMetrics: assessment.rawMetrics ?? [],
    compositeScore: null,
    compositeScorePublished: false,
    efficiency: {
      separateFromDesignQuality: true,
      values: assessment.efficiency ?? {},
    },
    ...(boundReviews.reviewAudit ? { reviewAudit: boundReviews.reviewAudit } : {}),
  };
}

/**
 * Score one sealed run using the evaluator implementation that is bundled with
 * its launch execution contract.  The live runner imports this export from the
 * frozen snapshot; keeping the complete run flow here prevents later changes
 * to the workspace evaluator from altering a historical result.
 */
export async function scoreEngineeringRun({
  projectRoot = process.cwd(),
  runId,
  assessmentPath,
  outputPath,
} = {}) {
  if (typeof runId !== "string" || !runId) {
    throw new Error("Missing required runId");
  }
  if (typeof assessmentPath !== "string" || !assessmentPath) {
    throw new Error("Missing required assessmentPath");
  }
  if (typeof outputPath !== "string" || !outputPath) {
    throw new Error("Missing required outputPath");
  }
  const root = path.resolve(projectRoot);
  const resolvedAssessmentPath = path.resolve(assessmentPath);
  const resolvedOutputPath = path.resolve(outputPath);
  const [context, assessment] = await Promise.all([
    loadFrozenEvaluationContext(root, runId),
    readJson(resolvedAssessmentPath),
  ]);
  const assessmentIssues = context.contractValidators.validateAssessment(assessment);
  if (assessmentIssues.length > 0) {
    throw new Error(problemList("Assessment does not satisfy the frozen task-specific schema", assessmentIssues));
  }
  if (assessment.runId !== runId) {
    throw new Error("Assessment runId does not match --run-id");
  }
  const scoringContract = JSON.parse(context.scoringBytes.toString("utf8"));
  const boundReviews = await loadBoundReviewRecords({
    runRoot: context.runRoot,
    assessment,
    validators: context.contractValidators,
    scoringContractDigest: context.scoringContractDigest,
  });
  const result = await evaluateEngineeringSubmission({
    candidateRoot: context.candidateRoot,
    packetRoot: context.packetRoot,
    packet: context.packet,
    launch: context.launch,
    assessment,
    scoringContract,
    scoringContractDigest: context.scoringContractDigest,
    contractValidators: context.contractValidators,
    artifactContractValidator: context.artifactContractValidator,
    boundReviews,
  });
  await writeFile(resolvedOutputPath, `${JSON.stringify(result, null, 2)}\n`, {
    flag: "wx",
  });
  return result;
}

async function main() {
  const result = await scoreEngineeringRun({
    projectRoot: parseArgument("--project-root", { required: false }) || process.cwd(),
    runId: parseArgument("--run-id"),
    assessmentPath: parseArgument("--assessment"),
    outputPath: parseArgument("--out"),
  });
  console.log(
    `Evaluation ${result.status}; baseline qualified: ${result.qualification.baselineQualified}; no composite score emitted.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
