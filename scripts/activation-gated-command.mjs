import { spawn } from "node:child_process";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateFramework } from "./framework-lib.mjs";

const identitySelectors = ["--launch-id", "--cohort-id", "--run-id"];
const rootSelectors = ["--project-root", "--root"];
const runtimePolicies = new Map([
  ["stage1-authorize-run", {
    script: "stage1-authorize-run.mjs",
    rootFlag: "--project-root",
    identity: "cohort",
    allowedIdentity: ["--cohort-id", "--run-id"],
  }],
  ["stage2-open-cohort", {
    script: "stage2-open-cohort.mjs",
    rootFlag: "--project-root",
    identity: "launch",
    allowedIdentity: ["--launch-id", "--cohort-id"],
  }],
  ["stage2-integrate", {
    script: "stage2-integrate.mjs",
    rootFlag: null,
    identity: "cohort",
    allowedIdentity: ["--cohort-id"],
  }],
  ["stage2-sanitize", {
    script: "stage2-sanitize.mjs",
    rootFlag: "--project-root",
    identity: "run",
    allowedIdentity: ["--run-id"],
  }],
  ["stage2-prepare-review", {
    script: "stage2-review-package.mjs",
    rootFlag: "--project-root",
    identity: "run",
    allowedIdentity: ["--run-id"],
  }],
  ["stage2-seal-review", {
    script: "stage2-seal-review.mjs",
    rootFlag: "--project-root",
    identity: "run",
    allowedIdentity: ["--run-id"],
  }],
  ["stage2-finalize-evaluation", {
    script: "stage2-finalize-evaluation.mjs",
    rootFlag: "--root",
    identity: "run",
    allowedIdentity: ["--run-id"],
  }],
  ["stage2-publish-cohort", {
    script: "stage2-publish-cohort.mjs",
    rootFlag: "--root",
    identity: "cohort",
    allowedIdentity: ["--cohort-id"],
  }],
  ["stage2-export-publication", {
    script: "stage2-export-publication.mjs",
    rootFlag: "--project-root",
    identity: "cohort",
    allowedIdentity: ["--cohort-id"],
  }],
  ["evaluation-score", {
    script: "evaluate-engineering-submission.mjs",
    rootFlag: "--project-root",
    identity: "run",
    allowedIdentity: ["--run-id"],
  }],
  ["evaluation-aggregate", {
    script: "aggregate-engineering-benchmark.mjs",
    rootFlag: null,
    identity: "aggregate",
    allowedIdentity: [],
  }],
]);

function argumentOccurrences(name, values) {
  return values.flatMap((value, index) => value === name ? [index] : []);
}

function singleArgument(name, values, { required = false } = {}) {
  const occurrences = argumentOccurrences(name, values);
  if (occurrences.length > 1) {
    throw new Error(`Duplicate ${name} is not allowed on an activation-gated command`);
  }
  if (occurrences.length === 0) {
    if (required) throw new Error(`Missing required argument ${name}`);
    return "";
  }
  const value = values[occurrences[0] + 1] ?? "";
  if (!value || value === "--" || value.startsWith("--")) {
    throw new Error(`Missing required value for ${name}`);
  }
  return value;
}

function commandArguments() {
  const values = process.argv.slice(2);
  const runtime = singleArgument("--runtime", values, { required: true });
  const runtimeIndex = values.indexOf("--runtime");
  return {
    runtime,
    forwarded: values.filter(
      (_, index) => index !== runtimeIndex && index !== runtimeIndex + 1,
    ),
  };
}

