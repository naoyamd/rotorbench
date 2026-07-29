import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import {
  assertTargetOutsideProject,
  initializeCandidateWorkspace,
  preflightCandidateWorkspace,
  validatePolicy,
} from "../scripts/candidate-workspace-lib.mjs";
import { executionContractFiles, freezeLaunch } from "../scripts/stage0-lib.mjs";
import { manifestDigest, sha256 as frameworkSha256 } from "../scripts/framework-lib.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const preflightSource = path.join(projectRoot, "scripts", "candidate-workspace-preflight.mjs");
const assurance = "operator-harness-attested-not-cryptographic-proof";
const execFileAsync = promisify(execFile);
const sha256 = async (filePath) => {
  const { createHash } = await import("node:crypto");
  return createHash("sha256").update(await readFile(filePath)).digest("hex");
};

function runNode(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function fixtureWorkspace() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "edbf-candidate-workspace-"));
  const root = path.join(parent, "workspace");
  await mkdir(path.join(root, "candidate-output"), { recursive: true });
  await mkdir(path.join(root, "task", "inputs"), { recursive: true });
  await mkdir(path.join(root, "tools"), { recursive: true });
  const inputNames = [
    "requirements.json",
    ...Array.from({ length: 18 }, (_, index) => `fixture-${String(index + 1).padStart(2, "0")}.json`),
  ];
  for (const name of inputNames) {
    await writeFile(path.join(root, "task", "inputs", name), `{\"fixture\":\"${name}\"}\n`);
  }
  await writeFile(path.join(root, "isolation-policy.json"), `${JSON.stringify({
    schemaVersion: "1.0",
    kind: "candidate-workspace-isolation-policy",
    launchId: "fixture-launch",
    allowedAccess: [
      "The exact materialized launch and framework assets in this workspace.",
      "Ordinary public technical research available equally to every candidate.",
    ],
    accessPrecedence: "allow-exact-rotorbench-launch-url-over-denied-prefixes",
    allowedRotorBenchUrls: ["https://example.invalid/rotorbench/launch/fixture-launch/"],
    deniedRotorBenchPrefixes: [
      "https://example.invalid/rotorbench/",
      "https://github.com/naoyamd/rotorbench",
      "https://raw.githubusercontent.com/naoyamd/rotorbench/",
    ],
    enforcementAssurance: assurance,
    enforcementStatement: "The operator or harness must expose the exact materialized launch and framework assets plus ordinary public technical research, and must deny the listed RotorBench surfaces during the candidate session. This file records that intended boundary; it does not enforce or cryptographically prove external access control.",
  }, null, 2)}\n`);
  const policyHash = await sha256(path.join(root, "isolation-policy.json"));
  const inputRecords = await Promise.all(inputNames.map(async (name) => {
    const filePath = path.join(root, "task", "inputs", name);
    const bytes = await readFile(filePath);
    return {
      path: `task/inputs/${name}`,
      sha256: await sha256(filePath),
      sizeBytes: bytes.length,
      source: { kind: "packet", path: `task-packets/fixture-packet/1.0/inputs/${name}` },
    };
  }));
  const receipt = {
    schemaVersion: "1.0",
    kind: "candidate-workspace-receipt",
    createdAt: "2026-07-30T00:00:00.000Z",
    source: {
      launchId: "fixture-launch",
      canonicalBaseUrl: "https://example.invalid/rotorbench",
      launchDigest: "a".repeat(64),
      promptSha256: "b".repeat(64),
      executionContractDigest: "c".repeat(64),
      taskPacket: {
        id: "fixture-packet",
        version: "1.0",
        digest: "d".repeat(64),
        bundleDigest: "e".repeat(64),
      },
      workspaceBootstrap: {
        kind: "public-bundle",
        location: "https://example.invalid/rotorbench/framework/workspaces/fixture.json",
        sha256: "f".repeat(64),
      },
    },
    cleanRoot: {
      assertion: "target-did-not-exist-before-atomic-materialization",
      targetExistedBeforeMaterialization: false,
      atomicInstall: true,
      symlinksRejected: true,
    },
    isolation: {
      policyPath: "isolation-policy.json",
      policySha256: policyHash,
      enforcementAssurance: assurance,
      enforcementStatement: "This record is an operator/harness attestation of the intended access boundary. It verifies only local materialization bytes and is not cryptographic proof that an external service, browser, or network policy was enforced.",
      sourceAllowlist: [
        "launches/fixture-launch/",
        "launches/fixture-launch/execution-contract/",
        "task-packets/fixture-packet/1.0/",
        "workspace-bootstrap/fixture.json",
      ],
      prohibitedSourcePrefixes: [
        "runs/",
        "cohorts/",
        "publications/",
        "results/",
        "submissions/",
        "evaluation/private/",
      ],
    },
    materializedFiles: [
      {
        path: "isolation-policy.json",
        sha256: policyHash,
        sizeBytes: (await readFile(path.join(root, "isolation-policy.json"))).length,
        source: { kind: "generated-policy", path: "generated/isolation-policy" },
      },
      ...inputRecords,
    ],
  };
  const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
  await writeFile(path.join(root, "candidate-workspace-receipt.json"), receiptBytes);
  await writeFile(path.join(root, "candidate-output", "workspace-receipt.json"), receiptBytes);
  await writeFile(path.join(root, "tools", "candidate-workspace-preflight.mjs"), await readFile(preflightSource));
  return { parent, root };
}

