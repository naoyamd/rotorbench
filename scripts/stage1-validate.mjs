import path from "node:path";
import { validateCandidateBundle } from "./stage-contract.mjs";

const rootIndex = process.argv.indexOf("--root");
const root = rootIndex >= 0
  ? path.resolve(process.argv[rootIndex + 1])
  : path.resolve("candidate-output");
const result = await validateCandidateBundle(root);
if (result.status === "valid") {
  console.log("Stage 1 candidate bundle validation passed.");
} else {
  for (const issue of result.issues) console.error(issue);
  process.exitCode = 1;
}
