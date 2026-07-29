import "./official-execution-guard.mjs";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  ensureInside,
  pathExists,
  sha256,
  validateCohortDisclosure,
  validateCohortEvaluationAggregate,
  validateFramework,
  validateMeasurementConditions,
  validateReport,
  validateV4EvaluationStorage,
} from "./framework-lib.mjs";
import { aggregateEngineeringEvaluations } from "./aggregate-engineering-benchmark.mjs";

const DISCLOSURE_FILE = "cohort-disclosure.json";
const AGGREGATE_FILE = "cohort-evaluation-aggregate.json";
const V4_DIMENSIONS = Array.from({ length: 10 }, (_, index) => `D${String(index + 1).padStart(2, "0")}`);

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) throw new Error(`Missing required argument ${name}`);
  return process.argv[index + 1];
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function problemList(label, issues) {
  return `${label}:\n${issues.map(({ code, message }) => `${code}: ${message}`).join("\n")}`;
}

async function replaceAtomically(target, bytes, suffix) {
  const temporary = `${target}.${suffix}.tmp`;
  await writeFile(temporary, bytes, { flag: "wx" });
  await rename(temporary, target);
}

function exactGroups(left, right) {
  const normalized = (groups) => groups
    .map(({ groupId, runIds }) => ({ groupId, runIds: [...runIds].sort() }))
    .sort((a, b) => a.groupId.localeCompare(b.groupId));
  return canonicalJson(normalized(left)) === canonicalJson(normalized(right));
}

function requireSame(records, selector, label) {
  const values = new Set(records.map(selector));
  if (values.size !== 1) throw new Error(`Finalized evaluator records do not share one ${label}`);
  return [...values][0];
}

function countRate(count, denominator) {
  return { count, rate: denominator === 0 ? 0 : count / denominator };
}

export function buildCohortEvaluationAggregate({
  cohort,
  measurementConditionsSha256,
  disclosureSha256,
  disclosure,
  records,
  generatedAt,
}) {
  const disclosedRunIds = disclosure.modelGroups.flatMap(({ runIds }) => runIds).sort();
  const recordRunIds = records.map(({ runId }) => runId).sort();
  if (canonicalJson(disclosedRunIds) !== canonicalJson(recordRunIds)) {
    throw new Error("Disclosure model groups do not cover the finalized evaluator records exactly");
  }
  const binding = {
    fairnessFingerprint: requireSame(records, (record) => record.fairnessFingerprint, "fairness fingerprint"),
    evaluationContractDigest: requireSame(records, (record) => record.evaluationContractDigest, "evaluation contract digest"),
    scoringVersion: requireSame(records, (record) => record.scoringVersion, "scoring version"),
    scoringContractSha256: requireSame(records, (record) => record.scoringContract?.sha256, "scoring contract hash"),
    panel: requireSame(records, (record) => record.panel, "assessment panel"),
  };
  if (binding.fairnessFingerprint !== cohort.fairnessFingerprint) {
    throw new Error("Finalized evaluator records do not bind the cohort fairness fingerprint");
  }
  const byRunId = new Map(records.map((record) => [record.runId, record]));
  const modelGroups = disclosure.modelGroups
    .map((group) => {
      const groupRecords = group.runIds.map((runId) => {
        const record = byRunId.get(runId);
        if (!record) throw new Error(`Disclosure run ${runId} has no finalized evaluator record`);
        return record;
      }).sort((left, right) => left.runId.localeCompare(right.runId));
      const aggregate = aggregateEngineeringEvaluations(groupRecords);
      const dimensions = aggregate.dimensions.sort((left, right) => left.id.localeCompare(right.id));
      if (canonicalJson(dimensions.map(({ id }) => id)) !== canonicalJson(V4_DIMENSIONS)) {
        throw new Error(`${group.groupId} does not have an evaluable D01-D10 vector`);
      }
      const gates = aggregate.gates
        .map((gate) => ({
          ...gate,
          passCount: gate.resultCounts.pass ?? 0,
        }))
        .sort((left, right) => left.id.localeCompare(right.id));
      const runCount = groupRecords.length;
      return {
        groupId: group.groupId,
        runIds: groupRecords.map(({ runId }) => runId),
        runCount,
        admission: countRate(groupRecords.filter(({ status }) => status === "admitted").length, runCount),
        qualification: {
          baseline: countRate(groupRecords.filter(({ qualification }) => qualification?.baselineQualified === true).length, runCount),
          change: countRate(groupRecords.filter(({ qualification }) => qualification?.changeQualified === true).length, runCount),
        },
        dimensions,
        gates,
        attainment: aggregate.attainment,
        rawMetrics: {
          separateFromDesignQuality: true,
          records: groupRecords.map((record) => ({ runId: record.runId, values: record.rawMetrics ?? [] })),
        },
        efficiency: {
          separateFromDesignQuality: true,
          records: groupRecords.map((record) => ({ runId: record.runId, values: record.efficiency?.values ?? {} })),
        },
        compositeScore: null,
        compositeScorePublished: false,
      };
    })
    .sort((left, right) => left.groupId.localeCompare(right.groupId));
  const aggregate = {
    schemaVersion: "1.0",
    cohortId: cohort.id,
    launchId: cohort.launchId,
    measurementConditionsSha256,
    disclosureSha256,
    generatedAt,
    binding,
    evaluationRecords: records
      .map((record) => ({
        runId: record.runId,
        path: `runs/${record.runId}/evaluation-record.json`,
        sha256: sha256(Buffer.from(canonicalJson(record))),
        status: record.status,
      }))
      .sort((left, right) => left.runId.localeCompare(right.runId)),
    modelGroups,
    compositeScore: null,
    compositeScorePublished: false,
  };
  const issues = validateCohortEvaluationAggregate(aggregate);
  if (issues.length > 0) throw new Error(problemList("Generated cohort aggregate is invalid", issues));
  return aggregate;
}