async function liveLaunchFixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "edbf-live-launch-"));
  const root = path.join(parent, "project");
  const target = path.join(parent, "materialized-candidate-workspace");
  for (const name of ["benchmarks", "task-packets", "launches", "cohorts", "runs", "public", "workspace-bootstrap", "execution-profiles"]) {
    await mkdir(path.join(root, name), { recursive: true });
  }
  await cp(path.join(projectRoot, "schemas"), path.join(root, "schemas"), { recursive: true });
  await cp(path.join(projectRoot, "shared"), path.join(root, "shared"), { recursive: true });
  for (const relativePath of executionContractFiles) {
    const source = path.join(projectRoot, ...relativePath.split("/"));
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  await cp(
    path.join(projectRoot, "task-packets", "integrated-robotic-handling", "1.7"),
    path.join(root, "task-packets", "integrated-robotic-handling", "1.7"),
    { recursive: true },
  );
  await cp(
    path.join(projectRoot, "benchmarks", "integrated-robotic-handling"),
    path.join(root, "benchmarks", "integrated-robotic-handling"),
    { recursive: true },
  );
  await cp(
    path.join(projectRoot, "workspace-bootstrap", "integrated-robotic-handling-v1.json"),
    path.join(root, "workspace-bootstrap", "integrated-robotic-handling-v1.json"),
  );
  await cp(
    path.join(projectRoot, "execution-profiles", "integrated-robotic-handling-v1"),
    path.join(root, "execution-profiles", "integrated-robotic-handling-v1"),
    { recursive: true },
  );
  const baseline = path.join(parent, "baseline");
  await mkdir(baseline);
  await execFileAsync("git", ["init"], { cwd: baseline });
  await execFileAsync("git", ["config", "core.autocrlf", "false"], { cwd: baseline });
  await writeFile(path.join(baseline, "baseline.txt"), "fixture\n");
  await execFileAsync("git", ["add", "baseline.txt"], { cwd: baseline });
  await execFileAsync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"],
    { cwd: baseline },
  );
  const frozen = await freezeLaunch({
    projectRoot: root,
    launchId: "integrated-robotic-handling-v1",
    packetId: "integrated-robotic-handling",
    version: "1.7",
    profilePath: path.join(root, "execution-profiles", "integrated-robotic-handling-v1", "profile.json"),
    workspace: baseline,
    now: "2026-07-30T00:00:00.000Z",
  });
  const launchRoot = path.join(root, "launches", frozen.launch.id);
  const launchBytes = await readFile(path.join(launchRoot, "launch.json"));
  const promptBytes = await readFile(path.join(launchRoot, "prompt.txt"));
  const verification = {
    schemaVersion: "3.0",
    launchId: frozen.launch.id,
    launchDigest: frozen.launch.launchDigest,
    promptSha256: frameworkSha256(promptBytes),
    launchJsonSha256: frameworkSha256(launchBytes),
    pageSha256: "9".repeat(64),
    canonicalBaseUrl: frozen.launch.canonicalBaseUrl,
    canonicalOrigin: "https://naoyamd.github.io",
    basePath: "/rotorbench",
    launchUrl: "https://naoyamd.github.io/rotorbench/launch/integrated-robotic-handling-v1/",
    launchJsonUrl: "https://naoyamd.github.io/rotorbench/framework/launches/integrated-robotic-handling-v1/launch.json",
    promptUrl: "https://naoyamd.github.io/rotorbench/framework/launches/integrated-robotic-handling-v1/prompt.txt",
    checks: {
      redirectFree: true,
      sameOrigin: true,
      basePathMatched: true,
      launchJsonExact: true,
      promptExact: true,
      pageMarkerMatched: true,
    },
    status: "verified",
    verifiedAt: "2026-07-30T00:01:00.000Z",
  };
  const release = JSON.parse(await readFile(path.join(launchRoot, "release.json"), "utf8"));
  const approvalAttestation = {
    expectedLaunchDigest: frozen.launch.launchDigest,
    engineeringReviewDigest: "1".repeat(64),
    protocolReviewDigest: "2".repeat(64),
    statement: `APPROVE RELEASE ${frozen.launch.launchDigest}`,
    attestedAt: "2026-07-30T00:00:30.000Z",
  };
  Object.assign(release, {
    status: "live-verified",
    engineeringReviewDigest: approvalAttestation.engineeringReviewDigest,
    protocolReviewDigest: approvalAttestation.protocolReviewDigest,
    approvalAttestation,
    approvalAttestationDigest: manifestDigest(approvalAttestation),
    liveVerificationDigest: manifestDigest(verification),
    updatedAt: "2026-07-30T00:01:00.000Z",
  });
  await writeJson(path.join(launchRoot, "release.json"), release);
  await writeJson(path.join(launchRoot, "live-verification.json"), verification);
  return { parent, root, target };
}

