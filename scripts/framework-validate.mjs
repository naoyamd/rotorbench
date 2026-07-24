import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { validateFramework } from "./framework-lib.mjs";

const rootArgument = process.argv.indexOf("--root");
const projectRoot = rootArgument >= 0 ? path.resolve(process.argv[rootArgument + 1]) : process.cwd();
const reportRoot = path.join(projectRoot, "public", "framework");
const result = await validateFramework(projectRoot);
const report = {
  schemaVersion: "1.0",
  status: result.issues.length === 0 ? "valid" : "invalid",
  generatedAt: new Date().toISOString(),
  benchmarks: result.benchmarks.length,
  taskPackets: result.taskPackets.length,
  launches: result.launches.length,
  cohorts: result.cohorts.length,
  runs: result.runs.length,
  issues: result.issues,
};

await mkdir(reportRoot, { recursive: true });
await writeFile(path.join(reportRoot, "validation-summary.json"), `${JSON.stringify(report, null, 2)}\n`);
if (result.issues.length > 0) {
  for (const entry of result.issues) console.error(`${entry.scope}: ${entry.code}: ${entry.message}`);
  process.exitCode = 1;
} else {
  console.log(`Framework validation passed (${result.benchmarks.length} benchmarks, ${result.taskPackets.length} task packets, ${result.launches.length} launches, ${result.cohorts.length} cohorts, ${result.runs.length} runs).`);
}
