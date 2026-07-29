import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  ensureInside,
  manifestDigest,
  pathExists,
  validateFramework,
  validateReport,
} from "./framework-lib.mjs";
import { publicEvaluationSummary } from "./public-evaluation-summary.mjs";
import { validateExecutionContractSnapshot } from "./stage0-lib.mjs";
import { loadPublicCohortPublications } from "./publication-lib.mjs";

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
const activationsOutputRoot = path.join(outputRoot, "activations");
const launchFilesRoot = path.join(outputRoot, "launches");
const evaluationRoot = path.join(outputRoot, "evaluation");
const publicEvaluationRoot = path.join(outputRoot, "evaluations");
const cohortPublicationRoot = path.join(outputRoot, "cohorts");
const portablePublicationRoot = path.join(outputRoot, "publications");
const workspaceBootstrapSourceRoot = path.join(projectRoot, "workspace-bootstrap");
const workspaceBootstrapOutputRoot = path.join(outputRoot, "workspaces");
const publicEvaluationSourceFiles = new Set([
  "assessment-template.json",
  "assessment.schema.json",
  "cohort-disclosure-template.json",
  "measurement-conditions-template.json",
  "scoring-contract.json",
]);

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
await rm(activationsOutputRoot, { recursive: true, force: true });
await mkdir(activationsOutputRoot, { recursive: true });
await rm(launchFilesRoot, { recursive: true, force: true });
await mkdir(launchFilesRoot, { recursive: true });
await rm(evaluationRoot, { recursive: true, force: true });
await mkdir(evaluationRoot, { recursive: true });
if (await pathExists(path.join(projectRoot, "evaluation"))) {
  const evaluationDirectories = await readdir(path.join(projectRoot, "evaluation"), {
    withFileTypes: true,
  });
  for (const directory of evaluationDirectories) {
    if (!directory.isDirectory()) continue;
    const sourceDirectory = path.join(projectRoot, "evaluation", directory.name);
    const destinationDirectory = path.join(evaluationRoot, directory.name);
    for (const entry of await readdir(sourceDirectory, { withFileTypes: true })) {
      if (!entry.isFile() || !publicEvaluationSourceFiles.has(entry.name)) continue;
      await mkdir(destinationDirectory, { recursive: true });
      await cp(path.join(sourceDirectory, entry.name), path.join(destinationDirectory, entry.name));
    }
  }
}
await rm(publicEvaluationRoot, { recursive: true, force: true });
await mkdir(publicEvaluationRoot, { recursive: true });
await rm(cohortPublicationRoot, { recursive: true, force: true });
await mkdir(cohortPublicationRoot, { recursive: true });
await rm(portablePublicationRoot, { recursive: true, force: true });
await mkdir(portablePublicationRoot, { recursive: true });
await rm(workspaceBootstrapOutputRoot, { recursive: true, force: true });
await mkdir(workspaceBootstrapOutputRoot, { recursive: true });
if (await pathExists(workspaceBootstrapSourceRoot)) {
  const bootstrapEntries = await readdir(workspaceBootstrapSourceRoot, {
    withFileTypes: true,
  });
  for (const entry of bootstrapEntries) {
    if (!entry.isFile() || !entry.name.endsWith(".json")) {
      throw new Error(
        `workspace-bootstrap may contain only top-level JSON files: ${entry.name}`,
      );
    }
    await cp(
      path.join(workspaceBootstrapSourceRoot, entry.name),
      path.join(workspaceBootstrapOutputRoot, entry.name),
    );
  }
}

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
const currentProtocol = (protocolVersion) =>
  protocolVersion === "3.0" || protocolVersion === "4.0";
