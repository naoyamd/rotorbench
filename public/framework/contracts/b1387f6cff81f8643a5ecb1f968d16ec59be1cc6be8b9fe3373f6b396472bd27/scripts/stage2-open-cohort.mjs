import "./official-execution-guard.mjs";
import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  sha256,
  readJson,
  validateCohort,
  validateFramework,
  validateMeasurementConditions,
} from "./framework-lib.mjs";
import { validateLaunchFreeze } from "./stage0-lib.mjs";

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function issueText(label, issues) {
  return `${label}:\n${issues
    .map((issue) => `${issue.code}: ${issue.message}`)
    .join("\n")}`;
}

export async function openCohort({
  projectRoot = process.cwd(),
  cohortId,
  launchId,
  conditionsPath,
  openedAt = new Date().toISOString(),
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(cohortId)) {
    throw new Error("cohort ID must use lowercase kebab-case");
  }
  const root = path.resolve(projectRoot);
  const conditions = await readJson(path.resolve(conditionsPath));
  const conditionIssues = validateMeasurementConditions(conditions);
  if (conditionIssues.length > 0) {
    throw new Error(issueText("Measurement conditions are invalid", conditionIssues));
  }
  if (Date.parse(conditions.frozenAt) > Date.parse(openedAt)) {
    throw new Error("Measurement conditions frozenAt must be at or before cohort openedAt");
  }
  const launchFreeze = await validateLaunchFreeze(root, launchId);
  if (launchFreeze.status !== "valid") {
    throw new Error(issueText("Frozen launch is invalid", launchFreeze.issues));
  }
  if (launchFreeze.release?.status !== "live-verified") {
    throw new Error("A cohort may open only for a live-verified launch");
  }
  const launch = launchFreeze.launch;
  if (
    conditions.launchId !== launch.id
    || conditions.launchDigest !== launch.launchDigest
    || conditions.fairnessFingerprint !== launch.fairnessFingerprint
    || conditions.executionProfileDigest !== launch.executionProfile.digest
  ) {
    throw new Error("Measurement conditions do not exactly bind the live launch");
  }
  const officialRepeatCount = launchFreeze.profile.extensions
    ?.officialRepeatCountPerModel;
  if (!Number.isInteger(officialRepeatCount) || officialRepeatCount < 1) {
    throw new Error("Frozen execution profile does not declare an official repeat count");
  }
  if (conditions.repetitionPolicy.runsPerModel !== officialRepeatCount) {
    throw new Error(
      `Official profile requires ${officialRepeatCount} runs per model`,
    );
  }

  const cohortRoot = path.join(root, "cohorts", cohortId);
  const conditionsBytes = await readFile(path.resolve(conditionsPath));
  const conditionsSha256 = sha256(conditionsBytes);
  const cohort = {
    schemaVersion: "1.0",
    id: cohortId,
    openedAt,
    launchId,
    fairnessFingerprint: launch.fairnessFingerprint,
    status: "open",
    candidateIds: conditions.candidateRunIds,
    extensions: {
      protocolVersion: launch.protocolVersion,
      measurementConditions: {
        path: "measurement-conditions.json",
        sha256: conditionsSha256,
        schemaVersion: conditions.schemaVersion,
        runsPerModel: conditions.repetitionPolicy.runsPerModel,
      },
    },
  };
  const cohortIssues = validateCohort(cohort);
  if (cohortIssues.length > 0) {
    throw new Error(issueText("Generated cohort is invalid", cohortIssues));
  }

  let created = false;
  try {
    await mkdir(cohortRoot, { recursive: false });
    created = true;
    await Promise.all([
      cp(path.resolve(conditionsPath), path.join(cohortRoot, "measurement-conditions.json"), {
        errorOnExist: true,
        force: false,
      }),
      writeFile(
        path.join(cohortRoot, "cohort.json"),
        `${JSON.stringify(cohort, null, 2)}\n`,
        { flag: "wx" },
      ),
    ]);
    const framework = await validateFramework(root);
    const cohortProblems = framework.issues.filter(
      ({ scope }) => scope === `cohorts/${cohortId}`,
    );
    if (cohortProblems.length > 0) {
      throw new Error(issueText("Opened cohort failed framework validation", cohortProblems));
    }
    return { cohort, conditionsSha256, root: cohortRoot };
  } catch (error) {
    if (created) await rm(cohortRoot, { recursive: true, force: true });
    throw error;
  }
}

async function main() {
  const result = await openCohort({
    projectRoot: path.resolve(
      argument("--project-root", { required: false }) || process.cwd(),
    ),
    cohortId: argument("--cohort-id"),
    launchId: argument("--launch-id"),
    conditionsPath: path.resolve(argument("--conditions")),
  });
  console.log(
    `Opened cohort ${result.cohort.id} with ${result.cohort.candidateIds.length} opaque runs; conditions ${result.conditionsSha256}.`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
