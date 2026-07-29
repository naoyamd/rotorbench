import { createHash } from "node:crypto";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

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
    dimensions: (record.dimensions ?? []).map(({
      id,
      label,
      attempted,
      evidenceCoverage,
      evaluable,
      passFail,
      score,
      scoreInterval,
      failureCause,
      highestVerifiedCheckpoint,
    }) => ({ id, label, attempted, evidenceCoverage, evaluable, passFail, score, scoreInterval, failureCause, highestVerifiedCheckpoint })),
    rawMetrics: record.rawMetrics ?? [],
    efficiency: record.efficiency ?? { separateFromDesignQuality: true, values: {} },
    compositeScore: null,
    compositeScorePublished: false,
  };
}