for (const launch of publicLaunches) {
  const launchDestination = path.join(launchFilesRoot, launch.manifest.id);
  await mkdir(launchDestination, { recursive: true });
  await cp(
    path.join(launch.root, "launch.json"),
    path.join(launchDestination, "launch.json"),
  );
  if (launch.activationVerified === true) {
    await mkdir(path.join(activationsOutputRoot, launch.manifest.id), { recursive: true });
    await cp(
      path.join(projectRoot, "activations", launch.manifest.id, "verification.json"),
      path.join(activationsOutputRoot, launch.manifest.id, "verification.json"),
      { recursive: false, errorOnExist: true, force: false },
    );
  }
  if (currentProtocol(launch.manifest.protocolVersion)
    && await pathExists(path.join(launch.root, "prompt.txt"))) {
    await cp(
      path.join(launch.root, "prompt.txt"),
      path.join(launchDestination, "prompt.txt"),
    );
    if (launch.handoffEligible === true) {
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
  }
  catalogLaunches.push({
    ...launch.manifest,
    releaseStatus: launch.release?.status ?? "release-ready",
    activationVerified: launch.activationVerified === true,
    handoffEligible: launch.handoffEligible === true,
    ...(launch.handoffEligible === true && launch.activationVerification ? {
      activationVerificationDigest: manifestDigest(launch.activationVerification),
    } : {}),
    ...(currentProtocol(launch.manifest.protocolVersion)
      && launch.handoffEligible === true ? {
      promptText: await readFile(path.join(launch.root, "prompt.txt"), "utf8"),
    } : {}),
    manifestDownload: `framework/launches/${launch.manifest.id}/launch.json`,
    ...(currentProtocol(launch.manifest.protocolVersion)
      && launch.handoffEligible === true ? {
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
  let evaluation = null;
  if (run.manifest.extensions?.protocolVersion === "4.0" && run.manifest.evaluation?.recordPath) {
    const source = ensureInside(run.root, run.manifest.evaluation.recordPath);
    const destination = path.join(publicEvaluationRoot, `${run.manifest.id}.json`);
    if (source) {
      const recordBytes = await readFile(source);
      const summary = publicEvaluationSummary(JSON.parse(recordBytes.toString("utf8")), recordBytes);
      await writeFile(destination, `${JSON.stringify(summary, null, 2)}\n`);
      evaluation = {
        summary,
        download: `framework/evaluations/${run.manifest.id}.json`,
      };
    }
  }
  catalogRuns.push({
    ...run.manifest,
    processEvidence,
    process: run.processEvidenceContent ?? null,
    artifacts,
    validation,
    evaluation,
  });
}

const catalogCohorts = await Promise.all(publishedCohorts.map(async ({ root, manifest }) => {
  const postReview = manifest.extensions?.postReview;
  if (manifest.extensions?.protocolVersion !== "4.0" || !postReview) return manifest;
  const destination = path.join(cohortPublicationRoot, manifest.id);
  await mkdir(destination, { recursive: true });
  const disclosureSource = ensureInside(root, postReview.disclosure.path);
  const aggregateSource = ensureInside(root, postReview.aggregate.path);
  if (!disclosureSource || !aggregateSource) throw new Error(`Published cohort ${manifest.id} has unsafe post-review references`);
  await Promise.all([
    cp(disclosureSource, path.join(destination, "cohort-disclosure.json")),
    cp(aggregateSource, path.join(destination, "cohort-evaluation-aggregate.json")),
  ]);
  return {
    ...manifest,
    postReview: {
      disclosure: {
        ...postReview.disclosure,
        content: JSON.parse(await readFile(disclosureSource, "utf8")),
        download: `framework/cohorts/${manifest.id}/cohort-disclosure.json`,
      },
      aggregate: {
        ...postReview.aggregate,
        content: JSON.parse(await readFile(aggregateSource, "utf8")),
        download: `framework/cohorts/${manifest.id}/cohort-evaluation-aggregate.json`,
      },
    },
  };
}));

// A public repository never receives evaluator-owned `runs/` or `cohorts/`
// state.  Instead it receives an independently hash-validated portable
// publication.  Copy the validated bundle verbatim into the static output and
// adapt only its already-safe metadata to the catalog's neutral display shape.
const portablePublications = await loadPublicCohortPublications(projectRoot);
const localCohortIds = new Set(catalogCohorts.map(({ id }) => id));
const localRunIds = new Set(catalogRuns.map(({ id }) => id));
const portableCatalogCohorts = [];
const portableCatalogRuns = [];
for (const publication of portablePublications) {
  if (localCohortIds.has(publication.manifest.cohortId)) {
    throw new Error(`Cohort ${publication.manifest.cohortId} exists in both private state and a portable publication`);
  }
  const destination = path.join(portablePublicationRoot, publication.manifest.cohortId);
  await cp(publication.root, destination, { recursive: true, errorOnExist: true, force: false });
  const disclosureEntry = publication.files.get("cohort-disclosure.json");
  const aggregateEntry = publication.files.get("cohort-evaluation-aggregate.json");
  portableCatalogCohorts.push({
    schemaVersion: "1.0",
    id: publication.manifest.cohortId,
    launchId: publication.manifest.launchId,
    fairnessFingerprint: publication.manifest.fairnessFingerprint,
    status: "published",
    candidateIds: [...publication.runMetadata.keys()].sort(),
    extensions: { protocolVersion: "4.0", publicationSource: "portable-publication-v1" },
    postReview: {
      disclosure: {
        path: "cohort-disclosure.json",
        sha256: disclosureEntry.sha256,
        content: publication.disclosure,
        download: `framework/publications/${publication.manifest.cohortId}/cohort-disclosure.json`,
      },
      aggregate: {
        path: "cohort-evaluation-aggregate.json",
        sha256: aggregateEntry.sha256,
        content: publication.aggregate,
        download: `framework/publications/${publication.manifest.cohortId}/cohort-evaluation-aggregate.json`,
      },
    },
  });
  for (const metadata of publication.runMetadata.values()) {
    if (localRunIds.has(metadata.id)) {
      throw new Error(`Run ${metadata.id} exists in both private state and a portable publication`);
    }
    localRunIds.add(metadata.id);
    const validation = publication.parsed.get(metadata.validation.path);
    const evaluation = publication.parsed.get(metadata.evaluation.path);
    portableCatalogRuns.push({
      ...metadata,
      artifacts: metadata.artifacts.map((artifact) => ({
        ...artifact,
        path: artifact.downloadPath,
        download: `framework/publications/${publication.manifest.cohortId}/${artifact.downloadPath}`,
        downloadName: `${artifact.id}.download`,
        viewer: null,
      })),
      validation: {
        status: validation.status,
        checks: [],
        issues: validation.issueCodes.map((code) => ({ code, message: code })),
      },
      evaluation: {
        summary: evaluation,
        download: `framework/publications/${publication.manifest.cohortId}/${metadata.evaluation.path}`,
      },
      processEvidence: null,
      process: null,
      extensions: { protocolVersion: "4.0", publicationSource: "portable-publication-v1" },
    });
  }
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
      ...(manifest.schemaVersion === "3.0" || manifest.schemaVersion === "4.0" ? {
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
  cohorts: [...catalogCohorts, ...portableCatalogCohorts].sort((left, right) => left.id.localeCompare(right.id)),
  runs: [...catalogRuns, ...portableCatalogRuns].sort((left, right) => left.id.localeCompare(right.id)),
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
        (entry) => entry.handoffEligible === true && entry.validationIssues.length === 0,
      ).length,
    },
  }, null, 2)}\n`,
);
console.log(`Built framework catalog (${catalog.benchmarks.length} benchmarks, ${catalog.runs.length} runs).`);
