import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ensureInside,
  pathExists,
  validateFramework,
  validateReport,
} from "./framework-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const outputRoot = path.join(projectRoot, "public", "framework");
const filesRoot = path.join(outputRoot, "files");
const reportRoot = path.join(outputRoot, "reports");
const meshRoot = path.join(outputRoot, "meshes");
const workRoot = path.join(projectRoot, ".framework-staging");
const stagedReportRoot = path.join(workRoot, "reports");
const stagedMeshRoot = path.join(workRoot, "meshes");
const contractsRoot = path.join(outputRoot, "contracts");
const frameworkSchemaRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "schemas",
);

const framework = await validateFramework(projectRoot);
if (framework.issues.length > 0) {
  throw new Error(
    `Framework catalog input is invalid:\n${framework.issues
      .map((issue) => `${issue.scope}: ${issue.code}: ${issue.message}`)
      .join("\n")}`,
  );
}
const { benchmarks, taskPackets, launches, cohorts, runs } = framework;

await rm(filesRoot, { recursive: true, force: true });
await mkdir(filesRoot, { recursive: true });
await rm(reportRoot, { recursive: true, force: true });
await mkdir(reportRoot, { recursive: true });
await rm(meshRoot, { recursive: true, force: true });
await mkdir(meshRoot, { recursive: true });
await rm(contractsRoot, { recursive: true, force: true });
await mkdir(contractsRoot, { recursive: true });
for (const name of [
  "artifact.schema.json",
  "plan.schema.json",
  "work-record.schema.json",
  "submission.schema.json",
]) {
  await cp(path.join(frameworkSchemaRoot, name), path.join(contractsRoot, name));
}

const taskFilesRoot = path.join(outputRoot, "task-packets");
await rm(taskFilesRoot, { recursive: true, force: true });
await mkdir(taskFilesRoot, { recursive: true });

const catalogRuns = [];
const publishedCohorts = cohorts.filter(
  (cohort) =>
    cohort.manifest?.status === "published"
    && cohort.validationIssues.length === 0,
);
const eligibleRunIds = new Set(
  publishedCohorts.flatMap((cohort) => cohort.manifest.candidateIds),
);
for (const run of runs.filter((entry) =>
  entry.manifest?.status === "published"
  && entry.manifest?.seal?.sealed === true
  && entry.validationIssues.length === 0
  && eligibleRunIds.has(entry.manifest.id)
)) {
  const stagedReportPath = path.join(stagedReportRoot, `${run.manifest.id}.json`);
  const publicationReportPath = ensureInside(
    run.root,
    run.manifest.publicationReport.path,
  );
  let validation = run.publicationReportContent;
  let publicReportSource = publicationReportPath;
  try {
    const currentReport = JSON.parse(await readFile(stagedReportPath, "utf8"));
    if (
      validateReport(currentReport).length === 0
      && currentReport.runId === run.manifest.id
    ) {
      validation = currentReport;
      publicReportSource = stagedReportPath;
    }
  } catch {
    // The immutable publication report remains the fail-soft fallback.
  }
  const publicationSealAttestation = run.publicationReportContent?.checks?.some(
    (entry) =>
      entry.name === "Sealed candidate bundle"
      && entry.status === "pass"
      && entry.inputSha256 === run.manifest.seal.bundleSha256,
  );
  if (
    !run.publicationReportContent
    || run.publicationReportContent.status !== "valid"
    || run.publicationReportContent.issues.length > 0
    || run.publicationReportContent.checks.some((entry) => entry.status === "fail")
    || !publicationSealAttestation
  ) {
    continue;
  }
  await cp(publicReportSource, path.join(reportRoot, `${run.manifest.id}.json`));
  const stagedRunMeshRoot = path.join(stagedMeshRoot, run.manifest.id);
  if (await pathExists(stagedRunMeshRoot)) {
    await cp(stagedRunMeshRoot, path.join(meshRoot, run.manifest.id), {
      recursive: true,
    });
  }
  const filesDestination = path.join(filesRoot, run.manifest.id);
  const artifacts = [];
  for (const artifact of run.manifest.artifacts ?? []) {
    const source = ensureInside(run.root, artifact.path);
    const publishedPath = `artifacts/${artifact.id}.download`;
    const destination = ensureInside(filesDestination, publishedPath);
    if (source && destination) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
    }
    let viewer = null;
    if (artifact.role === "step") {
      const metadataPath = path.join(
        stagedMeshRoot,
        run.manifest.id,
        `${artifact.id}.metadata.json`,
      );
      if (await pathExists(metadataPath)) {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        viewer = metadata.status === "processed" ? { status: "ready", mesh: metadata.mesh, triangleCount: metadata.triangleCount } : { status: "failed", message: metadata.message };
      } else {
        viewer = { status: "failed", message: "STEP preprocessing report is unavailable" };
      }
    }
    artifacts.push({
      ...artifact,
      download: `framework/files/${run.manifest.id}/${publishedPath}`,
      downloadName: path.posix.basename(artifact.path),
      viewer,
    });
  }
  const processEvidence = {};
  for (const [key, evidence] of Object.entries(run.manifest.processEvidence ?? {})) {
    const source = ensureInside(run.root, evidence.path);
    const publishedPath = `process/${key}.download`;
    const destination = ensureInside(filesDestination, publishedPath);
    if (source && destination) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
    }
    processEvidence[key] = {
      ...evidence,
      download: `framework/files/${run.manifest.id}/${publishedPath}`,
      downloadName: path.posix.basename(evidence.path),
    };
  }
  catalogRuns.push({
    ...run.manifest,
    processEvidence,
    process: run.processEvidenceContent ?? null,
    artifacts,
    validation,
  });
}

const catalog = {
  schemaVersion: "1.0",
  benchmarks: benchmarks
    .filter(({ validationIssues }) => validationIssues.length === 0)
    .map(({ manifest }) => manifest),
  taskPackets: await Promise.all(taskPackets
    .filter(({ validationIssues }) => validationIssues.length === 0)
    .map(async ({ root, manifest }) => {
    const packetDestination = path.join(taskFilesRoot, manifest.id);
    await mkdir(packetDestination, { recursive: true });
    const declared = [manifest.instructions, ...manifest.inputs];
    for (const file of declared) {
      const source = ensureInside(root, file.path);
      const destination = ensureInside(packetDestination, file.path);
      if (source && destination) {
        await mkdir(path.dirname(destination), { recursive: true });
        await cp(source, destination);
      }
    }
    return {
      ...manifest,
      instructionsText: await readFile(
        ensureInside(root, manifest.instructions.path),
        "utf8",
      ),
      inputs: manifest.inputs.map((input) => ({
        ...input,
        download: `framework/task-packets/${manifest.id}/${input.path}`,
      })),
    };
    })),
  launches: launches
    .filter(({ validationIssues }) => validationIssues.length === 0)
    .map(({ manifest }) => manifest),
  cohorts: publishedCohorts.map(({ manifest }) => manifest),
  runs: catalogRuns.sort((left, right) => left.id.localeCompare(right.id)),
};
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Built framework catalog (${catalog.benchmarks.length} benchmarks, ${catalog.runs.length} runs).`);
