import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  approveLaunch,
  freezeLaunch,
  freezePacket,
  issueText,
  lintTaskDefinition,
  markLiveVerified,
  markReleaseReady,
  validateFrozenPacket,
  validateLaunchFreeze,
  validateReviews,
  verifyGitWorkspace,
} from "./stage0-lib.mjs";

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function identity(name, value) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)) {
    throw new Error(`${name} must use lowercase kebab-case`);
  }
  return value;
}

const command = process.argv[2];
const rootValue = argument("--root", { required: false });
const projectRoot = rootValue ? path.resolve(rootValue) : process.cwd();

switch (command) {
  case "lint": {
    const source = path.resolve(argument("--source"));
    const result = await lintTaskDefinition(source);
    if (result.status !== "valid") {
      throw new Error(`Stage 0 lint failed:\n${issueText(result.issues)}`);
    }
    console.log(`Stage 0 lint passed for ${result.task.id}@${result.task.version}.`);
    break;
  }
  case "freeze-packet": {
    const source = path.resolve(argument("--source"));
    const packetId = identity("packet ID", argument("--packet-id"));
    const version = argument("--version");
    const result = await freezePacket({
      projectRoot,
      sourceRoot: source,
      packetId,
      version,
    });
    console.log(
      `Frozen packet ${packetId}@${version} (${result.lock.packetDigest}, bundle ${result.lock.bundleDigest}).`,
    );
    break;
  }
  case "verify-workspace": {
    const workspace = path.resolve(argument("--workspace"));
    const attestation = await verifyGitWorkspace(workspace);
    const output = argument("--output", { required: false });
    if (output) {
      await writeFile(
        path.resolve(output),
        `${JSON.stringify(attestation, null, 2)}\n`,
        { flag: "wx" },
      );
    } else {
      process.stdout.write(`${JSON.stringify(attestation, null, 2)}\n`);
    }
    break;
  }
  case "freeze-launch": {
    const launchId = identity("launch ID", argument("--launch-id"));
    const packetId = identity("packet ID", argument("--packet-id"));
    const result = await freezeLaunch({
      projectRoot,
      launchId,
      packetId,
      version: argument("--version"),
      profilePath: path.resolve(argument("--profile")),
      workspace: path.resolve(argument("--workspace")),
    });
    console.log(
      `Frozen Stage 1 v3 launch ${launchId} (${result.launch.launchDigest}, prompt ${result.launch.promptSha256}).`,
    );
    break;
  }
  case "check-packet": {
    const packetId = identity("packet ID", argument("--packet-id"));
    const version = argument("--version");
    const result = await validateFrozenPacket(
      path.join(projectRoot, "task-packets", packetId, version),
    );
    if (result.status !== "valid") {
      throw new Error(`Frozen packet check failed:\n${issueText(result.issues)}`);
    }
    console.log(`Frozen packet ${packetId}@${version} is valid and immutable.`);
    break;
  }
  case "check-launch": {
    const launchId = identity("launch ID", argument("--launch-id"));
    const result = await validateLaunchFreeze(projectRoot, launchId);
    if (result.status !== "valid") {
      throw new Error(`Frozen launch check failed:\n${issueText(result.issues)}`);
    }
    console.log(`Frozen launch ${launchId} is valid and immutable.`);
    break;
  }
  case "review": {
    const launchId = identity("launch ID", argument("--launch-id"));
    const result = await validateReviews(projectRoot, launchId);
    if (result.status !== "valid") {
      throw new Error(`Stage 0 review validation failed:\n${issueText(result.issues)}`);
    }
    console.log(`Independent engineering and protocol reviews passed for ${launchId}.`);
    break;
  }
  case "approve": {
    const launchId = identity("launch ID", argument("--launch-id"));
    await approveLaunch(
      projectRoot,
      launchId,
      argument("--expected-launch-digest"),
      argument("--approval"),
    );
    console.log(`Approved launch ${launchId}.`);
    break;
  }
  case "preview": {
    const launchId = identity("launch ID", argument("--launch-id"));
    const result = await validateReviews(projectRoot, launchId);
    if (result.status !== "valid" || result.release.status !== "approved") {
      throw new Error(`Preview validation failed:\n${issueText(result.issues)}`);
    }
    console.log(`Preview validation passed for ${launchId}; no state was changed.`);
    break;
  }
  case "release-ready": {
    const launchId = identity("launch ID", argument("--launch-id"));
    await markReleaseReady(
      projectRoot,
      launchId,
      argument("--expected-launch-digest"),
      argument("--approval"),
    );
    console.log(`Launch ${launchId} is release-ready.`);
    break;
  }
  case "live-verify": {
    const launchId = identity("launch ID", argument("--launch-id"));
    await markLiveVerified({
      projectRoot,
      launchId,
      launchUrl: argument("--launch-url"),
      launchJsonUrl: argument("--launch-json-url"),
      promptUrl: argument("--prompt-url"),
    });
    console.log(`Launch ${launchId} is live-verified.`);
    break;
  }
  default:
    throw new Error(
      "Use stage0 lint, freeze-packet, verify-workspace, freeze-launch, check-packet, check-launch, review, approve, preview, release-ready, or live-verify",
    );
}
