import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sha256, validatePlan } from "./framework-lib.mjs";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve("candidate-output");
const planPath = path.join(root, "plan.json");
const planData = await readFile(planPath);
const plan = JSON.parse(planData.toString("utf8"));
const issues = validatePlan(plan);
if (issues.length > 0) {
  for (const issue of issues) console.error(issue.message);
  process.exitCode = 1;
} else {
  const digest = sha256(planData);
  await writeFile(path.join(root, "initial-plan.sha256"), `${digest}  plan.json\n`, { flag: "wx" });
  console.log(digest);
}