test("the copied preflight is standalone, verifies twin receipts, and detects a materialized-byte tamper", async () => {
  const fixture = await fixtureWorkspace();
  try {
    const initial = await runNode([
      "tools/candidate-workspace-preflight.mjs",
      "--root",
      fixture.root,
    ], fixture.root);
    assert.equal(initial.code, 0, initial.stderr);
    const result = JSON.parse(initial.stdout);
    assert.equal(result.status, "valid");
    assert.equal(result.enforcementAssurance, assurance);
    assert.match(result.externalAccessAssertion, /not-verified/);

    await writeFile(path.join(fixture.root, "task", "inputs", "requirements.json"), "tampered\n");
    const tampered = await runNode([
      "tools/candidate-workspace-preflight.mjs",
      "--root",
      fixture.root,
    ], fixture.root);
    assert.equal(tampered.code, 1);
    assert.match(tampered.stdout, /materialized file hash or size differs/);

    const local = await preflightCandidateWorkspace(fixture.root);
    assert.equal(local.status, "invalid");
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("the fixed policy allows only the exact launch URL and rejects broad RotorBench access", () => {
  const policy = {
    schemaVersion: "1.0",
    kind: "candidate-workspace-isolation-policy",
    launchId: "fixture-launch",
    allowedAccess: ["materialized assets", "ordinary public technical research"],
    accessPrecedence: "allow-exact-rotorbench-launch-url-over-denied-prefixes",
    allowedRotorBenchUrls: ["https://example.invalid/rotorbench/launch/fixture-launch/"],
    deniedRotorBenchPrefixes: [
      "https://example.invalid/rotorbench/",
      "https://github.com/naoyamd/rotorbench",
      "https://raw.githubusercontent.com/naoyamd/rotorbench/",
    ],
    enforcementAssurance: assurance,
    enforcementStatement: "The operator or harness must expose the exact materialized launch and framework assets plus ordinary public technical research, and must deny the listed RotorBench surfaces during the candidate session. This file records that intended boundary; it does not enforce or cryptographically prove external access control.",
  };
  assert.deepEqual(validatePolicy(policy, "fixture-launch", "https://example.invalid/rotorbench"), []);
  policy.allowedRotorBenchUrls = ["https://example.invalid/rotorbench/model-task/"];
  assert.match(
    validatePolicy(policy, "fixture-launch", "https://example.invalid/rotorbench").join("\n"),
    /exact-launch policy/,
  );
});

test("initializer atomically materializes only launch-bound public bytes and returns the common receipt hash", async () => {
  const fixture = await liveLaunchFixture();
  try {
    const initialized = await initializeCandidateWorkspace({
      projectRoot: fixture.root,
      launchId: "integrated-robotic-handling-v1",
      targetRoot: fixture.target,
      createdAt: "2026-07-30T00:02:00.000Z",
    });
    assert.equal(initialized.taskInputCount, 19);
    assert.equal(initialized.enforcementAssurance, assurance);
    const rootReceipt = await readFile(path.join(fixture.target, "candidate-workspace-receipt.json"));
    const outputReceipt = await readFile(path.join(fixture.target, "candidate-output", "workspace-receipt.json"));
    assert.ok(rootReceipt.equals(outputReceipt));
    assert.equal(initialized.receiptSha256, frameworkSha256(rootReceipt));
    const receipt = JSON.parse(rootReceipt.toString("utf8"));
    assert.equal(receipt.materializedFiles.filter(({ path: filePath }) => filePath.startsWith("task/inputs/")).length, 19);
    assert.ok(receipt.materializedFiles.every(({ source }) => !["runs/", "cohorts/", "publications/", "results/"].some((prefix) => source.path.startsWith(prefix))));
    assert.ok(!receipt.materializedFiles.some(({ path: filePath }) => filePath.includes("workspace-receipt.json") || filePath === "candidate-workspace-receipt.json"));

    const first = await runNode(["tools/candidate-workspace-preflight.mjs", "--root", fixture.target], fixture.target);
    assert.equal(first.code, 0, first.stderr);
    const beforePlan = await runNode(["tools/candidate-workspace-preflight.mjs", "--root", fixture.target, "--require-plan"], fixture.target);
    assert.equal(beforePlan.code, 1);
    await cp(
      path.join(fixture.target, "candidate-output", "templates", "plan.template.json"),
      path.join(fixture.target, "candidate-output", "plan.json"),
    );
    const withPlan = await runNode(["tools/candidate-workspace-preflight.mjs", "--root", fixture.target, "--require-plan"], fixture.target);
    assert.equal(withPlan.code, 0, withPlan.stderr);

    const existing = path.join(fixture.parent, "existing-target");
    await mkdir(existing);
    await writeFile(path.join(existing, "keep.txt"), "keep\n");
    await assert.rejects(
      () => initializeCandidateWorkspace({
        projectRoot: fixture.root,
        launchId: "integrated-robotic-handling-v1",
        targetRoot: existing,
        createdAt: "2026-07-30T00:03:00.000Z",
      }),
      /never overwrites/,
    );
    assert.equal(await readFile(path.join(existing, "keep.txt"), "utf8"), "keep\n");
  } finally {
    await rm(fixture.parent, { recursive: true, force: true });
  }
});

test("initializer rejects an in-project target before claiming isolation and uses atomic no-overwrite primitives", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "edbf-candidate-target-"));
  try {
    assert.throws(
      () => assertTargetOutsideProject(root, path.join(root, "candidate-workspace")),
      /outside the RotorBench project root/,
    );
    assert.doesNotThrow(
      () => assertTargetOutsideProject(root, path.join(path.dirname(root), "sibling-workspace")),
    );
    const source = await readFile(path.join(projectRoot, "scripts", "candidate-workspace-lib.mjs"), "utf8");
    assert.match(source, /writeFile\(target, record\.bytes, \{ flag: "wx" \}\)/);
    assert.match(source, /await rename\(staging, target\)/);
    assert.match(source, /Target directory already exists; initialization never overwrites/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