function validateSelectorSurface(policy, values) {
  for (const selector of identitySelectors) {
    const allowed = policy.allowedIdentity.includes(selector);
    const count = argumentOccurrences(selector, values).length;
    if (!allowed && count > 0) {
      throw new Error(`${selector} is not a valid selector for this runtime`);
    }
    if (count > 1) {
      throw new Error(`Duplicate ${selector} is not allowed`);
    }
  }
  for (const selector of rootSelectors) {
    const allowed = policy.rootFlag === selector;
    const count = argumentOccurrences(selector, values).length;
    if (!allowed && count > 0) {
      throw new Error(`${selector} cannot select a different activation-gate root`);
    }
    if (count > 1) {
      throw new Error(`Duplicate ${selector} is not allowed`);
    }
  }
}

function projectRootFromPolicy(policy, values) {
  if (!policy.rootFlag) return process.cwd();
  const root = singleArgument(policy.rootFlag, values);
  return path.resolve(root || process.cwd());
}

async function launchIdFromAggregateDirectory(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const records = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
      .map(async (entry) => JSON.parse(await readFile(path.join(directory, entry.name), "utf8"))),
  );
  const launchIds = new Set(records.map((record) => record?.launchId).filter(
    (launchId) => typeof launchId === "string" && launchId.length > 0,
  ));
  if (launchIds.size !== 1) {
    throw new Error(
      "evaluation-aggregate requires records for exactly one activation-verified launch",
    );
  }
  return [...launchIds][0];
}

function validEntryById(entries, id, kind) {
  const entry = entries.find((candidate) => candidate.manifest?.id === id);
  if (!entry?.manifest || entry.validationIssues.length > 0) {
    throw new Error(`Cannot resolve activation launch: ${kind} ${id} is not valid`);
  }
  return entry;
}

async function resolveLaunchId(framework, policy, values) {
  if (policy.identity === "launch") {
    return singleArgument("--launch-id", values, { required: true });
  }
  if (policy.identity === "cohort") {
    const cohortId = singleArgument("--cohort-id", values, { required: true });
    return validEntryById(framework.cohorts, cohortId, "cohort").manifest.launchId;
  }
  if (policy.identity === "run") {
    const runId = singleArgument("--run-id", values, { required: true });
    return validEntryById(framework.runs, runId, "run").manifest.launchId;
  }
  if (policy.identity === "aggregate") {
    const directory = singleArgument("--dir", values, { required: true });
    return launchIdFromAggregateDirectory(path.resolve(directory));
  }
  throw new Error(`Unsupported activation identity policy: ${policy.identity}`);
}

async function delegate(scriptPath, argumentsToForward) {
  const result = await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [scriptPath, ...argumentsToForward], {
      cwd: process.cwd(),
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code, signal) => resolve({ code, signal }));
  });
  if (result.signal) {
    process.kill(process.pid, result.signal);
    return;
  }
  process.exitCode = result.code ?? 1;
}

export async function runActivationGatedCommand({ runtime, forwarded }) {
  const policy = runtimePolicies.get(runtime);
  if (!policy) throw new Error(`Unsupported activation-gated runtime: ${runtime}`);
  validateSelectorSurface(policy, forwarded);
  const projectRoot = projectRootFromPolicy(policy, forwarded);
  const framework = await validateFramework(projectRoot);
  const launchId = await resolveLaunchId(framework, policy, forwarded);
  const launch = framework.launches.find((entry) => entry.manifest?.id === launchId);
  if (!launch?.manifest || launch.handoffEligible !== true || launch.validationIssues.length > 0) {
    throw new Error(
      `Official ${runtime} requires an activation-verified Stage B launch: ${launchId}`,
    );
  }
  const [contractRoot, scriptPath] = await Promise.all([
    realpath(path.join(launch.root, "execution-contract")),
    realpath(path.join(launch.root, "execution-contract", "scripts", policy.script)),
  ]);
  if (!scriptPath.startsWith(`${contractRoot}${path.sep}`)) {
    throw new Error("Launch-frozen runtime escapes its execution contract");
  }
  await delegate(scriptPath, forwarded);
}

async function main() {
  const { runtime, forwarded } = commandArguments();
  await runActivationGatedCommand({ runtime, forwarded });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
