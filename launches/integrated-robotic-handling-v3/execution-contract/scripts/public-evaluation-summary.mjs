import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const hasOwn = (value, key) => Object.hasOwn(value ?? {}, key);

function publicEvidenceCoverage(evidenceCoverage) {
  // v1 exposed a scalar evidence count. Keep that shape intact for previously
  // published evaluation records.
  if (typeof evidenceCoverage !== "object" || evidenceCoverage === null || Array.isArray(evidenceCoverage)) {
    return evidenceCoverage;
  }

  // v1.10 keeps reviewer observations (including rater IDs and evidence
  // references) evaluator-private. Only consensus-level criterion statuses
  // may cross the publication boundary.
  const criterionConsensus = Object.fromEntries(
    (Array.isArray(evidenceCoverage.criteria) ? evidenceCoverage.criteria : [])
      .filter(({ id, consensusStatus } = {}) =>
        typeof id === "string"
          && ["covered", "missing", "uncertain"].includes(consensusStatus),
      )
      .map(({ id, consensusStatus }) => [id, consensusStatus]),
  );
  return {
    required: evidenceCoverage.required,
    covered: evidenceCoverage.covered,
    missing: evidenceCoverage.missing,
    uncertain: evidenceCoverage.uncertain,
    ratio: evidenceCoverage.ratio,
    criterionConsensus,
  };
}

function publicDimension(dimension) {
  const common = {
    ...(hasOwn(dimension, "id") ? { id: dimension.id } : {}),
    ...(hasOwn(dimension, "label") ? { label: dimension.label } : {}),
    ...(hasOwn(dimension, "attempted") ? { attempted: dimension.attempted } : {}),
    ...(hasOwn(dimension, "evidenceCoverage")
      ? { evidenceCoverage: publicEvidenceCoverage(dimension.evidenceCoverage) }
      : {}),
    ...(hasOwn(dimension, "evaluable") ? { evaluable: dimension.evaluable } : {}),
    ...(hasOwn(dimension, "score") ? { score: dimension.score } : {}),
    ...(hasOwn(dimension, "scoreInterval") ? { scoreInterval: dimension.scoreInterval } : {}),
    ...(hasOwn(dimension, "highestVerifiedCheckpoint")
      ? { highestVerifiedCheckpoint: dimension.highestVerifiedCheckpoint }
      : {}),
  };
  if (hasOwn(dimension, "ratingStatus") || hasOwn(dimension, "nonEvaluationCause")) {
    return {
      ...common,
      ...(hasOwn(dimension, "ratingStatus") ? { ratingStatus: dimension.ratingStatus } : {}),
      ...(hasOwn(dimension, "nonEvaluationCause")
        ? { nonEvaluationCause: dimension.nonEvaluationCause }
        : {}),
    };
  }
  return {
    ...common,
    ...(hasOwn(dimension, "passFail") ? { passFail: dimension.passFail } : {}),
    ...(hasOwn(dimension, "failureCause") ? { failureCause: dimension.failureCause } : {}),
  };
}

/**
 * Select only publication-safe evaluator facts.  Reviewer identities, votes,
 * rationales, review-package paths, and individual rating records remain
 * evaluator-owned and are intentionally not serialised here.
 */
export function publicEvaluationSummary(record, recordBytes) {
  const finalization = record.finalization
    ? {
      status: record.finalization.status,
      finalizedAt: record.finalization.finalizedAt,
      candidateBundleSha256: record.finalization.candidateBundleSha256,
      candidateSubmissionSha256: record.finalization.candidateSubmissionSha256,
      pendingRecordSha256: record.finalization.pendingRecordSha256,
      sourceEvaluationSha256: record.finalization.sourceEvaluationSha256,
    }
    : null;
  return {
    schemaVersion: "1.0",
    runId: record.runId,
    status: record.status,
    evaluationRecordSha256: sha256(recordBytes),
    finalization,
    qualification: record.qualification ?? {},
    attainment: record.attainment ?? {},
    gates: (record.gates ?? []).map(({ id, label, result }) => ({ id, label, result })),
    dimensions: (record.dimensions ?? []).map(publicDimension),
    rawMetrics: record.rawMetrics ?? [],
    efficiency: record.efficiency ?? { separateFromDesignQuality: true, values: {} },
    compositeScore: null,
    compositeScorePublished: false,
  };
}
