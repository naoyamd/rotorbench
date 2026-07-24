import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

export const artifactRoles = new Set([
  "cad-source",
  "step",
  "drawing",
  "bom",
  "calculation",
  "supporting",
]);

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const schemaRoot = path.join(moduleRoot, "schemas");
const schemaNames = [
  "artifact.schema.json",
  "benchmark.schema.json",
  "run.schema.json",
  "validation-report.schema.json",
];
const schemas = [];
for (const name of schemaNames) {
  schemas.push(JSON.parse(await readFile(path.join(schemaRoot, name), "utf8")));
}
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of schemas) ajv.addSchema(schema);
const schemaValidators = {
  artifact: ajv.getSchema("https://rotorbench.example/schemas/artifact.schema.json"),
  benchmark: ajv.getSchema("https://rotorbench.example/schemas/benchmark.schema.json"),
  run: ajv.getSchema("https://rotorbench.example/schemas/run.schema.json"),
  report: ajv.getSchema("https://rotorbench.example/schemas/validation-report.schema.json"),
};

if (Object.values(schemaValidators).some((validator) => typeof validator !== "function")) {
  throw new Error("Framework JSON Schemas could not be compiled");
}

export function isSafeRelativePath(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value)) return false;
  const segments = value.split("/");
  return segments.every((segment) => segment !== "." && segment !== "..");
}

export function sha256(data) {
  return createHash("sha256").update(data).digest("hex");
}

function schemaIssues(validator, value, prefix = "") {
  if (validator(value)) return [];
  return (validator.errors ?? []).map((error) => {
    const instancePath = error.instancePath
      ? error.instancePath.slice(1).replaceAll("/", ".")
      : "";
    const missing = error.keyword === "required" ? error.params.missingProperty : "";
    const property = [prefix, instancePath, missing].filter(Boolean).join(".");
    return {
      code: `schema-${error.keyword}`,
      message: `${property || "manifest"} ${error.message ?? "is invalid"}`,
      ...(property ? { path: property } : {}),
    };
  });
}

export function validateArtifact(artifact, index = 0) {
  return schemaIssues(schemaValidators.artifact, artifact, `artifacts.${index}`);
}

export function validateBenchmark(manifest) {
  return schemaIssues(schemaValidators.benchmark, manifest);
}

export function validateRun(manifest) {
  const issues = schemaIssues(schemaValidators.run, manifest);
  if (Array.isArray(manifest?.artifacts)) {
    const ids = new Set();
    manifest.artifacts.forEach((artifact, index) => {
      if (ids.has(artifact?.id)) {
        issues.push({
          code: "duplicate-artifact-id",
          message: `artifacts.${index}.id is duplicated`,
          path: `artifacts.${index}.id`,
        });
      }
      ids.add(artifact?.id);
    });
  }
  return issues;
}

export function validateReport(report) {
  return schemaIssues(schemaValidators.report, report);
}

export async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

export async function listContentDirectories(root) {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_"))
      .map((entry) => entry.name)
      .sort((left, right) => left.localeCompare(right));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return [];
    throw error;
  }
}

export async function pathExists(filePath) {
  try {
    await lstat(filePath);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return false;
    throw error;
  }
}

export function ensureInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const resolvedRoot = path.resolve(root);
  const candidate = path.resolve(resolvedRoot, relativePath);
  return candidate.startsWith(`${resolvedRoot}${path.sep}`) ? candidate : null;
}

async function loadManifest(root, directory, name) {
  const entryRoot = path.join(root, directory);
  const manifestPath = path.join(entryRoot, name);
  try {
    return {
      directory,
      root: entryRoot,
      manifest: await readJson(manifestPath),
      loadIssues: [],
    };
  } catch (error) {
    const code = error && typeof error === "object" && error.code === "ENOENT"
      ? "missing-manifest"
      : "invalid-json";
    return {
      directory,
      root: entryRoot,
      manifest: null,
      loadIssues: [{
        code,
        message: `${name} ${code === "missing-manifest" ? "is missing" : "is not valid JSON"}`,
        path: name,
      }],
    };
  }
}

export async function loadFramework(projectRoot) {
  const benchmarksRoot = path.join(projectRoot, "benchmarks");
  const runsRoot = path.join(projectRoot, "runs");
  const benchmarkDirectories = await listContentDirectories(benchmarksRoot);
  const runDirectories = await listContentDirectories(runsRoot);
  return {
    benchmarks: await Promise.all(
      benchmarkDirectories.map((directory) =>
        loadManifest(benchmarksRoot, directory, "benchmark.json"),
      ),
    ),
    runs: await Promise.all(
      runDirectories.map((directory) => loadManifest(runsRoot, directory, "run.json")),
    ),
  };
}

function addIssue(target, code, message, issuePath) {
  target.push({ code, message, ...(issuePath ? { path: issuePath } : {}) });
}

function check(name, status, detail, extra = {}) {
  return { name, status, ...(detail ? { detail } : {}), ...extra };
}

