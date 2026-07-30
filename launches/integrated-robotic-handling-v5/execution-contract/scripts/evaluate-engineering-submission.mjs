import "./official-execution-guard.mjs";
import { lstat, readFile, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  bundleTreeHash,
  loadAuthoritativeOutputContract,
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

const assessmentSchemaByScoringVersion = Object.freeze({
  "1.1": "evaluation/integrated-robotic-handling-v1/assessment.schema.json",
  "1.2": "evaluation/integrated-robotic-handling-v1.10/assessment.schema.json",
});

/**
 * Assessment evidence is evaluated with the schema that was frozen with the
 * task's public scoring contract.  This deliberately fails closed rather than
 * letting a newer evaluator silently apply the wrong scoring-era schema.
 */
export function assessmentSchemaRelativePathForScoringVersion(scoringVersion) {
  const relativePath = assessmentSchemaByScoringVersion[scoringVersion];
  if (!relativePath) {
    throw new Error(`No frozen assessment schema is registered for scoring version ${scoringVersion}`);
  }
  return relativePath;
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
    ...(record.expertRatings ?? []).flatMap(({ criterionCoverage }) =>
      (criterionCoverage ?? []).flatMap(({ evidenceRefs }) => evidenceRefs ?? [])),
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
  const taskScoringVersion = packet.v4Contract?.scoringVersion;
  const assessmentSchemaPath = path.join(
    snapshotRoot,
    ...assessmentSchemaRelativePathForScoringVersion(taskScoringVersion).split("/"),
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
  const scoringContract = JSON.parse(scoringBytes.toString("utf8"));
  if (scoringContract.version !== taskScoringVersion) {
    throw new Error("Task scoring version does not match the frozen scoring contract");
  }
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
    scoringContract,
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

function checkpointReached(highestCheckpoint, requiredCheckpoint, contract) {
  if (!requiredCheckpoint) return true;
  if (!highestCheckpoint) return false;
  return compareCheckpoint(highestCheckpoint, requiredCheckpoint, contract) >= 0;
}

function checkpointAttempted(
  attemptedCheckpointIds,
  highestCheckpoint,
  requiredCheckpoint,
  contract,
) {
  if (!requiredCheckpoint) return true;
  return checkpointReached(highestCheckpoint, requiredCheckpoint, contract)
    || attemptedCheckpointIds.has(requiredCheckpoint);
}

function panelGateIds(contract, panel) {
  const known = new Set(contract.baselineGates.map(({ id }) => id));
  const configured = contract.panelGateApplicability?.[panel];
  const ids = configured ?? contract.baselineGates.map(({ id }) => id);
  if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !known.has(id))) {
    throw new Error(`Scoring contract has an invalid gate applicability declaration for panel ${panel}`);
  }
  return ids;
}

function gateMinimumCheckpoint(gate, panel) {
  return gate.panelMinimumCheckpoints?.[panel] ?? gate.minimumCheckpoint ?? null;
}

function dimensionPanelRule(dimension, panel) {
  const configured = dimension.panelApplicability?.[panel];
  if (!configured) {
    return { status: "applicable", mode: "legacy-default", minimumCheckpoint: null };
  }
  if (configured.status === "not-applicable") return configured;
  if (configured.status === "applicable") return configured;
  throw new Error(`Dimension ${dimension.id} has an invalid applicability declaration for panel ${panel}`);
}

function dimensionRequiredEvidence(dimension, panel) {
  const configured = dimension.panelRequiredEvidence?.[panel]
    ?? dimension.requiredEvidence
    ?? [];
  return configured.map((clause, index) => (
    typeof clause === "string"
      ? {
        id: `${dimension.id}-E${String(index + 1).padStart(2, "0")}`,
        criterion: clause,
        legacy: true,
      }
      : { ...clause, legacy: false }
  ));
}

function emptyEvidenceCoverage(dimension, panel) {
  const clauses = dimensionRequiredEvidence(dimension, panel);
  return {
    required: clauses.length,
    covered: 0,
    missing: 0,
    uncertain: clauses.length,
    ratio: clauses.length === 0 ? null : 0,
    criteria: clauses.map(({ id, criterion }) => ({
      id,
      criterion,
      consensusStatus: "uncertain",
    })),
    reviewerObservations: [],
  };
}

function dimensionEvidenceCoverage(dimension, ratings, panel) {
  const clauses = dimensionRequiredEvidence(dimension, panel);
  if (clauses.length === 0) return emptyEvidenceCoverage(dimension, panel);
  const reviewerObservations = ratings.map((rating) => {
    const coverage = new Map(
      (rating.criterionCoverage ?? []).map((entry) => [entry.criterionId, entry]),
    );
    const statuses = Object.fromEntries(
      clauses.map(({ id }) => [id, coverage.get(id)?.status ?? "uncertain"]),
    );
    const covered = clauses
      .filter(({ id }) => statuses[id] === "covered")
      .map(({ id }) => id);
    const missing = clauses
      .filter(({ id }) => statuses[id] === "missing")
      .map(({ id }) => id);
    const uncertain = clauses
      .filter(({ id }) => statuses[id] === "uncertain")
      .map(({ id }) => id);
    return {
      raterId: rating.raterId,
      covered,
      missing,
      uncertain,
      ratio: covered.length / clauses.length,
    };
  });
  const criteria = clauses.map(({ id, criterion }) => {
    const observed = reviewerObservations.map((observation) => {
      if (observation.covered.includes(id)) return "covered";
      if (observation.missing.includes(id)) return "missing";
      return "uncertain";
    });
    const consensusStatus = observed.length > 0 && observed.every((status) => status === "covered")
      ? "covered"
      : observed.length > 0 && observed.every((status) => status === "missing")
        ? "missing"
        : "uncertain";
    return { id, criterion, consensusStatus };
  });
  const covered = criteria.filter(({ consensusStatus }) => consensusStatus === "covered").length;
  const missing = criteria.filter(({ consensusStatus }) => consensusStatus === "missing").length;
  const uncertain = criteria.length - covered - missing;
  return {
    required: clauses.length,
    covered,
    missing,
    uncertain,
    ratio: covered / clauses.length,
    criteria,
    reviewerObservations,
  };
}

function reviewExpectation(contract, panel, highestCheckpoint) {
  const gates = contract.baselineGates.filter((gate) =>
    panelGateIds(contract, panel).includes(gate.id)
      && checkpointReached(highestCheckpoint, gateMinimumCheckpoint(gate, panel), contract),
  );
  const dimensions = contract.dimensions.filter((dimension) => {
    const rule = dimensionPanelRule(dimension, panel);
    return rule.status === "applicable"
      && checkpointReached(highestCheckpoint, rule.minimumCheckpoint, contract);
  });
  return { gateIds: gates.map(({ id }) => id), dimensionIds: dimensions.map(({ id }) => id) };
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

function buildGateResults(
  contract,
  checks,
  admissionStatus,
  gateRatings,
  applicableGateIds,
  highestCheckpoint,
  panel,
) {
  const gates = [contract.admissionGate, ...contract.baselineGates];
  return gates.map((gate) => {
    const { id, label } = gate;
    if (id === "A0") {
      return {
        id,
        label,
        result: admissionStatus,
        checks: checks.filter(({ gateId }) => gateId === id),
      };
    }
    if (!applicableGateIds.includes(id)) {
      return {
        id,
        label,
        result: "not-applicable",
        applicable: false,
        checks: [],
        reviewerRatings: [],
      };
    }
    if (!checkpointReached(
      highestCheckpoint,
      gateMinimumCheckpoint(gate, panel),
      contract,
    )) {
      return {
        id,
        label,
        result: "not-evaluable",
        checks: [],
        reviewerRatings: [],
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

function dimensionResult(
  dimension,
  ratings,
  minimumRaters,
  highestCheckpoint,
  attemptedCheckpointIds,
  contract,
  panel,
  admissionStatus,
) {
  const applicability = dimensionPanelRule(dimension, panel);
  if (applicability.status === "not-applicable") {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted: false,
      evidenceCoverage: emptyEvidenceCoverage(dimension, panel),
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: "not-applicable",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: [],
    };
  }
  const attempted = checkpointAttempted(
    attemptedCheckpointIds,
    highestCheckpoint,
    applicability.minimumCheckpoint,
    contract,
  );
  if (admissionStatus !== "pass") {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted,
      evidenceCoverage: emptyEvidenceCoverage(dimension, panel),
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: "artifact-invalid",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: [],
    };
  }
  if (!checkpointReached(highestCheckpoint, applicability.minimumCheckpoint, contract)) {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted,
      evidenceCoverage: emptyEvidenceCoverage(dimension, panel),
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: attempted ? "incomplete-checkpoint" : "not-attempted",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: [],
    };
  }
  const relevant = ratings.filter(({ dimensionId }) => dimensionId === dimension.id);
  const scored = relevant.filter(({ status }) => status === "scored");
  const distinctRaters = new Set(scored.map(({ raterId }) => raterId));
  const statuses = new Set(relevant.map(({ status }) => status));
  const evidenceCoverage = dimensionEvidenceCoverage(dimension, relevant, panel);
  if (statuses.has("evaluator-unsupported")) {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted: true,
      evidenceCoverage,
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: "evaluator-unsupported",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: relevant,
    };
  }
  if (statuses.has("evaluator-uncertain")) {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted: true,
      evidenceCoverage,
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: "evaluator-uncertain",
      highestVerifiedCheckpoint: highestCheckpoint,
      ratings: relevant,
    };
  }
  if (statuses.has("not-evaluable") || distinctRaters.size < minimumRaters) {
    return {
      id: dimension.id,
      label: dimension.label,
      applicability,
      attempted: true,
      evidenceCoverage,
      evaluable: false,
      ratingStatus: "not-evaluable",
      score: null,
      scoreInterval: null,
      nonEvaluationCause: "missing-evidence",
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
    applicability,
    attempted: true,
    evidenceCoverage,
    evaluable: !requiresAdjudication,
    ratingStatus: requiresAdjudication ? "not-evaluable" : "scored",
    score: requiresAdjudication ? null : median(scores),
    scoreInterval: requiresAdjudication ? null : [minimum, maximum],
    nonEvaluationCause: requiresAdjudication ? "evaluator-uncertain" : null,
    highestVerifiedCheckpoint: highestCheckpoint,
    ratings: relevant,
  };
}

export function validateReviewers(
  contract,
  reviewers,
  gateRatings,
  expertRatings,
  { panel = null, highestCheckpoint = null } = {},
) {
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
      || (
        contract.reviewProtocol.requireReviewerUntrustedEvidenceAttestation === true
        && (
          reviewer.treatedCandidateContentAsUntrustedEvidence !== true
          || reviewer.followedFrozenReviewInstructionOnly !== true
          || reviewer.appliedPanelSpecificAnchorsAndCriterionCoverage !== true
          || reviewer.reviewedPanel !== panel
        )
      )
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
  const expectation = panel
    ? reviewExpectation(contract, panel, highestCheckpoint)
    : {
      gateIds: contract.baselineGates.map(({ id }) => id),
      dimensionIds: contract.dimensions.map(({ id }) => id),
    };
  // Sealed reviews cover the complete rubric. Later-checkpoint ratings stay
  // inert until their checkpoint enters this expectation.
  for (const gateId of expectation.gateIds) {
    const gate = contract.baselineGates.find(({ id }) => id === gateId);
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
  for (const dimensionId of expectation.dimensionIds) {
    const dimension = contract.dimensions.find(({ id }) => id === dimensionId);
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

function validateRatings(contract, ratings, panel) {
  const dimensions = new Map(contract.dimensions.map((dimension) => [dimension.id, dimension]));
  const permittedStatuses = new Set(contract.reviewProtocol.permittedStatuses);
  return ratings.map((rating) => {
    const dimension = dimensions.get(rating.dimensionId);
    if (!dimension) {
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
    const evidenceRefs = Array.isArray(rating.evidenceRefs)
      ? [...new Set(rating.evidenceRefs)].sort()
      : [];
    const evidenceRefSet = new Set(evidenceRefs);
    const requiredClauses = dimensionRequiredEvidence(dimension, panel);
    const requiresStructuredCoverage = requiredClauses.length > 0
      && requiredClauses.every(({ legacy }) => legacy === false);
    const rawCoverage = Array.isArray(rating.criterionCoverage)
      ? rating.criterionCoverage
      : [];
    const criterionCoverage = rawCoverage.map((entry) => {
      if (
        !entry
        || typeof entry.criterionId !== "string"
        || !new Set(["covered", "missing", "uncertain"]).has(entry.status)
      ) {
        throw new Error(
          `Rating ${rating.raterId}/${rating.dimensionId} has invalid criterion coverage`,
        );
      }
      const refs = Array.isArray(entry.evidenceRefs)
        ? [...new Set(entry.evidenceRefs)].sort()
        : [];
      if (entry.status === "covered" && refs.length === 0) {
        throw new Error(
          `Covered criterion ${entry.criterionId} requires inspectable evidence`,
        );
      }
      if (refs.some((evidenceId) => !evidenceRefSet.has(evidenceId))) {
        throw new Error(
          `Criterion ${entry.criterionId} cites evidence absent from the rating evidenceRefs`,
        );
      }
      return {
        criterionId: entry.criterionId,
        status: entry.status,
        evidenceRefs: refs,
      };
    });
    const coverageIds = criterionCoverage.map(({ criterionId }) => criterionId);
    if (new Set(coverageIds).size !== coverageIds.length) {
      throw new Error(`Rating ${rating.raterId}/${rating.dimensionId} repeats criterion coverage`);
    }
    if (requiresStructuredCoverage) {
      const requiredIds = requiredClauses.map(({ id }) => id).sort();
      const actualIds = [...coverageIds].sort();
      if (canonicalJson(requiredIds) !== canonicalJson(actualIds)) {
        throw new Error(
          `Rating ${rating.raterId}/${rating.dimensionId} must cover every panel-specific evidence criterion exactly once`,
        );
      }
    } else if (criterionCoverage.length > 0) {
      const permittedIds = new Set(requiredClauses.map(({ id }) => id));
      if (criterionCoverage.some(({ criterionId }) => !permittedIds.has(criterionId))) {
        throw new Error(
          `Rating ${rating.raterId}/${rating.dimensionId} covers an unknown evidence criterion`,
        );
      }
    }
    return {
      raterId: rating.raterId,
      dimensionId: rating.dimensionId,
      status: rating.status,
      ...(rating.status === "scored" ? { score: rating.score } : {}),
      evidenceRefs,
      criterionCoverage,
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
  if (
    scoringContract.reviewProtocol?.requireReviewerUntrustedEvidenceAttestation === true
    && (
      assessment.reviewContext?.panel !== assessment.panel
      || assessment.reviewContext?.candidateContentHandling !== "untrusted-evidence-only"
    )
  ) {
    throw new Error("Assessment does not bind the frozen untrusted-evidence review context to its panel");
  }
  const scoringDigest = scoringContractDigest
    ?? sha256(Buffer.from(`${canonicalJson(scoringContract)}\n`));
  const declaredDigest = assessment.scoringContract?.sha256;
  if (declaredDigest && !/^<.*>$/.test(declaredDigest) && declaredDigest !== scoringDigest) {
    throw new Error("Assessment scoring-contract digest does not match");
  }

  const authoritativeOutputContract = (
    packet.id === "integrated-robotic-handling"
    && packet.version === "1.10"
  )
    ? await loadAuthoritativeOutputContract(packetRoot, packet)
    : {};
  const candidateValidation = await validateCandidateBundle(candidateRoot, {
    // Stage 2 seals the transferred bytes below the evaluator-owned
    // bundlePath (`submitted` in the current run schema).
    expectedRootName: path.basename(candidateRoot),
    ...(contractValidators ? { contractValidators } : {}),
    ...authoritativeOutputContract,
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
  const applicableGateIds = panelGateIds(scoringContract, assessment.panel);
  for (const check of checks) {
    if (check.gateId !== "A0" && !applicableGateIds.includes(check.gateId)) {
      throw new Error(`Automatic check ${check.id} targets gate ${check.gateId}, which is not applicable to panel ${assessment.panel}`);
    }
  }
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
  const ratings = validateRatings(
    scoringContract,
    boundReviews.ratings,
    assessment.panel,
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
  const attemptedCheckpointIds = new Set(
    submission.partialAttainment?.attemptedCheckpointIds ?? [],
  );
  if (admissionResult === "pass") {
    if (boundReviews.reviewAudit) {
      validateReviewers(
        scoringContract,
        boundReviews.reviewers,
        gateRatings,
        ratings,
        { panel: assessment.panel, highestCheckpoint },
      );
    } else if (boundReviews.reviewers.length || gateRatings.length || ratings.length) {
      throw new Error("No review ratings may be sealed before this panel reaches a reviewable checkpoint");
    }
  }
  const gates = buildGateResults(
    scoringContract,
    checks,
    admissionResult,
    gateRatings,
    applicableGateIds,
    highestCheckpoint,
    assessment.panel,
  );
  const dimensions = scoringContract.dimensions.map((dimension) =>
    dimensionResult(
      dimension,
      ratings,
      scoringContract.reviewProtocol.minimumIndependentRaters,
      highestCheckpoint,
      attemptedCheckpointIds,
      scoringContract,
      assessment.panel,
      admissionResult,
    ),
  );
  const gateMap = new Map(gates.map((gate) => [gate.id, gate.result]));
  const baselineCheckpointIds = (packet.checkpoints ?? [])
    .filter(({ requiredForBaseline }) => requiredForBaseline !== false)
    .map(({ id }) => id);
  const completedCheckpointIds = new Set(
    submission.partialAttainment?.completedCheckpointIds ?? [],
  );
  const baselineAttained =
    baselineCheckpointIds.length > 0
    && baselineCheckpointIds.every((id) => completedCheckpointIds.has(id));
  const baselineQualified = assessment.panel === "fixed-anchor-baseline"
    ? (
      admissionResult === "pass"
      && baselineAttained
      && scoringContract.baselineGates.every(({ id }) => gateMap.get(id) === "pass")
    )
    : null;
  const changeQualified = assessment.panel === "change-response"
    ? (
      admissionResult === "pass"
      && completedCheckpointIds.has("CKPT-050")
      && ["B1", "B2", "B3", "B4", "B5", "B6"]
        .every((id) => gateMap.get(id) === "pass")
    )
    : null;
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
      admission: admissionResult,
      baseline: baselineQualified === null ? "not-run" : (baselineQualified ? "pass" : "fail"),
      change: changeQualified === null ? "not-run" : (changeQualified ? "pass" : "fail"),
      baselineQualified,
      changeQualified,
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
