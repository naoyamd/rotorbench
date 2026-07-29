import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateFramework } from "./framework-lib.mjs";
import { loadPublicCohortPublications } from "./publication-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const reportRoot = path.join(projectRoot, "public", "framework");
const result = await validateFramework(projectRoot);
let publications = [];
const publicationIssues = [];
try {
  publications = await loadPublicCohortPublications(projectRoot);
  const cohortIds = new Set(result.cohorts.filter((entry) => entry.manifest).map(({ manifest }) => manifest.id));
  const runIds = new Set(result.runs.filter((entry) => entry.manifest).map(({ manifest }) => manifest.id));
  for (const publication of publications) {
    if (cohortIds.has(publication.manifest.cohortId)) {
      publicationIssues.push({ scope: `publications/${publication.manifest.cohortId}`, code: "duplicate-cohort-source", message: "cohort exists in both private state and a public publication" });
    }
    for (const runId of publication.runMetadata.keys()) {
      if (runIds.has(runId)) publicationIssues.push({ scope: `publications/${publication.manifest.cohortId}`, code: "duplicate-run-source", message: `run ${runId} exists in both private state and a public publication` });
      runIds.add(runId);
    }
  }
} catch (error) {
  publicationIssues.push({ scope: "publications", code: "invalid-publication", message: error instanceof Error ? error.message : "publication validation failed" });
}
result.issues.push(...publicationIssues);
const report = {
  schemaVersion: "1.0",
  status: result.issues.length === 0 ? "valid" : "invalid",
  generatedAt: new Date().toISOString(),
  benchmarks: result.benchmarks.length,
  taskPackets: result.taskPackets.length,
  launches: result.launches.length,
  cohorts: result.cohorts.length,
  runs: result.runs.length,
  publications: publications.length,
  issues: result.issues,
};

await mkdir(reportRoot, { recursive: true });
await writeFile(path.join(reportRoot, "validation-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
if (result.issues.length > 0) {
  for (const entry of result.issues) console.error(`${entry.scope}: ${entry.code}: ${entry.message}`);
  process.exitCode = 1;
} else {
  console.log(`Framework validation passed (${result.benchmarks.length} benchmarks, ${result.taskPackets.length} task packets, ${result.launches.length} launches, ${result.cohorts.length} cohorts, ${result.runs.length} private runs, ${publications.length} public publications).`);
}
