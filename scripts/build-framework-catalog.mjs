import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureInside,
  pathExists,
  validateFramework,
  validateReport,
} from "./framework-lib.mjs";
import { validateExecutionContractSnapshot } from "./stage0-lib.mjs";

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
const launchFilesRoot = path.join(outputRoot, "launches");

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
await rm(launchFilesRoot, { recursive: true, force: true });
await mkdir(launchFilesRoot, { recursive: true });

const taskFilesRoot = path.join(outputRoot, "task-packets");
await rm(taskFilesRoot, { recursive: true, force: true });
await mkdir(taskFilesRoot, { recursive: true });

const activeBenchmarkIds = new Set(
  benchmarks
    .filter(({ manifest, validationIssues }) =>
      manifest?.status === "active" && validationIssues.length === 0,
    )
    .map(({ manifest }) => manifest.id),
);
const publicLaunches = launches.filter(
  (launch) =>
    launch.manifest
    && launch.validationIssues.length === 0
    && launch.publicEligible
    && activeBenchmarkIds.has(launch.manifest.taskPacket.id),
);
const publicPacketKeys = new Set(
  publicLaunches.map(
    ({ manifest }) => `${manifest.taskPacket.id}@${manifest.taskPacket.version}`,
  ),
);

const catalogLaunches = [];
const writtenContractDigests = new Set();
for (const launch of publicLaunches) {
  const launchDestination = path.join(launchFilesRoot, launch.manifest.id);
  await mkdir(launchDestination, { recursive: true });
  await cp(
    path.join(launch.root, "launch.json"),
    path.join(launchDestination, "launch.json"),
  );
  if (
    launch.manifest.protocolVersion === "3.0"
    && await pathExists(path.join(launch.root, "prompt.txt"))
  ) {
    await cp(
      path.join(launch.root, "prompt.txt"),
      path.join(launchDestination, "prompt.txt"),
    );
    const contractDigest = launch.manifest.executionContractDigest;
    const snapshot = await validateExecutionContractSnapshot(
      path.join(launch.root, "execution-contract"),
      contractDigest,
    );
    if (snapshot.status !== "valid") {
      throw new Error(
        `Frozen execution contract for ${launch.manifest.id} is invalid: ${snapshot.issues.map((issue) => issue.code).join(", ")}`,
      );
    }
    if (!writtenContractDigests.has(contractDigest)) {
      const destination = path.join(contractsRoot, contractDigest);
      await cp(path.join(launch.root, "execution-contract"), destination, {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
      writtenContractDigests.add(contractDigest);
    }
  }
  catalogLaunches.push({
    ...launch.manifest,
    releaseStatus: launch.release?.status ?? "release-ready",
    ...(launch.manifest.protocolVersion === "3.0" ? {
      promptText: await readFile(path.join(launch.root, "prompt.txt"), "utf8"),
    } : {}),
    manifestDownload: `framework/launches/${launch.manifest.id}/launch.json`,
    ...(launch.manifest.protocolVersion === "3.0" ? {
      promptDownload: `framework/launches/${launch.manifest.id}/prompt.txt`,
      executionContractRoot:
        `framework/contracts/${launch.manifest.executionContractDigest}`,
    } : {}),
  });
}

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
  && activeBenchmarkIds.has(entry.manifest.benchmarkId)
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
    .filter(({ manifest, validationIssues }) =>
      manifest
      && manifest.status === "active"
      && validationIssues.length === 0,
    )
    .map(({ manifest }) => manifest),
  taskPackets: await Promise.all(taskPackets
    .filter(({ manifest, validationIssues }) =>
      manifest
      && validationIssues.length === 0
      && publicPacketKeys.has(`${manifest.id}@${manifest.version}`))
    .map(async ({ root, manifest }) => {
    const packetDestination = path.join(taskFilesRoot, manifest.id, manifest.version);
    await mkdir(packetDestination, { recursive: true });
    for (const name of ["task.json", "packet.json", "packet-lock.json"]) {
      if (await pathExists(path.join(root, name))) {
        await cp(path.join(root, name), path.join(packetDestination, name));
      }
    }
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
      manifestDownload:
        `framework/task-packets/${manifest.id}/${manifest.version}/packet.json`,
      ...(manifest.schemaVersion === "3.0" ? {
        taskDefinitionDownload:
          `framework/task-packets/${manifest.id}/${manifest.version}/task.json`,
        lockDownload:
          `framework/task-packets/${manifest.id}/${manifest.version}/packet-lock.json`,
      } : {}),
      instructionsText: await readFile(
        ensureInside(root, manifest.instructions.path),
        "utf8",
      ),
      inputs: manifest.inputs.map((input) => ({
        ...input,
        download:
          `framework/task-packets/${manifest.id}/${manifest.version}/${input.path}`,
        downloadName: input.downloadName ?? path.posix.basename(input.path),
      })),
    };
    })),
  launches: catalogLaunches,
  cohorts: publishedCohorts.map(({ manifest }) => manifest),
  runs: catalogRuns.sort((left, right) => left.id.localeCompare(right.id)),
};
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
await writeFile(
  path.join(outputRoot, "stage0-report.json"),
  `${JSON.stringify({
    schemaVersion: "1.0",
    counts: {
      draftOrHeldRecords:
        taskPackets.filter((entry) => entry.stage0Issues?.length > 0 || !entry.lock).length
        + launches.filter((entry) => !entry.publicEligible || entry.stage0Issues?.length > 0).length,
      recordsWithBlockers:
        taskPackets.filter((entry) => entry.stage0Issues?.length > 0).length
        + launches.filter((entry) => entry.stage0Issues?.length > 0).length,
      liveVerifiedLaunches: launches.filter(
        (entry) => entry.release?.status === "live-verified" && entry.validationIssues.length === 0,
      ).length,
    },
  }, null, 2)}\n`,
);
console.log(`Built framework catalog (${catalog.benchmarks.length} benchmarks, ${catalog.runs.length} runs).`);
