import { issueText, validateLaunchFreeze } from "./stage0-lib.mjs";

const idIndex = process.argv.indexOf("--launch-id");
const launchId = idIndex >= 0 ? process.argv[idIndex + 1] : "";
if (!launchId) {
  throw new Error(
    "Legacy finalize is check-only. Pass --launch-id, or use `pnpm stage0 -- freeze-launch` to create a new immutable Stage 1 v3 launch.",
  );
}
const result = await validateLaunchFreeze(process.cwd(), launchId);
if (result.status !== "valid") {
  throw new Error(`Frozen launch check failed:\n${issueText(result.issues)}`);
}
console.log(`Launch ${launchId} is already frozen and valid; no files changed.`);