async function validateArtifactFile(run, artifact, localIssues, checks) {
  const candidate = ensureInside(run.root, artifact.path);
  if (!candidate) {
    addIssue(localIssues, "unsafe-path", `artifact ${artifact.id} path is unsafe`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", "Path is not a safe relative file path", { artifactId: artifact.id }));
    return;
  }

  let stats;
  try {
    stats = await lstat(candidate);
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact cannot be read";
    addIssue(localIssues, "missing-artifact", `artifact ${artifact.id} is missing`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
    return;
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    addIssue(localIssues, "artifact-not-file", `artifact ${artifact.id} must be a regular file`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", "Artifact is not a regular file", { artifactId: artifact.id }));
    return;
  }

  try {
    const [resolvedRunRoot, resolvedArtifact] = await Promise.all([
      realpath(run.root),
      realpath(candidate),
    ]);
    if (!resolvedArtifact.startsWith(`${resolvedRunRoot}${path.sep}`)) {
      addIssue(localIssues, "artifact-escape", `artifact ${artifact.id} resolves outside the run directory`, artifact.path);
      checks.push(check(`Path ${artifact.id}`, "fail", "Resolved path escapes the run directory", { artifactId: artifact.id }));
      return;
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact real path cannot be resolved";
    addIssue(localIssues, "artifact-realpath", `artifact ${artifact.id} real path cannot be resolved`, artifact.path);
    checks.push(check(`Path ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
    return;
  }

  checks.push(check(`Path ${artifact.id}`, "pass", "Regular file resolves inside the run directory", { artifactId: artifact.id }));
  try {
    const actualHash = sha256(await readFile(candidate));
    if (actualHash !== artifact.sha256) {
      addIssue(localIssues, "hash-mismatch", `artifact ${artifact.id} SHA-256 does not match`, artifact.path);
      checks.push(check(`Hash ${artifact.id}`, "fail", "Declared and actual SHA-256 differ", { artifactId: artifact.id, inputSha256: actualHash }));
    } else {
      checks.push(check(`Hash ${artifact.id}`, "pass", "SHA-256 matches the manifest", { artifactId: artifact.id, inputSha256: actualHash }));
    }
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Artifact hash cannot be calculated";
    addIssue(localIssues, "hash-read-failed", `artifact ${artifact.id} cannot be hashed`, artifact.path);
    checks.push(check(`Hash ${artifact.id}`, "fail", detail, { artifactId: artifact.id }));
  }
}

export async function validateFramework(projectRoot) {
  const { benchmarks, runs } = await loadFramework(projectRoot);
  const issues = [];
  const benchmarkIds = new Set();
  const runIds = new Set();
  const benchmarksById = new Map();

  for (const benchmark of benchmarks) {
    const local = [...benchmark.loadIssues];
    if (benchmark.manifest) {
      local.push(...validateBenchmark(benchmark.manifest));
      if (benchmark.manifest.id !== benchmark.directory) {
        addIssue(local, "directory-id", "benchmark directory and id must match", "id");
      }
      if (benchmarkIds.has(benchmark.manifest.id)) {
        addIssue(local, "duplicate-id", "benchmark id is duplicated", "id");
      }
      benchmarkIds.add(benchmark.manifest.id);
      benchmarksById.set(benchmark.manifest.id, benchmark.manifest);
    }
    benchmark.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `benchmarks/${benchmark.directory}`, ...entry })));
  }

  for (const run of runs) {
    const local = [...run.loadIssues];
    const checks = [];
    if (!run.manifest) {
      checks.push(check("Run manifest", "fail", "run.json could not be loaded"));
    } else {
      const schemaProblems = validateRun(run.manifest);
      local.push(...schemaProblems);
      checks.push(check(
        "Run manifest",
        schemaProblems.length === 0 ? "pass" : "fail",
        schemaProblems.length === 0 ? "Draft 2020-12 schema validation passed" : `${schemaProblems.length} schema issue(s)`,
      ));
      if (run.manifest.id !== run.directory) {
        addIssue(local, "directory-id", "run directory and id must match", "id");
      }
      if (runIds.has(run.manifest.id)) {
        addIssue(local, "duplicate-id", "run id is duplicated", "id");
      }
      runIds.add(run.manifest.id);
      const benchmark = benchmarksById.get(run.manifest.benchmarkId);
      if (!benchmark) {
        addIssue(local, "unknown-benchmark", "benchmarkId does not name a checked-in benchmark", "benchmarkId");
        checks.push(check("Benchmark reference", "fail", "Referenced benchmark does not exist"));
      } else if (run.manifest.benchmarkVersion !== benchmark.version) {
        addIssue(local, "benchmark-version-mismatch", "benchmarkVersion does not match the benchmark manifest", "benchmarkVersion");
        checks.push(check("Benchmark reference", "fail", "Benchmark version does not match"));
      } else {
        checks.push(check("Benchmark reference", "pass", `${benchmark.id} version ${benchmark.version}`));
      }
      if (Array.isArray(run.manifest.artifacts)) {
        for (const artifact of run.manifest.artifacts) {
          if (validateArtifact(artifact).length === 0) {
            await validateArtifactFile(run, artifact, local, checks);
          }
        }
      }
    }
    run.validationChecks = checks;
    run.validationIssues = local;
    issues.push(...local.map((entry) => ({ scope: `runs/${run.directory}`, ...entry })));
  }
  return { benchmarks, runs, issues };
}
