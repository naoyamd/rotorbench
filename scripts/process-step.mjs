import { createRequire } from "node:module";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInside, sha256, validateFramework, validateReport } from "./framework-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const outputRoot = path.join(projectRoot, ".framework-staging");
const meshRoot = path.join(outputRoot, "meshes");
const reportRoot = path.join(outputRoot, "reports");
const require = createRequire(import.meta.url);
const processor = {
  name: "engineering-design-benchmark-framework",
  version: "1.0.0",
  stepEngine: "occt-import-js@0.0.23",
};

function numericArray(value) {
  const array = Array.from(value ?? []);
  if (array.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error("mesh contains non-finite geometry values");
  }
  return array.map((entry) => Number(entry.toFixed(8)));
}

function normalizeMesh(result, sourceArtifactId) {
  if (!result?.success || !Array.isArray(result.meshes)) {
    throw new Error("OpenCascade could not read a triangulated STEP model");
  }
  const meshes = result.meshes.map((mesh, index) => ({
    id: `mesh-${index + 1}`,
    name: typeof mesh.name === "string" ? mesh.name : `Mesh ${index + 1}`,
    color: Array.isArray(mesh.color) ? mesh.color.slice(0, 3).map((value) => Number(value)) : null,
    positions: numericArray(mesh.attributes?.position?.array),
    normals: mesh.attributes?.normal?.array ? numericArray(mesh.attributes.normal.array) : null,
    indices: numericArray(mesh.index?.array),
  }));
  const triangleCount = meshes.reduce((count, mesh) => count + Math.floor(mesh.indices.length / 3), 0);
  if (meshes.length === 0 || triangleCount === 0) throw new Error("STEP contained no displayable triangles");
  return { schemaVersion: "1.0", sourceArtifactId, meshes, triangleCount };
}

async function getOcct() {
  const factory = require("occt-import-js");
  return factory();
}

const validation = await validateFramework(projectRoot);
const runs = validation.runs.filter((run) =>
  ["validated", "published"].includes(run.manifest?.status)
  && run.manifest?.seal?.sealed === true
  && run.validationIssues.length === 0
);
await rm(meshRoot, { recursive: true, force: true });
await rm(reportRoot, { recursive: true, force: true });
await mkdir(meshRoot, { recursive: true });
await mkdir(reportRoot, { recursive: true });
const stepRuns = runs.filter((run) => run.manifest.artifacts.some((artifact) => artifact.role === "step"));
let occt = null;
let engineError = null;
if (stepRuns.length > 0) {
  try {
    occt = await getOcct();
  } catch (error) {
    engineError = error instanceof Error ? error.message : "OpenCascade initialization failed";
  }
}

for (const run of runs) {
  const checks = [...run.validationChecks];
  const issues = [...run.validationIssues];
  const stepArtifacts = run.manifest.artifacts.filter((artifact) => artifact.role === "step");
  const runMeshRoot = path.join(meshRoot, run.manifest.id);
  if (stepArtifacts.length > 0) await mkdir(runMeshRoot, { recursive: true });

  for (const artifact of stepArtifacts) {
    try {
      if (engineError || !occt) throw new Error(engineError ?? "OpenCascade is unavailable");
      const sourcePath = ensureInside(run.root, artifact.path);
      if (!sourcePath) throw new Error("STEP path is unsafe");
      const bytes = await readFile(sourcePath);
      const imported = occt.ReadStepFile(new Uint8Array(bytes), {
        linearUnit: "millimeter",
        linearDeflectionType: "bounding_box_ratio",
        linearDeflection: 0.001,
        angularDeflection: 0.5,
      });
      const mesh = normalizeMesh(imported, artifact.id);
      const meshFile = `${artifact.id}.mesh.json`;
      const meshJson = `${JSON.stringify(mesh)}\n`;
      const meshSha256 = sha256(Buffer.from(meshJson));
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
      await writeFile(path.join(runMeshRoot, meshFile), meshJson);
      await writeFile(path.join(runMeshRoot, `${artifact.id}.metadata.json`), `${JSON.stringify(metadata, null, 2)}\n`);
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

console.log(`Processed STEP artifacts for ${runs.length} run${runs.length === 1 ? "" : "s"}.`);
