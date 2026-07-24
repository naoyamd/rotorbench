import { readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  pathExists,
  sha256,
  validateFramework,
  validateReport,
} from "./framework-lib.mjs";

function requiredArgument(name) {
  const index = process.argv.indexOf(name);
  if (index < 0 || !process.argv[index + 1]) {
    throw new Error(`Missing required argument ${name}`);
  }
  return process.argv[index + 1];
}

const cohortId = requiredArgument("--cohort-id");
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cohortId)) {
  throw new Error("cohort ID must use lowercase kebab-case");
}
const rootIndex = process.argv.indexOf("--root");
const projectRoot = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1])
  : process.cwd();
const cohortPath = path.join(projectRoot, "cohorts", cohortId, "cohort.json");
const originalCohortText = await readFile(cohortPath, "utf8");
const nextCohort = JSON.parse(originalCohortText);

const before = await validateFramework(projectRoot);
if (before.issues.length > 0) {
  throw new Error(
    `Framework validation failed before cohort publication:\n${before.issues
      .map((issue) => `${issue.scope}: ${issue.code}: ${issue.message}`)
      .join("\n")}`,
  );
}
const cohortEntry = before.cohorts.find(
  (entry) => entry.manifest?.id === cohortId,
);
if (
  !cohortEntry?.manifest
  || cohortEntry.validationIssues.length > 0
  || cohortEntry.manifest.status !== "open"
) {
  throw new Error("Only a valid, open cohort can transition to published");
}

const candidates = [];
for (const candidateId of cohortEntry.manifest.candidateIds) {
  const runEntry = before.runs.find(
    (entry) => entry.manifest?.id === candidateId,
  );
  if (
    !runEntry?.manifest
    || runEntry.validationIssues.length > 0
    || runEntry.manifest.status !== "validated"
    || runEntry.manifest.seal?.sealed !== true
    || runEntry.manifest.cohortId !== cohortId
    || runEntry.manifest.launchId !== cohortEntry.manifest.launchId
    || runEntry.manifest.fairnessFingerprint
      !== cohortEntry.manifest.fairnessFingerprint
  ) {
    throw new Error(
      `Cohort member ${candidateId} must be a valid, sealed, validated run with matching launch and fingerprint`,
    );
  }

  const stagedReportPath = path.join(
    projectRoot,
    ".framework-staging",
    "reports",
    `${candidateId}.json`,
  );
  let reportText;
  let report;
  try {
    reportText = await readFile(stagedReportPath, "utf8");
    report = JSON.parse(reportText);
  } catch {
    throw new Error(
      `Cohort member ${candidateId} is missing its staged validation report`,
    );
  }
  const reportProblems = validateReport(report);
  const sealAttestation = report.checks?.some(
    (entry) =>
      entry.name === "Sealed candidate bundle"
      && entry.status === "pass"
      && entry.inputSha256 === runEntry.manifest.seal.bundleSha256,
  );
  if (
    reportProblems.length > 0
    || report.runId !== candidateId
    || report.status !== "valid"
    || report.issues.length > 0
    || report.checks.some((entry) => entry.status === "fail")
    || !sealAttestation
  ) {
    throw new Error(
      `Cohort member ${candidateId} does not have a successful report for its current seal`,
    );
  }

  const runPath = path.join(projectRoot, "runs", candidateId, "run.json");
  const originalRunText = await readFile(runPath, "utf8");
  const nextRun = JSON.parse(originalRunText);
  const publicationReportPath = path.join(
    projectRoot,
    "runs",
    candidateId,
    "publication-report.json",
  );
  if (await pathExists(publicationReportPath)) {
    throw new Error(
      `Cohort member ${candidateId} already has a publication report`,
    );
  }
  nextRun.status = "published";
  nextRun.publicationReport = {
    path: "publication-report.json",
    sha256: sha256(Buffer.from(reportText)),
  };
  candidates.push({
    candidateId,
    runPath,
    originalRunText,
    nextRun,
    publicationReportPath,
    reportText,
  });
}

nextCohort.status = "published";
const createdReports = [];
try {
  for (const candidate of candidates) {
    await writeFile(
      candidate.publicationReportPath,
      candidate.reportText,
      { flag: "wx" },
    );
    createdReports.push(candidate.publicationReportPath);
    await writeFile(
      candidate.runPath,
      `${JSON.stringify(candidate.nextRun, null, 2)}\n`,
    );
  }
  await writeFile(cohortPath, `${JSON.stringify(nextCohort, null, 2)}\n`);
  const after = await validateFramework(projectRoot);
  if (after.issues.length > 0) {
    throw new Error(
      `Framework validation failed after cohort publication:\n${after.issues
        .map((issue) => `${issue.scope}: ${issue.code}: ${issue.message}`)
        .join("\n")}`,
    );
  }
} catch (error) {
  await writeFile(cohortPath, originalCohortText);
  for (const candidate of candidates) {
    await writeFile(candidate.runPath, candidate.originalRunText);
  }
  for (const reportPath of createdReports) {
    await rm(reportPath, { force: true });
  }
  throw error;
}

console.log(
  `Published cohort ${cohortId} with ${candidates.length} sealed run${candidates.length === 1 ? "" : "s"}.`,
);
