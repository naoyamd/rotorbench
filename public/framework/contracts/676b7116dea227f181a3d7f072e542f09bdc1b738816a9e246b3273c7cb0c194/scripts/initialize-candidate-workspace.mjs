import "./official-execution-guard.mjs";
import path from "node:path";
import { initializeCandidateWorkspace } from "./candidate-workspace-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

const result = await initializeCandidateWorkspace({
  projectRoot: path.resolve(argument("--project-root", { required: false }) || process.cwd()),
  launchId: argument("--launch-id", { required: true }),
  targetRoot: path.resolve(argument("--target", { required: true })),
  ...(argument("--created-at", { required: false })
    ? { createdAt: argument("--created-at", { required: false }) }
    : {}),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