export function validateDisclosureForPublication({ disclosure, cohort, conditions, measurementConditionsSha256, officialRepeatCount }) {
  const issues = validateCohortDisclosure(disclosure);
  if (issues.length > 0) throw new Error(problemList("Cohort disclosure is invalid", issues));
  if (
    disclosure.cohortId !== cohort.id
    || disclosure.launchId !== cohort.launchId
    || disclosure.measurementConditionsSha256 !== measurementConditionsSha256
  ) {
    throw new Error("Cohort disclosure does not bind this cohort, launch, and measurement conditions");
  }
  if (!exactGroups(disclosure.modelGroups, conditions.modelGroups)) {
    throw new Error("Cohort disclosure model groups do not exactly match frozen measurement conditions");
  }
  for (const group of disclosure.modelGroups) {
    if (group.runIds.length !== officialRepeatCount) {
      throw new Error(`${group.groupId} must disclose exactly ${officialRepeatCount} official runs`);
    }
  }
}

async function loadDisclosure({ disclosurePath, cohort, conditions, measurementConditionsSha256, officialRepeatCount }) {
  if (!disclosurePath) throw new Error("v4 cohort publication requires --disclosure <cohort-disclosure.json>");
  let bytes;
  let disclosure;
  try {
    bytes = await readFile(path.resolve(disclosurePath));
    disclosure = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Cohort disclosure is missing or invalid JSON");
  }
  validateDisclosureForPublication({ disclosure, cohort, conditions, measurementConditionsSha256, officialRepeatCount });
  return { disclosure, bytes, sha256: sha256(bytes) };
}

