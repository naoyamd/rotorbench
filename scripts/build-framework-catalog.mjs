import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInside, loadFramework, pathExists } from "./framework-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const outputRoot = path.join(projectRoot, "public", "framework");
const filesRoot = path.join(outputRoot, "files");
const reportRoot = path.join(outputRoot, "reports");

await rm(filesRoot, { recursive: true, force: true });
await mkdir(filesRoot, { recursive: true });

const { benchmarks, runs } = await loadFramework(projectRoot);
const catalogRuns = [];
for (const run of runs) {
  const filesDestination = path.join(filesRoot, run.manifest.id);
  const artifacts = [];
  for (const artifact of run.manifest.artifacts ?? []) {
    const source = ensureInside(run.root, artifact.path);
    const destination = ensureInside(filesDestination, artifact.path);
    if (source && destination) {
      await mkdir(path.dirname(destination), { recursive: true });
      await cp(source, destination);
    }
    let viewer = null;
    if (artifact.role === "step") {
      const metadataPath = path.join(outputRoot, "meshes", run.manifest.id, `${artifact.id}.metadata.json`);
      if (await pathExists(metadataPath)) {
        const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
        viewer = metadata.status === "processed" ? { status: "ready", mesh: metadata.mesh, triangleCount: metadata.triangleCount } : { status: "failed", message: metadata.message };
      } else {
        viewer = { status: "failed", message: "STEP preprocessing report is unavailable" };
      }
    }
    artifacts.push({
      ...artifact,
      download: `framework/files/${run.manifest.id}/${artifact.path}`,
      viewer,
    });
  }
  const reportPath = path.join(reportRoot, `${run.manifest.id}.json`);
  const validation = (await pathExists(reportPath)) ? JSON.parse(await readFile(reportPath, "utf8")) : null;
  catalogRuns.push({ ...run.manifest, artifacts, validation });
}

const catalog = {
  schemaVersion: "1.0",
  benchmarks: benchmarks.map(({ manifest }) => manifest),
  runs: catalogRuns.sort((left, right) => left.id.localeCompare(right.id)),
};
await writeFile(path.join(outputRoot, "catalog.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Built framework catalog (${catalog.benchmarks.length} benchmarks, ${catalog.runs.length} runs).`);
