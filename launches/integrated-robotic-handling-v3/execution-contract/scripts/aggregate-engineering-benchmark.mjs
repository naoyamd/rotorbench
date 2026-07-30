import "./official-execution-guard.mjs";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  sha256,
  validateEvaluationRecord,
} from "./framework-lib.mjs";

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1
    ? sorted[middle]
    : (sorted[middle - 1] + sorted[middle]) / 2;
}

function assertSame(records, selector, label) {
  const values = new Set(records.map(selector));
  if (values.size !== 1) {
    throw new Error(`Cannot aggregate records with different ${label}`);
  }
  return [...values][0];
}

function nonEvaluationCause(dimension) {
  // `failureCauses` is a published aggregate field name from v1. Newer
  // evaluation records distinguish non-evaluation from a design failure, so
  // prefer that name while retaining old-record compatibility.
  return Object.hasOwn(dimension, "nonEvaluationCause")
    ? dimension.nonEvaluationCause
    : dimension.failureCause;
}

export function aggregateEngineeringEvaluations(records) {
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("At least one evaluation record is required");
  }
  const runIds = new Set();
  const bundleDigests = new Set();
  const recordDigests = new Set();
  for (const record of records) {
    if (record.schemaVersion !== "4.0") {
      throw new Error("All evaluation records must use schemaVersion 4.0");
    }
    const schemaIssues = validateEvaluationRecord(record);
    if (schemaIssues.length > 0) {
      throw new Error(`Evaluation record is invalid: ${schemaIssues.map(({ message }) => message).join("; ")}`);
    }
    if (record.status === "pending") {
      throw new Error("Pending evaluation records cannot be aggregated");
    }
    if (record.compositeScore !== null || record.compositeScorePublished !== false) {
      throw new Error("Aggregate input must not contain a composite score");
    }
    if (runIds.has(record.runId)) {
      throw new Error(`Duplicate runId ${record.runId}`);
    }
    runIds.add(record.runId);
    if (bundleDigests.has(record.candidateBundleSha256)) {
      throw new Error(`Duplicate candidate bundle ${record.candidateBundleSha256}`);
    }
    bundleDigests.add(record.candidateBundleSha256);
    const recordDigest = sha256(Buffer.from(canonicalJson(record)));
    if (recordDigests.has(recordDigest)) {
      throw new Error(`Duplicate evaluation record ${recordDigest}`);
    }
    recordDigests.add(recordDigest);
  }
  const benchmarkId = assertSame(records, (record) => record.benchmarkId, "benchmark");
  const panel = assertSame(records, (record) => record.panel, "panel");
  const fairnessFingerprint = assertSame(
    records,
    (record) => record.fairnessFingerprint,
    "fairness fingerprint",
  );
  const scoringDigest = assertSame(
    records,
    (record) => record.scoringContract.sha256,
    "scoring contract",
  );
  const dimensionIds = [...new Set(
    records.flatMap((record) => record.dimensions.map(({ id }) => id)),
  )].sort();
  const gateIds = [...new Set(
    records.flatMap((record) => record.gates.map(({ id }) => id)),
  )].sort();
  const checkpointIds = records
    .map((record) => record.attainment.highestVerifiedCheckpoint)
    .filter(Boolean);

  const dimensions = dimensionIds.map((id) => {
    const entries = records
      .map((record) => record.dimensions.find((dimension) => dimension.id === id))
      .filter(Boolean);
    const scores = entries
      .filter(({ evaluable, score }) => evaluable && typeof score === "number")
      .map(({ score }) => score);
    return {
      id,
      label: entries[0]?.label ?? id,
      runCount: entries.length,
      evaluableCount: scores.length,
      median: median(scores),
      observedInterval: scores.length > 0
        ? [Math.min(...scores), Math.max(...scores)]
        : null,
      // Kept as `failureCauses` for the existing cohort aggregate schema. For
      // v1.10 inputs its counts are non-evaluation causes; v1 failureCause is
      // used only when the new field is absent.
      failureCauses: Object.fromEntries(
        [...new Set(entries.map(nonEvaluationCause).filter(Boolean))]
          .sort()
          .map((cause) => [
            cause,
            entries.filter((entry) => nonEvaluationCause(entry) === cause).length,
          ]),
      ),
    };
  });
  const gates = gateIds.map((id) => {
    const results = records
      .map((record) => record.gates.find((gate) => gate.id === id)?.result)
      .filter(Boolean);
    const resultCounts = Object.fromEntries(
      [...new Set(results)].sort().map((result) => [
        result,
        results.filter((value) => value === result).length,
      ]),
    );
    return {
      id,
      runCount: results.length,
      passRate: results.length === 0
        ? null
        : results.filter((result) => result === "pass").length / results.length,
      resultCounts,
    };
  });

  return {
    schemaVersion: "4.0",
    benchmarkId,
    panel,
    fairnessFingerprint,
    scoringContractSha256: scoringDigest,
    runCount: records.length,
    admittedCount: records.filter(({ status }) => status === "admitted").length,
    baselineQualifiedCount: records.filter(
      ({ qualification }) => qualification.baselineQualified,
    ).length,
    dimensions,
    gates,
    attainment: {
      highestCheckpointCounts: Object.fromEntries(
        [...new Set(checkpointIds)].sort().map((id) => [
          id,
          checkpointIds.filter((value) => value === id).length,
        ]),
      ),
    },
    compositeScore: null,
    compositeScorePublished: false,
    efficiency: {
      separateFromDesignQuality: true,
      records: records.map(({ launchId, candidateBundleSha256, efficiency }) => ({
        launchId,
        candidateBundleSha256,
        values: efficiency?.values ?? {},
      })),
    },
  };
}

async function main() {
  const directory = path.resolve(argument("--dir"));
  const output = path.resolve(argument("--out"));
  const files = (await readdir(directory, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
    .map((entry) => path.join(directory, entry.name))
    .sort();
  const records = await Promise.all(
    files.map(async (file) => JSON.parse(await readFile(file, "utf8"))),
  );
  const aggregate = aggregateEngineeringEvaluations(records);
  await writeFile(output, `${JSON.stringify(aggregate, null, 2)}\n`, {
    flag: "wx",
  });
  console.log(
    `Aggregated ${aggregate.runCount} run(s); no composite score emitted.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