export async function publishCohort({
  projectRoot = process.cwd(),
  cohortId,
  disclosurePath = null,
  generatedAt = new Date().toISOString(),
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cohortId)) throw new Error("cohort ID must use lowercase kebab-case");
  const root = path.resolve(projectRoot);
  const cohortPath = path.join(root, "cohorts", cohortId, "cohort.json");
  const originalCohortText = await readFile(cohortPath, "utf8");
  const nextCohort = JSON.parse(originalCohortText);
  const before = await validateFramework(root);
  if (before.issues.length > 0) throw new Error(`Framework validation failed before cohort publication:\n${before.issues.map((entry) => `${entry.scope}: ${entry.code}: ${entry.message}`).join("\n")}`);
  const cohortEntry = before.cohorts.find((entry) => entry.manifest?.id === cohortId);
  if (!cohortEntry?.manifest || cohortEntry.validationIssues.length > 0 || cohortEntry.manifest.status !== "open") {
    throw new Error("Only a valid, open cohort can transition to published");
  }

  const isV4 = cohortEntry.manifest.extensions?.protocolVersion === "4.0";
  let measurementConditionsSha256 = null;
  let conditions = null;
  let disclosure = null;
  let disclosureBytes = null;
  let disclosureSha256 = null;
  if (isV4) {
    const conditionsRef = cohortEntry.manifest.extensions?.measurementConditions;
    const conditionsPath = path.join(cohortEntry.root, "measurement-conditions.json");
    const conditionsBytes = await readFile(conditionsPath);
    measurementConditionsSha256 = sha256(conditionsBytes);
    if (conditionsRef?.path !== "measurement-conditions.json" || conditionsRef?.sha256 !== measurementConditionsSha256) {
      throw new Error("v4 cohort measurement conditions are missing or no longer match their opening seal");
    }
    conditions = JSON.parse(conditionsBytes.toString("utf8"));
    const conditionIssues = validateMeasurementConditions(conditions);
    if (conditionIssues.length > 0) throw new Error(problemList("v4 cohort measurement conditions are invalid", conditionIssues));
    if (Date.parse(conditions.frozenAt) > Date.parse(cohortEntry.manifest.openedAt)) {
      throw new Error("v4 measurement conditions were frozen after the cohort opened");
    }
    const officialRepeatCount = before.launches.find((entry) => entry.manifest?.id === cohortEntry.manifest.launchId)?.profile?.extensions?.officialRepeatCountPerModel;
    if (!Number.isInteger(officialRepeatCount) || conditions.repetitionPolicy.runsPerModel !== officialRepeatCount) {
      throw new Error("v4 cohort repeat policy does not match the frozen execution profile");
    }
    const loaded = await loadDisclosure({ disclosurePath, cohort: cohortEntry.manifest, conditions, measurementConditionsSha256, officialRepeatCount });
    ({ disclosure, bytes: disclosureBytes, sha256: disclosureSha256 } = loaded);
  }

  const candidates = [];
  const records = [];
  for (const candidateId of cohortEntry.manifest.candidateIds) {
    const runEntry = before.runs.find((entry) => entry.manifest?.id === candidateId);
    if (!runEntry?.manifest || runEntry.validationIssues.length > 0 || runEntry.manifest.status !== "validated" || runEntry.manifest.seal?.sealed !== true || runEntry.manifest.cohortId !== cohortId || runEntry.manifest.launchId !== cohortEntry.manifest.launchId || runEntry.manifest.fairnessFingerprint !== cohortEntry.manifest.fairnessFingerprint) {
      throw new Error(`Cohort member ${candidateId} must be a valid, sealed, validated run with matching launch and fingerprint`);
    }
    if (isV4) {
      if (runEntry.manifest.extensions?.protocolVersion !== "4.0" || runEntry.manifest.extensions?.measurementConditionsSha256 !== measurementConditionsSha256) {
        throw new Error(`Cohort member ${candidateId} does not bind the cohort measurement conditions`);
      }
      const evaluationIssues = await validateV4EvaluationStorage(runEntry, { cohortManifest: cohortEntry.manifest, requireFinalized: true });
      if (evaluationIssues.length > 0) throw new Error(`Cohort member ${candidateId} has no finalized evaluator record:\n${evaluationIssues.map(({ code, message }) => `${code}: ${message}`).join("\n")}`);
      const evaluationPath = ensureInside(
        runEntry.root,
        runEntry.manifest.evaluation.recordPath,
      );
      if (!evaluationPath) {
        throw new Error(`Cohort member ${candidateId} has an unsafe evaluator record path`);
      }
      const evaluationBytes = await readFile(evaluationPath);
      const evaluation = JSON.parse(evaluationBytes.toString("utf8"));
      if (!["admitted", "artifact-invalid"].includes(evaluation.status) || evaluation.compositeScore !== null || evaluation.compositeScorePublished !== false) {
        throw new Error(`Cohort member ${candidateId} has an ineligible finalized evaluator record`);
      }
      records.push({ ...evaluation, __bytes: evaluationBytes });
    }

    const stagedReportPath = path.join(root, ".framework-staging", "reports", `${candidateId}.json`);
    let reportText;
    let report;
    try {
      reportText = await readFile(stagedReportPath, "utf8");
      report = JSON.parse(reportText);
    } catch {
      throw new Error(`Cohort member ${candidateId} is missing its staged validation report`);
    }
    const reportProblems = validateReport(report);
    const sealAttestation = report.checks?.some((entry) => entry.name === "Sealed candidate bundle" && entry.status === "pass" && entry.inputSha256 === runEntry.manifest.seal.bundleSha256);
    if (reportProblems.length > 0 || report.runId !== candidateId || report.status !== "valid" || report.issues.length > 0 || report.checks.some((entry) => entry.status === "fail") || !sealAttestation) {
      throw new Error(`Cohort member ${candidateId} does not have a successful report for its current seal`);
    }
    const runPath = path.join(root, "runs", candidateId, "run.json");
    const originalRunText = await readFile(runPath, "utf8");
    const nextRun = JSON.parse(originalRunText);
    const publicationReportPath = path.join(root, "runs", candidateId, "publication-report.json");
    if (await pathExists(publicationReportPath)) throw new Error(`Cohort member ${candidateId} already has a publication report`);
    nextRun.status = "published";
    nextRun.publicationReport = { path: "publication-report.json", sha256: sha256(Buffer.from(reportText)) };
    candidates.push({ candidateId, runPath, originalRunText, nextRun, publicationReportPath, reportText });
  }

  let aggregate = null;
  let aggregateBytes = null;
  if (isV4) {
    if (records.length !== cohortEntry.manifest.candidateIds.length) throw new Error("Every v4 cohort member requires one finalized evaluator record");
    const finalizedRecords = records.map((entry) => {
      const record = { ...entry };
      delete record.__bytes;
      return record;
    });
    aggregate = buildCohortEvaluationAggregate({
      cohort: cohortEntry.manifest,
      measurementConditionsSha256,
      disclosureSha256,
      disclosure,
      records: finalizedRecords,
      generatedAt,
    });
    aggregate.evaluationRecords = aggregate.evaluationRecords.map((entry) => {
      const record = records.find(({ runId }) => runId === entry.runId);
      return { ...entry, sha256: sha256(record.__bytes) };
    });
    const aggregateIssues = validateCohortEvaluationAggregate(aggregate);
    if (aggregateIssues.length > 0) throw new Error(problemList("Generated cohort aggregate is invalid", aggregateIssues));
    aggregateBytes = jsonBytes(aggregate);
    nextCohort.extensions = {
      ...nextCohort.extensions,
      postReview: {
        disclosure: { path: DISCLOSURE_FILE, sha256: disclosureSha256 },
        aggregate: { path: AGGREGATE_FILE, sha256: sha256(aggregateBytes) },
      },
    };
  }
  nextCohort.status = "published";

  const createdReports = [];
  const createdPostReviewFiles = [];
  const replacedRuns = [];
  let cohortReplaced = false;
  const suffix = `publish-${process.pid}-${Date.now()}`;
  try {
    if (isV4) {
      const disclosureDestination = path.join(cohortEntry.root, DISCLOSURE_FILE);
      const aggregateDestination = path.join(cohortEntry.root, AGGREGATE_FILE);
      if (await pathExists(disclosureDestination) || await pathExists(aggregateDestination)) throw new Error("Open cohort already contains post-review disclosure or aggregate bytes");
      await writeFile(disclosureDestination, disclosureBytes, { flag: "wx" });
      createdPostReviewFiles.push(disclosureDestination);
      await writeFile(aggregateDestination, aggregateBytes, { flag: "wx" });
      createdPostReviewFiles.push(aggregateDestination);
    }
    for (const candidate of candidates) {
      await writeFile(candidate.publicationReportPath, candidate.reportText, { flag: "wx" });
      createdReports.push(candidate.publicationReportPath);
      await replaceAtomically(candidate.runPath, jsonBytes(candidate.nextRun), `${suffix}-${candidate.candidateId}`);
      replacedRuns.push(candidate);
    }
    await replaceAtomically(cohortPath, jsonBytes(nextCohort), suffix);
    cohortReplaced = true;
    const after = await validateFramework(root);
    if (after.issues.length > 0) throw new Error(`Framework validation failed after cohort publication:\n${after.issues.map((entry) => `${entry.scope}: ${entry.code}: ${entry.message}`).join("\n")}`);
  } catch (error) {
    if (cohortReplaced) await replaceAtomically(cohortPath, Buffer.from(originalCohortText), `${suffix}-rollback-cohort`).catch(() => {});
    for (const candidate of replacedRuns) await replaceAtomically(candidate.runPath, Buffer.from(candidate.originalRunText), `${suffix}-rollback-${candidate.candidateId}`).catch(() => {});
    for (const reportPath of createdReports) await rm(reportPath, { force: true });
    for (const postReviewPath of createdPostReviewFiles) await rm(postReviewPath, { force: true });
    throw error;
  } finally {
    await rm(`${cohortPath}.${suffix}.tmp`, { force: true }).catch(() => {});
  }
  return { cohortId, runCount: candidates.length, disclosureSha256, aggregateSha256: aggregateBytes ? sha256(aggregateBytes) : null };
}

async function main() {
  const cohortId = requiredArgument("--cohort-id");
  const rootIndex = process.argv.indexOf("--root");
  const projectRoot = rootIndex >= 0 ? path.resolve(process.argv[rootIndex + 1]) : process.cwd();
  const disclosureIndex = process.argv.indexOf("--disclosure");
  const disclosurePath = disclosureIndex >= 0 ? path.resolve(process.argv[disclosureIndex + 1]) : null;
  const result = await publishCohort({ projectRoot, cohortId, disclosurePath });
  console.log(`Published cohort ${result.cohortId} with ${result.runCount} sealed run${result.runCount === 1 ? "" : "s"}${result.aggregateSha256 ? `; aggregate ${result.aggregateSha256}` : ""}.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) await main();
