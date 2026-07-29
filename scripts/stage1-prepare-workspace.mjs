import { realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateFramework } from "./framework-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

const projectRoot = path.resolve(argument("--project-root") || process.cwd());
const launchId = argument("--launch-id", { required: true });
const framework = await validateFramework(projectRoot);
const launch = framework.launches.find((entry) => entry.manifest?.id === launchId);
if (!launch?.handoffEligible || launch.validationIssues.length > 0) {
  throw new Error(
    "Candidate workspace initialization requires a valid post-activation Stage B verification",
  );
}
const contractRoot = path.join(launch.root, "execution-contract");
const candidateWorkspaceLibrary = path.join(
  contractRoot,
  "scripts",
  "candidate-workspace-lib.mjs",
);
const [resolvedContractRoot, resolvedLibrary] = await Promise.all([
  realpath(contractRoot),
  realpath(candidateWorkspaceLibrary),
]);
if (!resolvedLibrary.startsWith(`${resolvedContractRoot}${path.sep}`)) {
  throw new Error("Launch-frozen candidate workspace runtime escapes its execution contract");
}
const { initializeCandidateWorkspace } = await import(pathToFileURL(resolvedLibrary).href);
const result = await initializeCandidateWorkspace({
  projectRoot,
  launchId,
  targetRoot: path.resolve(argument("--target", { required: true })),
  ...(argument("--created-at") ? { createdAt: argument("--created-at") } : {}),
});
process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
