import "./official-execution-guard.mjs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  canonicalJson,
  ensureInside,
  pathExists,
  sha256,
  validateFramework,
  validateRunAuthorization,
} from "./framework-lib.mjs";

export const OPERATOR_ATTESTATION =
  "The operator attests that this authorization was created before the named external candidate run began. This is an auditable operator record, not cryptographic proof of external execution time.";

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

export function runConditionsSha256(runConditions) {
  return sha256(Buffer.from(canonicalJson(runConditions), "utf8"));
}

export function authorizationBindingIssues(
  authorization,
  { cohort, conditions, conditionsSha256, launch, profile },
) {
  const issues = [...validateRunAuthorization(authorization)];
  const add = (code, message) => issues.push({ code, message });
  if (authorization.runId && !cohort.candidateIds.includes(authorization.runId)) {
    add("authorization-run-membership", "authorization runId is not a predeclared cohort member");
  }
  if (
    authorization.cohortId !== cohort.id
    || authorization.launchId !== cohort.launchId
    || authorization.launchId !== launch.id
  ) {
    add("authorization-identity", "authorization does not bind the exact cohort and launch");
  }
  if (
    authorization.measurementConditionsSha256 !== conditionsSha256
    || authorization.runConditionsSha256 !== runConditionsSha256(conditions.runConditions)
  ) {
    add("authorization-conditions", "authorization does not bind the frozen measurement and run conditions");
  }
  if (
    authorization.launchDigest !== launch.launchDigest
    || authorization.fairnessFingerprint !== launch.fairnessFingerprint
    || authorization.executionProfileDigest !== launch.executionProfile?.digest
  ) {
    add("authorization-launch", "authorization does not bind the exact frozen launch");
  }
  if (
    Number.isNaN(Date.parse(authorization.issuedAt ?? ""))
    || Date.parse(authorization.issuedAt) < Date.parse(cohort.openedAt)
    || Date.parse(authorization.issuedAt) < Date.parse(conditions.frozenAt)
  ) {
    add("authorization-time-order", "authorization issuedAt must be at or after the frozen conditions and cohort opening");
  }
  if (
    profile?.extensions?.candidateWorkspaceReceiptRequired === true
    && !/^[a-f0-9]{64}$/.test(
      authorization.externalRunConfigurationSha256 ?? "",
    )
  ) {
    add(
      "authorization-workspace-receipt",
      "authorization must bind the operator-created candidate workspace receipt",
    );
  }
  return issues;
}

export async function authorizeRun({
  projectRoot = process.cwd(),
  cohortId,
  runId,
  operatorPseudonym,
  issuedAt = new Date().toISOString(),
  externalRunConfigurationSha256,
}) {
  const root = path.resolve(projectRoot);
  const framework = await validateFramework(root);
  if (framework.issues.length > 0) {
    throw new Error(
      `Target framework is invalid:\n${framework.issues
        .map((issue) => `${issue.scope}: ${issue.code}: ${issue.message}`)
        .join("\n")}`,
    );
  }
  const cohortEntry = framework.cohorts.find(
    (entry) => entry.manifest?.id === cohortId,
  );
  if (
    !cohortEntry?.manifest
    || cohortEntry.validationIssues.length > 0
    || cohortEntry.manifest.status !== "open"
  ) {
    throw new Error("Run authorization requires a valid open cohort");
  }
  if (!cohortEntry.manifest.candidateIds.includes(runId)) {
    throw new Error("Run ID is not a predeclared cohort member");
  }
  const launchEntry = framework.launches.find(
    (entry) => entry.manifest?.id === cohortEntry.manifest.launchId,
  );
  if (
    !launchEntry?.manifest
    || launchEntry.validationIssues.length > 0
    || launchEntry.release?.status !== "live-verified"
  ) {
    throw new Error("Run authorization requires the cohort's live-verified launch");
  }
  const conditionsRef = cohortEntry.manifest.extensions?.measurementConditions;
  const conditionsPath = ensureInside(cohortEntry.root, conditionsRef?.path ?? "");
  if (!conditionsPath || conditionsRef?.path !== "measurement-conditions.json") {
    throw new Error("Cohort has no safe frozen measurement conditions");
  }
  const conditionsBytes = await readFile(conditionsPath);
  const conditionsSha256 = sha256(conditionsBytes);
  if (conditionsSha256 !== conditionsRef.sha256) {
    throw new Error("Cohort measurement conditions do not match their opening hash");
  }
  const conditions = JSON.parse(conditionsBytes.toString("utf8"));
  const authorization = {
    schemaVersion: "1.0",
    assurance: "operator-attested-pre-run",
    runId,
    cohortId,
    launchId: launchEntry.manifest.id,
    issuedAt,
    measurementConditionsSha256: conditionsSha256,
    runConditionsSha256: runConditionsSha256(conditions.runConditions),
    launchDigest: launchEntry.manifest.launchDigest,
    fairnessFingerprint: launchEntry.manifest.fairnessFingerprint,
    executionProfileDigest: launchEntry.manifest.executionProfile.digest,
    operatorPseudonym,
    ...(externalRunConfigurationSha256
      ? { externalRunConfigurationSha256 }
      : {}),
    attestations: {
      conditionsFrozenBeforeRun: true,
      candidateReceivedOnlyLaunchHandoff: true,
      candidateHadNoHumanDesignIntervention: true,
      statement: OPERATOR_ATTESTATION,
    },
  };
  const issues = authorizationBindingIssues(authorization, {
    cohort: cohortEntry.manifest,
    conditions,
    conditionsSha256,
    launch: launchEntry.manifest,
    profile: launchEntry.profile,
  });
  if (issues.length > 0) {
    throw new Error(
      `Run authorization is invalid:\n${issues
        .map(({ code, message }) => `${code}: ${message}`)
        .join("\n")}`,
    );
  }
  const authorizationRoot = path.join(cohortEntry.root, "run-authorizations");
  const destination = ensureInside(
    authorizationRoot,
    `${runId}.json`,
  );
  if (!destination) throw new Error("Unsafe run authorization destination");
  if (await pathExists(destination)) {
    throw new Error(`Run authorization already exists for ${runId}`);
  }
  await mkdir(authorizationRoot, { recursive: true });
  const bytes = Buffer.from(`${JSON.stringify(authorization, null, 2)}\n`, "utf8");
  await writeFile(destination, bytes, { flag: "wx" });
  return {
    authorization,
    path: destination,
    sha256: sha256(bytes),
  };
}

async function main() {
  const externalRunConfigurationSha256 = argument(
    "--external-run-configuration-sha256",
    { required: false },
  );
  const result = await authorizeRun({
    projectRoot: path.resolve(
      argument("--project-root", { required: false }) || process.cwd(),
    ),
    cohortId: argument("--cohort-id"),
    runId: argument("--run-id"),
    operatorPseudonym: argument("--operator-pseudonym"),
    ...(externalRunConfigurationSha256
      ? { externalRunConfigurationSha256 }
      : {}),
  });
  console.log(
    `Authorized opaque run ${result.authorization.runId} before execution (${result.sha256}; ${result.authorization.assurance}).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
