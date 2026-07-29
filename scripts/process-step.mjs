import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureInside, sha256, validateFramework, validateReport } from "./framework-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const outputRoot = path.join(projectRoot, ".framework-staging");
const meshRoot = path.join(outputRoot, "meshes");
const reportRoot = path.join(outputRoot, "reports");
const workerRoot = path.join(outputRoot, "step-worker");
// The worker is part of this trusted processor, not candidate input under
// `--root`; fixtures and isolated workspaces therefore use this module's
// location rather than assuming a scripts directory in the candidate root.
const workerPath = path.join(path.dirname(fileURLToPath(import.meta.url)), "process-step-worker.mjs");
const execFileAsync = promisify(execFile);
const workerLimits = {
  timeoutMs: 60_000,
  maxOldSpaceMb: 512,
};
const processor = {
  name: "engineering-design-benchmark-framework",
  version: "1.0.0",
  stepEngine: "occt-import-js@0.0.23",
  isolation: {
    process: "separate-node-worker",
    timeoutMs: workerLimits.timeoutMs,
    maxOldSpaceMb: workerLimits.maxOldSpaceMb,
    networkIsolation: "not-asserted; worker imports no network clients",
  },
};

async function processStepIsolated({ sourcePath, outputPath, artifactId }) {
  await execFileAsync(
    process.execPath,
    [
      `--max-old-space-size=${workerLimits.maxOldSpaceMb}`,
      workerPath,
      "--input",
      sourcePath,
      "--output",
      outputPath,
      "--artifact-id",
      artifactId,
    ],
    {
      timeout: workerLimits.timeoutMs,
      windowsHide: true,
      maxBuffer: 1_048_576,
      killSignal: "SIGKILL",
      env: {
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
        WINDIR: process.env.WINDIR ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        NO_PROXY: "*",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
      },
    },
  );
  const meshBytes = await readFile(outputPath);
  const mesh = JSON.parse(meshBytes.toString("utf8"));
  if (
    mesh?.schemaVersion !== "1.0"
    || mesh?.sourceArtifactId !== artifactId
    || !Number.isInteger(mesh?.triangleCount)
    || mesh.triangleCount < 1
    || !Array.isArray(mesh.meshes)
    || mesh.meshes.length < 1
  ) {
    throw new Error("isolated STEP worker returned an invalid derived mesh");
  }
  return { mesh, meshBytes };
}

const validation = await validateFramework(projectRoot);
const runs = validation.runs.filter((run) =>
  ["validated", "published"].includes(run.manifest?.status)
  && run.manifest?.seal?.sealed === true
  && run.validationIssues.length === 0
);
await rm(meshRoot, { recursive: true, force: true });
await rm(reportRoot, { recursive: true, force: true });
await rm(workerRoot, { recursive: true, force: true });
await mkdir(meshRoot, { recursive: true });
await mkdir(reportRoot, { recursive: true });
await mkdir(workerRoot, { recursive: true });

for (const run of runs) {
  const checks = [...run.validationChecks];
  const issues = [...run.validationIssues];
  const stepArtifacts = run.manifest.artifacts.filter((artifact) => artifact.role === "step");
  const runMeshRoot = path.join(meshRoot, run.manifest.id);
  if (stepArtifacts.length > 0) await mkdir(runMeshRoot, { recursive: true });

  for (const artifact of stepArtifacts) {
    try {
      const sourcePath = ensureInside(run.root, artifact.path);
      if (!sourcePath) throw new Error("STEP path is unsafe");
      const bytes = await readFile(sourcePath);
      if (sha256(bytes) !== artifact.sha256) {
        throw new Error("STEP bytes no longer match the sealed artifact hash");
      }
      const isolatedRunRoot = path.join(workerRoot, run.manifest.id);
      await mkdir(isolatedRunRoot, { recursive: true });
      const workerOutputPath = path.join(
        isolatedRunRoot,
        `${artifact.id}.${process.pid}.mesh.json`,
      );
      const { mesh, meshBytes } = await processStepIsolated({
        sourcePath,
        outputPath: workerOutputPath,
        artifactId: artifact.id,
      });
      const meshFile = `${artifact.id}.mesh.json`;
      const meshSha256 = sha256(meshBytes);
      const metadata = {
        schemaVersion: "1.0",
        runId: run.manifest.id,
        artifactId: artifact.id,
        status: "processed",
        inputSha256: sha256(bytes),
        processor,
        triangleCount: mesh.triangleCount,
        meshSha256,
        mesh: `framework/meshes/${run.manifest.id}/${meshFile}`,
      };
      await writeFile(path.join(runMeshRoot, meshFile), meshBytes);
      await writeFile(path.join(runMeshRoot, `${artifact.id}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
      await rm(workerOutputPath, { force: true });
      checks.push({
        name: `STEP ${artifact.id}`,
        status: "pass",
        detail: `${mesh.triangleCount} triangles generated`,
        artifactId: artifact.id,
        inputSha256: metadata.inputSha256,
        derivedSha256: meshSha256,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : "STEP processing failed";
      const metadata = {
        schemaVersion: "1.0",
        runId: run.manifest.id,
        artifactId: artifact.id,
        status: "failed",
        inputSha256: artifact.sha256,
        processor,
        message,
      };
      await writeFile(path.join(runMeshRoot, `${artifact.id}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
      checks.push({ name: `STEP ${artifact.id}`, status: "fail", detail: message, artifactId: artifact.id, inputSha256: artifact.sha256 });
      issues.push({ code: "step-processing-failed", message, path: artifact.path });
    }
  }

  const report = {
    schemaVersion: "1.0",
    runId: run.manifest.id,
    status: issues.length > 0 ? "invalid" : "valid",
    generatedAt: new Date().toISOString(),
    processor,
    checks,
    issues,
  };
  const reportIssues = validateReport(report);
  if (reportIssues.length > 0) {
    throw new Error(`Generated validation report for ${run.manifest.id} is invalid: ${reportIssues.map((entry) => entry.message).join("; ")}`);
  }
  await writeFile(path.join(reportRoot, `${run.manifest.id}.json`), `${JSON.stringify(report, null, 2)}\n`);
}

await rm(workerRoot, { recursive: true, force: true });
console.log(`Processed STEP artifacts for ${runs.length} run${runs.length === 1 ? "" : "s"}.`);
