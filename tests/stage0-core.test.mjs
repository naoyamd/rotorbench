import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  computeFairnessFingerprint,
  manifestDigest,
  sha256,
  validateFramework,
  validateRequiredOutputBindings,
  validateSubmission,
} from "../scripts/framework-lib.mjs";
import { validateCandidateBundle } from "../scripts/stage-contract.mjs";
import {
  approveLaunch,
  activateLive,
  auditLive,
  computeExecutionContractDigest,
  executionContractFiles,
  freezeLaunch,
  freezePacket,
  lintTaskDefinition,
  markLiveVerified,
  markReleaseReady,
  validateCanonicalLiveUrls,
  validateFrozenPacket,
  validateLaunchFreeze,
  verifyGitWorkspace,
} from "../scripts/stage0-lib.mjs";
import { loadFrozenEngineeringEvaluator } from "./helpers/evaluate-engineering-submission-frozen-loader.mjs";
import { buildLaunchPrompt } from "../shared/prompts.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

async function createProject() {
  const root = await mkdtemp(path.join(tmpdir(), "stage0-core-"));
  for (const name of [
    "benchmarks",
    "task-packets",
    "launches",
    "cohorts",
    "runs",
    "public",
  ]) {
    await mkdir(path.join(root, name), { recursive: true });
  }
  await cp(path.join(repositoryRoot, "schemas"), path.join(root, "schemas"), {
    recursive: true,
  });
  await cp(path.join(repositoryRoot, "shared"), path.join(root, "shared"), {
    recursive: true,
  });
  for (const relativePath of executionContractFiles) {
    const source = path.join(repositoryRoot, ...relativePath.split("/"));
    const destination = path.join(root, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    await cp(source, destination);
  }
  return root;
}

function taskDefinition(version, title = "Neutral protocol fixture") {
  return {
    schemaVersion: "3.0",
    id: "neutral-benchmark",
    version,
    title,
    author: { id: "author-a", name: "Author A" },
    instructions: {
      path: "TASK.md",
      mediaType: "text/markdown",
      downloadName: "TASK.md",
    },
    inputs: [{
      id: "neutral-input",
      path: "input.txt",
      mediaType: "text/plain",
      provenance: "Synthetic protocol fixture",
      license: "CC0-1.0",
      downloadName: "neutral-input.txt",
    }],
    requiredOutputs: [{
      id: "OUT-001",
      role: "supporting",
      description: "A synthetic protocol evidence file",
    }],
    completionCriteria: [{
      id: "CRIT-001",
      statement: "The evidence file is present and hash-addressed.",
      requiredOutputRefs: ["OUT-001"],
      evidenceRoles: ["supporting"],
    }],
    environment: {
      baseline: "Synthetic clean Git workspace",
      cad: "Not used by this protocol fixture",
      stepPipeline: "common-occt-import-js",
    },
    engineeringValues: [],
    extensions: {},
  };
}

async function writeTaskSource(root, version, title) {
  const source = path.join(root, `source-${version}`);
  await mkdir(source, { recursive: true });
  await writeJson(path.join(source, "task.json"), taskDefinition(version, title));
  await writeFile(path.join(source, "TASK.md"), "# Synthetic task\n\nProduce protocol evidence only.\n");
  await writeFile(path.join(source, "input.txt"), `neutral input ${version}\n`);
  return source;
}

async function createCleanWorkspace(root) {
  const workspace = path.join(root, "workspace");
  await mkdir(workspace);
  await execFileAsync("git", ["init"], { cwd: workspace });
  await execFileAsync("git", ["config", "core.autocrlf", "false"], { cwd: workspace });
  await writeFile(path.join(workspace, "baseline.txt"), "neutral baseline\n");
  await execFileAsync("git", ["add", "baseline.txt"], { cwd: workspace });
  await execFileAsync(
    "git",
    ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "fixture"],
    { cwd: workspace },
  );
  return workspace;
}

async function writeV3Candidate(root, launch) {
  const output = path.join(root, "candidate-output");
  const plan = {
    schemaVersion: "1.0",
    status: "initial",
    requirements: [{
      id: "REQ-001",
      source: "fixture",
      statement: "Produce protocol evidence",
    }],
    assumptions: [],
    steps: [{
      id: "STEP-001",
      statement: "Create the evidence file",
      requirementRefs: ["REQ-001"],
    }],
    alternativesToEvaluate: [{
      id: "ALT-001",
      question: "Which evidence encoding is inspectable?",
      requirementRefs: ["REQ-001"],
    }],
    verificationPlan: [{
      id: "VER-001",
      requirementRefs: ["REQ-001"],
      method: "Hash comparison",
      expectedEvidence: "Matching SHA-256",
    }],
  };
  const workRecord = {
    schemaVersion: "1.0",
    alternatives: [{
      id: "ALT-001",
      description: "Plain text evidence",
      disposition: "selected",
    }],
    decisions: [{
      id: "DEC-001",
      requirementRefs: ["REQ-001"],
      alternativeRefs: ["ALT-001"],
      choice: "plain text",
      rationale: "Inspectable",
      tradeoffs: "Fixture only",
    }],
    planRevisions: [],
    verificationClaims: [{
      id: "CLAIM-001",
      requirementRefs: ["REQ-001"],
      method: "Hash comparison",
      result: "pass",
      evidenceArtifactRefs: ["protocol-evidence"],
    }],
  };
  const planText = `${JSON.stringify(plan, null, 2)}\n`;
  const recordText = `${JSON.stringify(workRecord, null, 2)}\n`;
  const checkpointText = `${sha256(Buffer.from(planText))}  plan.json\n`;
  const evidence = Buffer.from("protocol evidence\n");
  await mkdir(path.join(output, "artifacts"), { recursive: true });
  await Promise.all([
    writeFile(path.join(output, "plan.json"), planText),
    writeFile(path.join(output, "initial-plan.sha256"), checkpointText),
    writeFile(path.join(output, "work-record.json"), recordText),
    writeFile(path.join(output, "artifacts", "evidence.txt"), evidence),
  ]);
  await writeJson(path.join(output, "submission.json"), {
    schemaVersion: "1.0",
    protocolVersion: "3.0",
    status: "complete",
    launchId: launch.id,
    taskPacket: {
      id: launch.taskPacket.id,
      version: launch.taskPacket.version,
      digest: launch.taskPacket.digest,
      bundleDigest: launch.taskPacket.bundleDigest,
    },
    executionContractDigest: launch.executionContractDigest,
    promptSha256: launch.promptSha256,
    launchDigest: launch.launchDigest,
    fairnessFingerprint: launch.fairnessFingerprint,
    model: { provider: "unknown", name: "unknown", version: "unknown" },
    initialPlan: { path: "plan.json", sha256: sha256(Buffer.from(planText)) },
    initialPlanCheckpoint: {
      path: "initial-plan.sha256",
      sha256: sha256(Buffer.from(checkpointText)),
    },
    workRecord: {
      path: "work-record.json",
      sha256: sha256(Buffer.from(recordText)),
    },
    artifacts: [{
      id: "protocol-evidence",
      role: "supporting",
      path: "artifacts/evidence.txt",
      sha256: sha256(evidence),
      status: "present",
      requiredOutputRefs: ["OUT-001"],
    }],
  });
  return output;
}

test("Stage 0 v3 freezes immutable versions and gates public release", async () => {
  const root = await createProject();
  try {
    await writeJson(
      path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"),
      {
        schemaVersion: "1.0",
        id: "neutral-benchmark",
        title: "Neutral fixture",
        status: "active",
        version: "1.0",
        extensions: {},
      },
    );
    const sourceOne = await writeTaskSource(root, "1.0", "Neutral protocol fixture");
    const sourceTwo = await writeTaskSource(root, "2.0", "Neutral protocol fixture revision");
    const first = await freezePacket({
      projectRoot: root,
      sourceRoot: sourceOne,
      packetId: "neutral-benchmark",
      version: "1.0",
      now: "2026-01-01T00:00:00Z",
    });
    const second = await freezePacket({
      projectRoot: root,
      sourceRoot: sourceTwo,
      packetId: "neutral-benchmark",
      version: "2.0",
      now: "2026-01-01T00:00:00Z",
    });
    assert.notEqual(first.lock.bundleDigest, second.lock.bundleDigest);
    await assert.rejects(() => freezePacket({
      projectRoot: root,
      sourceRoot: sourceOne,
      packetId: "neutral-benchmark",
      version: "1.0",
    }), /Destination already exists/);

    await writeFile(
      path.join(first.root, "input.txt"),
      "tampered\n",
    );
    assert.equal((await validateFrozenPacket(first.root)).status, "invalid");
    await writeFile(path.join(first.root, "input.txt"), "neutral input 1.0\n");
    assert.equal((await validateFrozenPacket(first.root)).status, "valid");

    const profilePath = path.join(root, "profile.json");
    await writeJson(profilePath, {
      schemaVersion: "3.0",
      id: "neutral-profile",
      version: "1.0",
      canonicalBaseUrl: "https://example.invalid/base",
      outputRoot: "candidate-output",
      startAction: "checkpoint-initial-plan",
      stopConditions: ["Stop only for a missing or mismatched declared input."],
      extensions: {},
    });
    const workspace = await createCleanWorkspace(root);
    const attestation = await verifyGitWorkspace(workspace, "2026-01-01T00:00:00Z");
    assert.equal(attestation.algorithm, "sha256-git-worktree-v1");
    await writeFile(path.join(workspace, "dirty.txt"), "dirty\n");
    await assert.rejects(() => verifyGitWorkspace(workspace), /dirty/);
    await rm(path.join(workspace, "dirty.txt"));

    const launch = await freezeLaunch({
      projectRoot: root,
      launchId: "neutral-launch",
      packetId: "neutral-benchmark",
      version: "1.0",
      profilePath,
      workspace,
      now: "2026-01-01T00:00:00Z",
    });
    assert.equal(launch.launch.canonicalBaseUrl, "https://example.invalid/base");
    assert.equal(launch.release.canonicalBaseUrl, "https://example.invalid/base");
    assert.match(
      launch.prompt,
      /https:\/\/example\.invalid\/base\/framework\/task-packets\/neutral-benchmark\/1\.0\/input\.txt/,
    );
    assert.match(
      launch.prompt,
      new RegExp(`https://example\\.invalid/base/framework/contracts/${launch.launch.executionContractDigest}/schemas/plan\\.schema\\.json`),
    );
    assert.match(launch.prompt, /requiredOutputRefs/);
    assert.deepEqual(validateSubmission(JSON.parse(await readFile(
      path.join(repositoryRoot, "candidate-output", "_template", "submission.json"),
      "utf8",
    ))), []);
    await freezeLaunch({
      projectRoot: root,
      launchId: "unapproved-launch",
      packetId: "neutral-benchmark",
      version: "2.0",
      profilePath,
      workspace,
      now: "2026-01-01T00:00:00Z",
    });
    const packetRoot = path.join(root, "task-packets", "neutral-benchmark", "1.0");
    await writeJson(path.join(packetRoot, "engineering-review.json"), {
      schemaVersion: "3.0",
      kind: "engineering",
      reviewer: { id: "reviewer-engineering", name: "Engineering Reviewer" },
      authorId: "author-a",
      packetDigest: launch.launch.taskPacket.digest,
      bundleDigest: launch.launch.taskPacket.bundleDigest,
      status: "approved",
      blockingIssues: [],
      reviewedAt: "2026-01-01T00:00:00Z",
    });
    await writeJson(path.join(launch.root, "protocol-review.json"), {
      schemaVersion: "3.0",
      kind: "protocol",
      reviewer: { id: "reviewer-protocol", name: "Protocol Reviewer" },
      authorId: "author-a",
      launchDigest: launch.launch.launchDigest,
      executionContractDigest: launch.launch.executionContractDigest,
      promptSha256: launch.launch.promptSha256,
      status: "approved",
      blockingIssues: [],
      reviewedAt: "2026-01-01T00:00:00Z",
    });
    await writeJson(path.join(launch.root, "release-transition.json"), {
      schemaVersion: "1.0",
      status: "corrupt",
    });
    assert.ok((await validateLaunchFreeze(root, "neutral-launch")).issues.some(
      ({ code }) => code === "release-transition-invalid",
    ));
    await rm(path.join(launch.root, "release-transition.json"));
    const approval = `APPROVE RELEASE ${launch.launch.launchDigest}`;
    await assert.rejects(
      () => approveLaunch(
        root,
        "neutral-launch",
        "0".repeat(64),
        approval,
      ),
      /Expected launch digest/,
    );
    await assert.rejects(
      () => approveLaunch(
        root,
        "neutral-launch",
        launch.launch.launchDigest,
        "APPROVE RELEASE wrong",
      ),
      /Explicit approval/,
    );
    const concurrentApprovals = await Promise.allSettled([
      approveLaunch(
        root,
        "neutral-launch",
        launch.launch.launchDigest,
        approval,
        "2026-01-02T00:00:00Z",
      ),
      approveLaunch(
        root,
        "neutral-launch",
        launch.launch.launchDigest,
        approval,
        "2026-01-02T00:00:00Z",
      ),
    ]);
    const concurrentApprovalSummary = concurrentApprovals.map((outcome) => (
      outcome.status === "fulfilled"
        ? "fulfilled"
        : `rejected: ${outcome.reason instanceof Error
          ? outcome.reason.message
          : String(outcome.reason)}`
    )).join("; ");
    assert.equal(
      concurrentApprovals.filter(({ status }) => status === "fulfilled").length,
      1,
      concurrentApprovalSummary,
    );
    assert.equal(
      concurrentApprovals.filter(({ status }) => status === "rejected").length,
      1,
      concurrentApprovalSummary,
    );
    const approvedRelease = concurrentApprovals.find(
      ({ status }) => status === "fulfilled",
    ).value;
    const engineeringReviewPath = path.join(packetRoot, "engineering-review.json");
    const originalEngineeringReview = JSON.parse(
      await readFile(engineeringReviewPath, "utf8"),
    );
    const swappedEngineeringReview = {
      ...originalEngineeringReview,
      reviewedAt: "2026-01-02T12:00:00Z",
    };
    const releasePath = path.join(launch.root, "release.json");
    await writeJson(engineeringReviewPath, swappedEngineeringReview);
    await writeJson(releasePath, {
      ...approvedRelease,
      engineeringReviewDigest: manifestDigest(swappedEngineeringReview),
    });
    await assert.rejects(
      () => markReleaseReady(
        root,
        "neutral-launch",
        launch.launch.launchDigest,
        approval,
      ),
      /approval|review|invalid/i,
    );
    await writeJson(engineeringReviewPath, originalEngineeringReview);
    await writeJson(releasePath, approvedRelease);
    await assert.rejects(
      () => markReleaseReady(
        root,
        "neutral-launch",
        launch.launch.launchDigest,
        "APPROVE RELEASE wrong",
      ),
      /Explicit approval/,
    );
    await markReleaseReady(
      root,
      "neutral-launch",
      launch.launch.launchDigest,
      approval,
      "2026-01-03T00:00:00Z",
    );
    const heldCohortRoot = path.join(root, "cohorts", "held-cohort");
    await writeJson(path.join(heldCohortRoot, "cohort.json"), {
      schemaVersion: "1.0",
      id: "held-cohort",
      openedAt: "2026-07-29T00:00:00Z",
      launchId: "neutral-launch",
      fairnessFingerprint: launch.launch.fairnessFingerprint,
      status: "open",
      candidateIds: ["candidate-held"],
      extensions: {},
    });
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "cohort-launch-not-live-verified",
    ));
    await rm(heldCohortRoot, { recursive: true, force: true });
    await execFileAsync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: repositoryRoot },
    );
    const releaseReadyCatalog = JSON.parse(
      await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"),
    );
    assert.equal(releaseReadyCatalog.launches[0].releaseStatus, "release-ready");
    assert.equal(releaseReadyCatalog.launches[0].promptText, undefined);
    assert.equal(releaseReadyCatalog.launches[0].promptDownload, undefined);
    await readFile(path.join(
      root,
      "public",
      "framework",
      "launches",
      "neutral-launch",
      "prompt.txt",
    ));
    await assert.rejects(
      readFile(path.join(
        root,
        "public",
        "framework",
        "contracts",
        launch.launch.executionContractDigest,
        "contract.json",
      )),
    );

    const liveUrls = {
      launchId: "neutral-launch",
      launchUrl: "https://example.invalid/base/launch/neutral-launch/",
      launchJsonUrl:
        "https://example.invalid/base/framework/launches/neutral-launch/launch.json",
      promptUrl:
        "https://example.invalid/base/framework/launches/neutral-launch/prompt.txt",
    };
    assert.equal(validateCanonicalLiveUrls({
      ...liveUrls,
      canonicalBaseUrl: launch.launch.canonicalBaseUrl,
    }).basePath, "/base");
    assert.throws(
      () => validateCanonicalLiveUrls({
        ...liveUrls,
        canonicalBaseUrl: "https://example.invalid/other",
      }),
      /canonicalBaseUrl/,
    );
    assert.throws(
      () => validateCanonicalLiveUrls({
        ...liveUrls,
        promptUrl:
          "https://other.invalid/base/framework/launches/neutral-launch/prompt.txt",
      }),
      /same HTTPS origin/,
    );
    assert.throws(
      () => validateCanonicalLiveUrls({
        ...liveUrls,
        promptUrl:
          "https://example.invalid/wrong/framework/launches/neutral-launch/prompt.txt",
      }),
      /canonical base path/,
    );

    const localLaunchBytes = await readFile(path.join(launch.root, "launch.json"));
    const localPromptBytes = await readFile(path.join(launch.root, "prompt.txt"));
    const pageBytes = Buffer.from(
      `<section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section>`,
    );
    const response = (url, bytes, status = 200) => ({
      status,
      url,
      arrayBuffer: async () =>
        bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    });
    const successfulFetch = async (url) => {
      if (url === liveUrls.launchUrl) return response(url, pageBytes);
      if (url === liveUrls.launchJsonUrl) return response(url, localLaunchBytes);
      if (url === liveUrls.promptUrl) return response(url, localPromptBytes);
      throw new Error(`Unexpected URL ${url}`);
    };
    await assert.rejects(
      () => markLiveVerified({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) =>
          url === liveUrls.launchUrl
            ? response(url, Buffer.alloc(0), 302)
            : successfulFetch(url),
      }),
      /redirected/,
    );
    await assert.rejects(
      () => markLiveVerified({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) =>
          url === liveUrls.launchJsonUrl
            ? response(url, Buffer.from("wrong"))
            : successfulFetch(url),
      }),
      /launch\.json bytes differ/,
    );
    await assert.rejects(
      () => activateLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: successfulFetch,
      }),
      /not already live-verified/,
    );
    await markLiveVerified({
      projectRoot: root,
      ...liveUrls,
      now: "2026-01-04T00:00:00Z",
      fetchImpl: successfulFetch,
    });

    const postActivationPageBytes = Buffer.from(
      `<html><body><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}">activated</section></body></html>`,
    );
    const postActivationFetch = async (url) => {
      if (url === liveUrls.launchUrl) return response(url, postActivationPageBytes);
      if (url === liveUrls.launchJsonUrl) return response(url, localLaunchBytes);
      if (url === liveUrls.promptUrl) return response(url, localPromptBytes);
      throw new Error(`Unexpected URL ${url}`);
    };
    const commentOnlyPageBytes = Buffer.from(
      `<!-- <section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section> -->`,
    );
    await assert.rejects(
      () => activateLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) =>
          url === liveUrls.launchUrl
            ? response(url, commentOnlyPageBytes)
            : postActivationFetch(url),
      }),
      /exactly one data-stage1-launch-id marker/,
    );
    for (const [label, inertPageBytes] of [
      ["textarea", Buffer.from(
        `<textarea><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section></textarea>`,
      )],
      ["template", Buffer.from(
        `<template><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section></template>`,
      )],
      ["scripting-enabled noscript", Buffer.from(
        `<noscript><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section></noscript>`,
      )],
      ["self-closing script remains script data", Buffer.from(
        `<script/><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section>`,
      )],
      ["script escaped-state closing tag remains script data", Buffer.from(
        `<script><!--<script></script><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section>`,
      )],
      ["select parsing context", Buffer.from(
        `<select><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section></select>`,
      )],
      ["foreign SVG namespace", Buffer.from(
        `<svg><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section></svg>`,
      )],
      ["attribute-value decoy", Buffer.from(
        `<section data-note='data-stage1-launch-id="neutral-launch"' data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section>`,
      )],
      ["prefixed attribute", Buffer.from(
        `<section x-data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}"></section>`,
      )],
    ]) {
      await assert.rejects(
        () => activateLive({
          projectRoot: root,
          ...liveUrls,
          fetchImpl: async (url) =>
            url === liveUrls.launchUrl
              ? response(url, inertPageBytes)
              : postActivationFetch(url),
        }),
        /exactly one data-stage1-launch-id marker/,
        label,
      );
    }
    await assert.rejects(
      () => activateLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) =>
          url === liveUrls.promptUrl
            ? response(url, Buffer.from("wrong"))
            : postActivationFetch(url),
      }),
      /prompt\.txt bytes differ/,
    );
    const releaseBeforeActivation = await readFile(releasePath, "utf8");
    const liveVerificationBeforeActivation = await readFile(
      path.join(launch.root, "live-verification.json"),
      "utf8",
    );
    const activation = await activateLive({
      projectRoot: root,
      ...liveUrls,
      now: "2026-01-05T00:00:00Z",
      fetchImpl: postActivationFetch,
    });
    const activationPath = path.join(
      root,
      "activations",
      "neutral-launch",
      "verification.json",
    );
    assert.deepEqual(
      JSON.parse(await readFile(activationPath, "utf8")),
      activation,
    );
    assert.equal(activation.observedPageSha256, sha256(postActivationPageBytes));
    assert.equal(activation.markerProjection.launchId, launch.launch.id);
    assert.equal(
      activation.markerProjectionDigest,
      manifestDigest(activation.markerProjection),
    );
    assert.equal(await readFile(releasePath, "utf8"), releaseBeforeActivation);
    assert.equal(
      await readFile(path.join(launch.root, "live-verification.json"), "utf8"),
      liveVerificationBeforeActivation,
    );
    await assert.rejects(
      () => activateLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: postActivationFetch,
      }),
      /create-only/,
    );
    const activationBytes = await readFile(activationPath);
    const activationDigest = manifestDigest(activation);
    const renderedPrompt = localPromptBytes.toString("utf8")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
    const finalPage = (body) => Buffer.from(
      `<main><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}" data-activation-verification-digest="${activationDigest}">${body}</section></main>`,
    );
    const finalPageBytes = finalPage(
      `<pre class="prompt-block" data-stage1-handoff="executable"><code>${renderedPrompt}</code></pre>`,
    );
    const finalFetch = async (url, page = finalPageBytes, record = activationBytes) => {
      if (url === liveUrls.launchUrl) return response(url, page);
      if (url === liveUrls.launchJsonUrl) return response(url, localLaunchBytes);
      if (url === liveUrls.promptUrl) return response(url, localPromptBytes);
      if (url === "https://example.invalid/base/framework/activations/neutral-launch/verification.json") {
        return response(url, record);
      }
      throw new Error(`Unexpected URL ${url}`);
    };
    const changedButSemanticallyEquivalentPage = Buffer.from(
      `<main><aside>different HTML bytes</aside><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}" data-activation-verification-digest="${activationDigest}"><pre class="prompt-block" data-stage1-handoff="executable"><code>${renderedPrompt}</code></pre></section></main>`,
    );
    const auditSnapshot = await Promise.all([
      readFile(releasePath, "utf8"),
      readFile(path.join(launch.root, "live-verification.json"), "utf8"),
      readFile(activationPath, "utf8"),
    ]);
    const audit = await auditLive({
      projectRoot: root,
      ...liveUrls,
      now: "2026-01-06T00:00:00Z",
      fetchImpl: async (url) =>
        finalFetch(url, changedButSemanticallyEquivalentPage),
    });
    assert.equal(audit.observedPageSha256, sha256(changedButSemanticallyEquivalentPage));
    assert.notEqual(audit.observedPageSha256, activation.observedPageSha256);
    assert.deepEqual(await Promise.all([
      readFile(releasePath, "utf8"),
      readFile(path.join(launch.root, "live-verification.json"), "utf8"),
      readFile(activationPath, "utf8"),
    ]), auditSnapshot);
    await assert.rejects(
      () => auditLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) =>
          url === liveUrls.launchUrl
            ? response(url, Buffer.from("<section></section>"))
            : finalFetch(url),
      }),
      /exactly one data-stage1-launch-id marker/,
    );
    await assert.rejects(
      () => auditLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) => finalFetch(url, postActivationPageBytes),
      }),
      /data-stage1-handoff marker/,
    );
    await assert.rejects(
      () => auditLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) => finalFetch(url, finalPage(
          `<pre class="prompt-block" data-stage1-handoff="executable"><code>wrong prompt</code></pre>`,
        )),
      }),
      /rendered prompt does not exactly match prompt\.txt/,
    );
    await assert.rejects(
      () => auditLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) => finalFetch(
          url,
          Buffer.from(
            `<main><section data-stage1-launch-id="neutral-launch" data-launch-digest="${launch.launch.launchDigest}" data-prompt-sha256="${launch.launch.promptSha256}" data-activation-verification-digest="${"0".repeat(64)}"><pre class="prompt-block" data-stage1-handoff="executable"><code>${renderedPrompt}</code></pre></section></main>`,
          ),
        ),
      }),
      /activation verification marker does not bind/,
    );
    await assert.rejects(
      () => auditLive({
        projectRoot: root,
        ...liveUrls,
        fetchImpl: async (url) => finalFetch(url, finalPageBytes, Buffer.from("wrong activation")),
      }),
      /Remote activation verification bytes differ/,
    );

    const preActivationCohortRoot = path.join(
      root,
      "cohorts",
      "pre-activation-cohort",
    );
    const preActivationCohort = {
      schemaVersion: "1.0",
      id: "pre-activation-cohort",
      openedAt: "2026-01-04T12:00:00Z",
      launchId: "neutral-launch",
      fairnessFingerprint: launch.launch.fairnessFingerprint,
      status: "open",
      candidateIds: ["candidate-pre-activation"],
      extensions: {},
    };
    await writeJson(
      path.join(preActivationCohortRoot, "cohort.json"),
      preActivationCohort,
    );
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "cohort-open-before-activation",
    ));
    await writeJson(
      path.join(preActivationCohortRoot, "cohort.json"),
      { ...preActivationCohort, openedAt: "2026-01-06T00:00:00Z" },
    );
    assert.ok(!(await validateFramework(root)).issues.some(
      ({ code }) => code === "cohort-open-before-activation"
        || code === "cohort-launch-not-activated",
    ));
    await rm(preActivationCohortRoot, { recursive: true, force: true });

    const framework = await validateFramework(root);
    assert.deepEqual(framework.issues, []);
    await writeJson(activationPath, {
      ...activation,
      liveVerificationDigest: "0".repeat(64),
    });
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "activation-live-verification-binding",
    ));
    await writeJson(activationPath, activation);
    await writeJson(
      path.join(root, "activations", "orphan-activation", "verification.json"),
      activation,
    );
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "orphan-activation-verification",
    ));
    await rm(path.join(root, "activations", "orphan-activation"), { recursive: true });
    assert.equal(framework.launches.find(
      ({ manifest }) => manifest?.id === "neutral-launch",
    ).publicEligible, true);
    assert.equal(framework.launches.find(
      ({ manifest }) => manifest?.id === "unapproved-launch",
    ).publicEligible, false);
    const verificationPath = path.join(launch.root, "live-verification.json");
    const verification = JSON.parse(await readFile(verificationPath, "utf8"));
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    const changedVerification = {
      ...verification,
      launchJsonSha256: "0".repeat(64),
    };
    await writeJson(verificationPath, changedVerification);
    await writeJson(releasePath, {
      ...release,
      liveVerificationDigest: manifestDigest(changedVerification),
    });
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "live-launch-json-binding",
    ));
    await writeJson(verificationPath, verification);
    await writeJson(releasePath, release);

    await execFileAsync(
      process.execPath,
      [path.join(repositoryRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: repositoryRoot },
    );
    const catalog = JSON.parse(
      await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"),
    );
    assert.deepEqual(catalog.launches.map(({ id }) => id), ["neutral-launch"]);
    assert.equal(catalog.launches[0].releaseStatus, "live-verified");
    assert.equal(
      catalog.launches[0].promptText,
      await readFile(path.join(launch.root, "prompt.txt"), "utf8"),
    );
    assert.deepEqual(catalog.taskPackets.map(({ version }) => version), ["1.0"]);
    await readFile(
      path.join(root, "public", "framework", "launches", "neutral-launch", "launch.json"),
    );
    await readFile(
      path.join(root, "public", "framework", "launches", "neutral-launch", "prompt.txt"),
    );
    await readFile(path.join(
      root,
      "public",
      "framework",
      "contracts",
      launch.launch.executionContractDigest,
      "contract.json",
    ));

    const contractBefore = await computeExecutionContractDigest(root);
    for (const schemaName of ["artifact.schema.json", "submission.schema.json"]) {
      const schemaPath = path.join(root, "schemas", schemaName);
      const futureSchema = JSON.parse(await readFile(schemaPath, "utf8"));
      futureSchema.required = [...new Set([
        ...(futureSchema.required ?? []),
        "futureRequired",
      ])];
      futureSchema.properties.futureRequired = { const: "future-only" };
      await writeJson(schemaPath, futureSchema);
    }
    assert.notEqual(await computeExecutionContractDigest(root), contractBefore);
    const candidateOutput = await writeV3Candidate(root, launch.launch);
    await writeJson(path.join(root, "cohorts", "frozen-contract-cohort", "cohort.json"), {
      schemaVersion: "1.0",
      id: "frozen-contract-cohort",
      openedAt: "2026-07-29T00:00:00Z",
      launchId: launch.launch.id,
      fairnessFingerprint: launch.launch.fairnessFingerprint,
      status: "open",
      candidateIds: ["frozen-contract-candidate"],
      extensions: {},
    });
    await execFileAsync(
      process.execPath,
      [
        path.join(repositoryRoot, "scripts", "stage2-integrate.mjs"),
        "--source",
        candidateOutput,
        "--candidate-id",
        "frozen-contract-candidate",
        "--cohort-id",
        "frozen-contract-cohort",
      ],
      { cwd: root },
    );
    assert.deepEqual((await validateFramework(root)).issues, []);
    const prompt = buildLaunchPrompt(launch.launch, {
      ...first.packet,
      instructionsText: "Synthetic task",
    });
    assert.match(prompt, /Do not publish, compare, score/);
    assert.doesNotMatch(prompt, /cohort ID:/i);

    const missingV3Bindings = {
      schemaVersion: "1.0",
      protocolVersion: "3.0",
      status: "complete",
      launchId: "neutral-launch",
      taskPacket: {
        id: "neutral-benchmark",
        version: "1.0",
        digest: "1".repeat(64),
      },
      fairnessFingerprint: "2".repeat(64),
      model: { provider: "unknown", name: "unknown", version: "unknown" },
      initialPlan: { path: "plan.json", sha256: "3".repeat(64) },
      initialPlanCheckpoint: { path: "initial-plan.sha256", sha256: "4".repeat(64) },
      workRecord: { path: "work-record.json", sha256: "5".repeat(64) },
      artifacts: [{
        id: "evidence",
        role: "supporting",
        path: "artifacts/evidence.txt",
        sha256: "6".repeat(64),
        status: "present",
      }],
    };
    assert.ok(validateSubmission(missingV3Bindings).length > 0);
    assert.notEqual(manifestDigest(first.packet), manifestDigest(second.packet));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("frozen packets and launches reject undeclared bytes and prompt reconstruction drift", async () => {
  const root = await createProject();
  try {
    const source = await writeTaskSource(root, "1.0", "Exact fixture");
    await writeFile(path.join(source, "undeclared.txt"), "not an input\n");
    await assert.rejects(() => freezePacket({
      projectRoot: root,
      sourceRoot: source,
      packetId: "neutral-benchmark",
      version: "1.0",
    }), /exactly task.json and declared files/);
    await rm(path.join(source, "undeclared.txt"));
    const frozen = await freezePacket({
      projectRoot: root,
      sourceRoot: source,
      packetId: "neutral-benchmark",
      version: "1.0",
      now: "2026-01-01T00:00:00Z",
    });
    await writeFile(path.join(frozen.root, "surplus.txt"), "surplus\n");
    assert.ok((await validateFrozenPacket(frozen.root)).issues.some(
      ({ code }) => code === "undeclared-frozen-file",
    ));
    await rm(path.join(frozen.root, "surplus.txt"));

    const packetPath = path.join(frozen.root, "packet.json");
    const lockPath = path.join(frozen.root, "packet-lock.json");
    const packet = JSON.parse(await readFile(packetPath, "utf8"));
    const lock = JSON.parse(await readFile(lockPath, "utf8"));
    packet.title = "Tampered packet title";
    lock.packetDigest = manifestDigest(packet);
    await writeJson(packetPath, packet);
    await writeJson(lockPath, lock);
    assert.ok((await validateFrozenPacket(frozen.root)).issues.some(
      ({ code }) => code === "packet-reconstruction-mismatch",
    ));

    await rm(path.join(root, "task-packets"), { recursive: true, force: true });
    const clean = await freezePacket({
      projectRoot: root,
      sourceRoot: source,
      packetId: "neutral-benchmark",
      version: "1.0",
      now: "2026-01-01T00:00:00Z",
    });
    const profilePath = path.join(root, "profile.json");
    await writeJson(profilePath, {
      schemaVersion: "3.0",
      id: "neutral-profile",
      version: "1.0",
      canonicalBaseUrl: "https://example.invalid/base",
      outputRoot: "candidate-output",
      startAction: "checkpoint-initial-plan",
      stopConditions: ["Stop for a missing declared input."],
      extensions: {},
    });
    const workspace = await createCleanWorkspace(root);
    const frozenLaunch = await freezeLaunch({
      projectRoot: root,
      launchId: "exact-launch",
      packetId: clean.packet.id,
      version: clean.packet.version,
      profilePath,
      workspace,
      now: "2026-01-01T00:00:00Z",
    });
    assert.equal((await validateLaunchFreeze(root, "exact-launch")).status, "valid");
    await writeFile(path.join(frozenLaunch.root, "unexpected.txt"), "unexpected\n");
    assert.ok((await validateLaunchFreeze(root, "exact-launch")).issues.some(
      ({ code }) => code === "launch-file-not-allowed",
    ));
    await rm(path.join(frozenLaunch.root, "unexpected.txt"));
    const launchPath = path.join(frozenLaunch.root, "launch.json");
    const releasePath = path.join(frozenLaunch.root, "release.json");
    const launch = JSON.parse(await readFile(launchPath, "utf8"));
    const release = JSON.parse(await readFile(releasePath, "utf8"));
    const recoveryEngineeringDigest = "1".repeat(64);
    const recoveryProtocolDigest = "2".repeat(64);
    const recoveryApproval = {
      expectedLaunchDigest: launch.launchDigest,
      engineeringReviewDigest: recoveryEngineeringDigest,
      protocolReviewDigest: recoveryProtocolDigest,
      statement: `APPROVE RELEASE ${launch.launchDigest}`,
      attestedAt: "2026-01-02T00:00:00Z",
    };
    const recoveredRelease = {
      ...release,
      status: "approved",
      engineeringReviewDigest: recoveryEngineeringDigest,
      protocolReviewDigest: recoveryProtocolDigest,
      approvalAttestation: recoveryApproval,
      approvalAttestationDigest: manifestDigest(recoveryApproval),
      updatedAt: "2026-01-02T00:00:00Z",
    };
    await writeJson(path.join(frozenLaunch.root, "release-transition.json"), {
      schemaVersion: "1.0",
      algorithm: "sha256-release-transition-v1",
      releasePath: "release.json",
      prior: { digest: manifestDigest(release), value: release },
      next: { digest: manifestDigest(recoveredRelease), value: recoveredRelease },
      auxiliary: null,
    });
    await writeFile(releasePath, "{");
    const recoveredFreeze = await validateLaunchFreeze(root, "exact-launch");
    assert.equal(recoveredFreeze.status, "valid");
    assert.equal(recoveredFreeze.release.status, "approved");
    await assert.rejects(
      () => readFile(path.join(frozenLaunch.root, "release-transition.json")),
      /ENOENT/,
    );
    await writeJson(releasePath, release);
    const tamperedPrompt = "not the frozen renderer output\n";
    launch.promptSha256 = sha256(Buffer.from(tamperedPrompt));
    release.promptSha256 = launch.promptSha256;
    await writeJson(launchPath, launch);
    await writeJson(releasePath, release);
    await writeFile(path.join(frozenLaunch.root, "prompt.txt"), tamperedPrompt);
    assert.ok((await validateLaunchFreeze(root, "exact-launch")).issues.some(
      ({ code }) => code === "prompt-reconstruction-mismatch",
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("engineering scoring dispatch uses the frozen evaluator and rejects snapshot tampering", async () => {
  const root = await createProject();
  try {
    await writeJson(
      path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"),
      {
        schemaVersion: "1.0",
        id: "neutral-benchmark",
        title: "Frozen evaluator fixture",
        status: "active",
        version: "1.0",
        extensions: {},
      },
    );
    const source = await writeTaskSource(root, "1.0", "Frozen evaluator fixture");
    const packet = await freezePacket({
      projectRoot: root,
      sourceRoot: source,
      packetId: "neutral-benchmark",
      version: "1.0",
      now: "2026-01-01T00:00:00Z",
    });
    const profilePath = path.join(root, "profile.json");
    await writeJson(profilePath, {
      schemaVersion: "3.0",
      id: "frozen-evaluator-profile",
      version: "1.0",
      canonicalBaseUrl: "https://example.invalid/frozen-evaluator",
      outputRoot: "candidate-output",
      startAction: "checkpoint-initial-plan",
      stopConditions: ["fixture"],
      extensions: {},
    });
    const workspace = await createCleanWorkspace(root);
    const frozenLaunch = await freezeLaunch({
      projectRoot: root,
      launchId: "frozen-evaluator-launch",
      packetId: packet.packet.id,
      version: packet.packet.version,
      profilePath,
      workspace,
      now: "2026-01-01T00:00:00Z",
    });
    const runId = "frozen-evaluator-run";
    await writeJson(path.join(root, "runs", runId, "run.json"), {
      id: runId,
      status: "validated",
      seal: { sealed: true },
      launchId: frozenLaunch.launch.id,
      executionContractDigest: frozenLaunch.launch.executionContractDigest,
    });

    // A later workspace edit must not affect the evaluator selected for this
    // launch. The loader only imports the byte-verified snapshot below.
    await writeFile(
      path.join(root, "scripts", "evaluate-engineering-submission.mjs"),
      'throw new Error("live evaluator must not run");\n',
    );
    const evaluator = await loadFrozenEngineeringEvaluator({
      projectRoot: root,
      runId,
    });
    assert.equal(typeof evaluator.scoreEngineeringRun, "function");

    const frozenEvaluatorPath = path.join(
      frozenLaunch.root,
      "execution-contract",
      "scripts",
      "evaluate-engineering-submission.mjs",
    );
    const frozenBytes = await readFile(frozenEvaluatorPath, "utf8");
    await writeFile(
      frozenEvaluatorPath,
      `${frozenBytes}\nthrow new Error("tampered evaluator imported");\n`,
    );
    await assert.rejects(
      () => loadFrozenEngineeringEvaluator({ projectRoot: root, runId }),
      /Frozen execution contract is invalid/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v2 requires an explicit grandfather entry and v3 output IDs bind exactly once", async () => {
  const root = await createProject();
  try {
    const taskText = "Legacy fixture\n";
    const packet = {
      schemaVersion: "1.0",
      id: "neutral-benchmark",
      version: "1.0",
      title: "Legacy fixture",
      instructions: { path: "TASK.md", sha256: sha256(Buffer.from(taskText)) },
      inputs: [],
      requiredOutputs: ["supporting"],
      environment: { baseline: "fixture", cad: "fixture", stepPipeline: "fixture" },
      completionCriteria: ["fixture"],
    };
    const launch = {
      schemaVersion: "1.0",
      id: "legacy-launch",
      protocolVersion: "2.0",
      taskPacket: { id: packet.id, version: packet.version, digest: manifestDigest(packet) },
      baselineCommit: "0".repeat(40),
      workspaceDigest: "1".repeat(64),
      outputRoot: "candidate-output",
      startAction: "checkpoint-initial-plan",
      stopConditions: ["fixture"],
      fairnessFingerprint: "",
    };
    launch.fairnessFingerprint = computeFairnessFingerprint(launch);
    await writeJson(path.join(root, "benchmarks", packet.id, "benchmark.json"), {
      schemaVersion: "1.0", id: packet.id, title: "Legacy fixture", status: "draft", version: "9.0", extensions: {},
    });
    await mkdir(path.join(root, "task-packets", packet.id), { recursive: true });
    await writeFile(path.join(root, "task-packets", packet.id, "TASK.md"), taskText);
    await writeJson(path.join(root, "task-packets", packet.id, "packet.json"), packet);
    await writeJson(path.join(root, "launches", launch.id, "launch.json"), launch);
    assert.ok((await validateFramework(root)).issues.some(({ code }) => code === "v2-not-grandfathered"));
    await writeJson(path.join(root, "legacy-v2-grandfather.json"), {
      schemaVersion: "1.0",
      status: "immutable",
      entries: [{
        taskPacket: launch.taskPacket,
        launch: { id: launch.id, fairnessFingerprint: launch.fairnessFingerprint },
      }],
    });
    assert.deepEqual((await validateFramework(root)).issues, []);

    const hybridPacket = { ...packet, id: "hybrid-benchmark" };
    const hybridLaunch = {
      ...launch,
      id: "hybrid-launch",
      taskPacket: {
        id: hybridPacket.id,
        version: hybridPacket.version,
        digest: manifestDigest(hybridPacket),
      },
      fairnessFingerprint: "",
    };
    hybridLaunch.fairnessFingerprint = computeFairnessFingerprint(hybridLaunch);
    await writeJson(path.join(root, "benchmarks", hybridPacket.id, "benchmark.json"), {
      schemaVersion: "1.0",
      id: hybridPacket.id,
      title: "Hybrid fixture",
      status: "draft",
      version: "1.0",
      extensions: {},
    });
    await mkdir(
      path.join(root, "task-packets", hybridPacket.id, hybridPacket.version),
      { recursive: true },
    );
    await writeFile(
      path.join(root, "task-packets", hybridPacket.id, hybridPacket.version, "TASK.md"),
      taskText,
    );
    await writeJson(
      path.join(root, "task-packets", hybridPacket.id, hybridPacket.version, "packet.json"),
      hybridPacket,
    );
    await writeJson(
      path.join(root, "launches", hybridLaunch.id, "launch.json"),
      hybridLaunch,
    );
    await writeJson(path.join(root, "legacy-v2-grandfather.json"), {
      schemaVersion: "1.0",
      status: "immutable",
      entries: [
        {
          taskPacket: launch.taskPacket,
          launch: { id: launch.id, fairnessFingerprint: launch.fairnessFingerprint },
        },
        {
          taskPacket: hybridLaunch.taskPacket,
          launch: {
            id: hybridLaunch.id,
            fairnessFingerprint: hybridLaunch.fairnessFingerprint,
          },
        },
      ],
    });
    assert.ok((await validateFramework(root)).issues.some(
      ({ code }) => code === "v2-hybrid-packet",
    ));

    const v3Packet = {
      schemaVersion: "3.0",
      requiredOutputs: [{ id: "OUT-001", role: "supporting", description: "Evidence" }],
      completionCriteria: [{ id: "CRIT-001", statement: "Evidence exists", requiredOutputRefs: ["OUT-001"], evidenceRoles: ["supporting"] }],
    };
    assert.deepEqual(validateRequiredOutputBindings(v3Packet, [{
      id: "evidence", role: "supporting", status: "present", requiredOutputRefs: ["OUT-001"],
    }]), []);
    const invalidBindings = validateRequiredOutputBindings(v3Packet, [
      { id: "one", role: "supporting", status: "present", requiredOutputRefs: ["OUT-001"] },
      { id: "two", role: "supporting", status: "present", requiredOutputRefs: ["OUT-001", "OUT-999"] },
    ]);
    assert.ok(invalidBindings.some(({ code }) => code === "duplicate-required-output-binding"));

    const v4Packet = {
      ...v3Packet,
      schemaVersion: "4.0",
    };
    const v4PackageBindings = validateRequiredOutputBindings(v4Packet, [
      { id: "one", role: "supporting", status: "present", requiredOutputRefs: ["OUT-001"] },
      { id: "two", role: "supporting", status: "present", requiredOutputRefs: ["OUT-001"] },
    ]);
    assert.ok(
      !v4PackageBindings.some(({ code }) => code === "duplicate-required-output-binding"),
      "v4 logical output packages may be represented by multiple inspectable artifacts",
    );
    assert.ok(invalidBindings.some(({ code }) => code === "unknown-required-output-ref"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Git baseline verification rejects ignored, linked, nested-Git, and index-hidden workspace changes", async () => {
  const root = await createProject();
  try {
    const workspace = await createCleanWorkspace(root);
    await writeFile(path.join(workspace, ".gitignore"), "ignored.txt\n");
    await execFileAsync("git", ["add", ".gitignore"], { cwd: workspace });
    await execFileAsync(
      "git",
      ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-m", "ignore"],
      { cwd: workspace },
    );
    await writeFile(path.join(workspace, "ignored.txt"), "hidden\n");
    await assert.rejects(() => verifyGitWorkspace(workspace), /dirty|ignored or untracked/);
    await rm(path.join(workspace, "ignored.txt"));
    const junctionTarget = path.join(root, "junction-target");
    const junctionPath = path.join(workspace, "linked-directory");
    await mkdir(junctionTarget);
    await symlink(junctionTarget, junctionPath, "junction");
    await assert.rejects(
      () => verifyGitWorkspace(workspace),
      /Symbolic links, junctions, and reparse points/,
    );
    await unlink(junctionPath);
    await mkdir(path.join(workspace, "nested", ".git"), { recursive: true });
    await assert.rejects(
      () => verifyGitWorkspace(workspace),
      /Nested \.git metadata/,
    );
    await rm(path.join(workspace, "nested"), { recursive: true, force: true });
    await execFileAsync("git", ["update-index", "--assume-unchanged", "baseline.txt"], { cwd: workspace });
    await assert.rejects(() => verifyGitWorkspace(workspace), /skip-worktree or assume-unchanged/);
    await execFileAsync("git", ["update-index", "--no-assume-unchanged", "baseline.txt"], { cwd: workspace });
    await execFileAsync("git", ["update-index", "--skip-worktree", "baseline.txt"], { cwd: workspace });
    await assert.rejects(() => verifyGitWorkspace(workspace), /skip-worktree or assume-unchanged/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("multiple packet versions coexist through their compound packet and launch identities", async () => {
  const root = await createProject();
  try {
    await writeJson(path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"), {
      schemaVersion: "1.0",
      id: "neutral-benchmark",
      title: "Versioned fixture",
      status: "draft",
      version: "2.0",
      extensions: {},
    });
    const one = await freezePacket({
      projectRoot: root,
      sourceRoot: await writeTaskSource(root, "1.0", "Version one"),
      packetId: "neutral-benchmark",
      version: "1.0",
      now: "2026-01-01T00:00:00Z",
    });
    const two = await freezePacket({
      projectRoot: root,
      sourceRoot: await writeTaskSource(root, "2.0", "Version two"),
      packetId: "neutral-benchmark",
      version: "2.0",
      now: "2026-01-01T00:00:00Z",
    });
    const profilePath = path.join(root, "profile.json");
    await writeJson(profilePath, {
      schemaVersion: "3.0", id: "versioned-profile", version: "1.0", canonicalBaseUrl: "https://example.invalid/base",
      outputRoot: "candidate-output", startAction: "checkpoint-initial-plan",
      stopConditions: ["Stop only for a missing declared input."], extensions: {},
    });
    const workspace = await createCleanWorkspace(root);
    await freezeLaunch({
      projectRoot: root, launchId: "launch-one", packetId: one.packet.id,
      version: one.packet.version, profilePath, workspace, now: "2026-01-01T00:00:00Z",
    });
    await freezeLaunch({
      projectRoot: root, launchId: "launch-two", packetId: two.packet.id,
      version: two.packet.version, profilePath, workspace, now: "2026-01-01T00:00:00Z",
    });
    assert.deepEqual((await validateFramework(root)).issues, []);
    const launchPath = path.join(root, "launches", "launch-one", "launch.json");
    const launch = JSON.parse(await readFile(launchPath, "utf8"));
    launch.taskPacket.version = "2.0";
    await writeJson(launchPath, launch);
    const validation = await validateFramework(root);
    assert.ok(validation.launches.find(({ manifest }) => manifest?.id === "launch-one")
      .stage0Issues.some(({ code }) => code === "task-packet-digest-mismatch" || code === "launch-packet-binding"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 0 requires every declared output-contract artefact to have a compatible checkpoint assignment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "stage0-output-contract-"));
  try {
    const source = path.join(root, "integrated-robotic-handling-v1.8");
    await cp(
      path.join(repositoryRoot, "stage0-drafts", "integrated-robotic-handling-v1.8"),
      source,
      { recursive: true },
    );
    const valid = await lintTaskDefinition(source);
    assert.equal(valid.status, "valid", valid.issues.map(({ code, message }) => `${code}: ${message}`).join("\n"));
    const frozen = await freezePacket({
      projectRoot: root,
      sourceRoot: source,
      packetId: "integrated-robotic-handling",
      version: "1.8",
    });
    assert.equal((await validateFrozenPacket(frozen.root)).status, "valid");

    const outputContractPath = path.join(source, "inputs", "output-contract.json");
    const outputContract = JSON.parse(await readFile(outputContractPath, "utf8"));
    for (const checkpoint of outputContract.candidateCheckpoints) {
      checkpoint.requiredArtefacts = checkpoint.requiredArtefacts
        .filter((artefactPath) => artefactPath !== "artifacts/safety/service-and-utility-plan.md");
    }
    await writeJson(outputContractPath, outputContract);

    const invalid = await lintTaskDefinition(source);
    assert.equal(invalid.status, "invalid");
    assert.ok(
      invalid.issues.some(({ code, message }) => (
        code === "unassigned-output-contract-artefact"
        && message.includes("ART-012")
      )),
    );
    await assert.rejects(
      freezePacket({
        projectRoot: root,
        sourceRoot: source,
        packetId: "integrated-robotic-handling",
        version: "1.8",
      }),
      /unassigned-output-contract-artefact/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("v4 binds public contracts, bootstrap, append-only receipts, and partial attainment", async () => {
  const root = await createProject();
  try {
    const source = path.join(root, "source-v4");
    await mkdir(source, { recursive: true });
    const publicFiles = {
      "visibility.json": "visibility policy\n",
      "checkpoints.json": "checkpoint contract\n",
      "evaluation.json": "evaluation contract\n",
      "sanitize.json": "sanitization profile\n",
    };
    for (const [file, text] of Object.entries(publicFiles)) {
      await writeFile(path.join(source, file), text);
    }
    const digest = (file) => sha256(Buffer.from(publicFiles[file]));
    const commitment = (id, visibilityClass, disclosedAt, value) => ({
      id, visibilityClass, disclosedAt, requirementRefs: [], digest: value,
    });
    const task = {
      ...taskDefinition("4.0", "V4 fixture"),
      schemaVersion: "4.0",
      inputs: [
        { id: "visibility", path: "visibility.json", mediaType: "application/json", provenance: "fixture", license: "CC0-1.0", downloadName: "visibility.json" },
        { id: "checkpoints", path: "checkpoints.json", mediaType: "application/json", provenance: "fixture", license: "CC0-1.0", downloadName: "checkpoints.json" },
        { id: "evaluation", path: "evaluation.json", mediaType: "application/json", provenance: "fixture", license: "CC0-1.0", downloadName: "evaluation.json" },
        { id: "sanitize", path: "sanitize.json", mediaType: "application/json", provenance: "fixture", license: "CC0-1.0", downloadName: "sanitize.json" },
      ],
      v4Contract: {
        scoringVersion: "v4-fixture",
        instanceBankManifest: commitment("INS-001", "run-private-instance", "run-start", "1".repeat(64)),
        visibilityPolicy: commitment("VIS-001", "candidate-public", "before-run", digest("visibility.json")),
        checkpointContract: commitment("CKC-001", "candidate-public", "before-run", digest("checkpoints.json")),
        changeEventContract: commitment("CHC-001", "event-private-change", "after-prior-receipt", "2".repeat(64)),
        evaluationContract: commitment("EVC-001", "candidate-public", "before-run", digest("evaluation.json")),
        sanitizationProfile: commitment("SAN-001", "candidate-public", "before-run", digest("sanitize.json")),
        sealedAssetCommitments: [commitment("SEA-001", "evaluator-secret", "evaluator-only", "3".repeat(64))],
        disclosureSchedule: [commitment("DSC-001", "candidate-public", "before-run", "4".repeat(64))],
      },
      checkpoints: [
        { id: "CKPT-000", sequence: 0, title: "Initial plan", phase: "initial-plan", requiredOutputRefs: [], requiresPriorCheckpointIds: [] },
        { id: "CKPT-100", sequence: 1, title: "Concept", phase: "concept", requiredOutputRefs: ["OUT-001"], requiresPriorCheckpointIds: ["CKPT-000"] },
        { id: "CKPT-200", sequence: 2, title: "Change", phase: "change-response", requiredForBaseline: false, requiredOutputRefs: [], requiresPriorCheckpointIds: ["CKPT-100"] },
      ],
      changeEvents: [{ id: "CHG-001", visibilityClass: "event-private-change", triggerAfterCheckpointId: "CKPT-100", responseCheckpointId: "CKPT-200", requirementRefs: ["REQ-001"], digest: "5".repeat(64) }],
    };
    await writeJson(path.join(source, "task.json"), task);
    await writeFile(path.join(source, "TASK.md"), "# V4 fixture\n");
    await writeJson(path.join(root, "benchmarks", task.id, "benchmark.json"), {
      schemaVersion: "1.0", id: task.id, title: task.title, status: "draft", version: task.version, extensions: {},
    });
    const frozen = await freezePacket({ projectRoot: root, sourceRoot: source, packetId: task.id, version: task.version, now: "2026-01-01T00:00:00Z" });
    assert.equal(frozen.packet.schemaVersion, "4.0");
    assert.equal((await validateFrozenPacket(frozen.root)).status, "valid");

    const profilePath = path.join(root, "profile-v4.json");
    await writeJson(profilePath, {
      schemaVersion: "4.0", protocolVersion: "4.0", id: "v4-profile", version: "1.0",
      canonicalBaseUrl: "https://example.invalid/base", outputRoot: "candidate-output",
      startAction: "checkpoint-initial-plan", stopConditions: ["fixture"],
      sanitization: {
        maxBundleFiles: 32, maxBundleBytes: 1048576, maxFileBytes: 262144,
        maxPathLength: 240, maxJsonBytes: 131072, maxTextBytes: 131072,
        maxPdfBytes: 262144, maxStepBytes: 262144, maxImageBytes: 262144,
      },
      workspaceBootstrap: { kind: "public-bundle", location: "https://example.invalid/bootstrap.zip", sha256: "6".repeat(64) }, extensions: {},
    });
    const workspace = await createCleanWorkspace(root);
    const launchResult = await freezeLaunch({ projectRoot: root, launchId: "v4-launch", packetId: task.id, version: task.version, profilePath, workspace, now: "2026-01-01T00:00:00Z" });
    assert.equal(launchResult.launch.protocolVersion, "4.0");
    assert.equal((await validateLaunchFreeze(root, "v4-launch")).status, "valid");
    const v4Prompt = buildLaunchPrompt(launchResult.launch, {
      ...frozen.packet,
      instructionsText: "# V4 fixture\n",
      workspaceBootstrap: launchResult.launch.workspaceBootstrap,
    });
    assert.match(v4Prompt, /Public workspace bootstrap/);
    assert.match(v4Prompt, /append-only receipt/);
    assert.match(v4Prompt, /partialAttainment/);
    assert.match(v4Prompt, /sanitizationRequest\.profileDigest/);
    assert.match(v4Prompt, /CHG-001: commitment digest/);
    assert.match(v4Prompt, /The change payload is not disclosed/);

    const output = path.join(root, "candidate-output");
    await mkdir(output);
    const plan = {
      schemaVersion: "1.0", status: "initial", requirements: [{ id: "REQ-001", source: "fixture", statement: "fixture" }], assumptions: [],
      steps: [{ id: "STEP-001", statement: "fixture", requirementRefs: ["REQ-001"] }], alternativesToEvaluate: [],
      verificationPlan: [{ id: "VER-001", requirementRefs: ["REQ-001"], method: "fixture", expectedEvidence: "fixture" }],
    };
    const workRecord = { schemaVersion: "1.0", alternatives: [], decisions: [], planRevisions: [], verificationClaims: [{ id: "CLAIM-001", requirementRefs: ["REQ-001"], method: "fixture", result: "not-run", evidenceArtifactRefs: [] }] };
    await writeJson(path.join(output, "plan.json"), plan);
    await writeJson(path.join(output, "work-record.json"), workRecord);
    const planBytes = await readFile(path.join(output, "plan.json"));
    const workBytes = await readFile(path.join(output, "work-record.json"));
    await execFileAsync(process.execPath, [
      path.join(repositoryRoot, "scripts", "stage1-checkpoint.mjs"), "--root", output,
    ]);
    const checkpoint = await execFileAsync(process.execPath, [
      path.join(repositoryRoot, "scripts", "stage1-checkpoint.mjs"), "--root", output,
      "--checkpoint", "CKPT-000", "--at", "2026-01-01T00:00:00Z",
    ]);
    const receiptDeclaration = JSON.parse(checkpoint.stdout);
    const initialCheckpointBytes = await readFile(path.join(output, "initial-plan.sha256"));
    const launch = launchResult.launch;
    const submission = {
      schemaVersion: "1.0", protocolVersion: "4.0", status: "partial", launchId: launch.id, taskPacket: launch.taskPacket,
      executionContractDigest: launch.executionContractDigest, promptSha256: launch.promptSha256, launchDigest: launch.launchDigest, fairnessFingerprint: launch.fairnessFingerprint,
      model: { provider: "fixture", name: "fixture", version: "1" },
      initialPlan: { path: "plan.json", sha256: sha256(planBytes) }, initialPlanCheckpoint: { path: "initial-plan.sha256", sha256: sha256(initialCheckpointBytes) },
      workRecord: { path: "work-record.json", sha256: sha256(workBytes) },
      checkpointReceipts: [receiptDeclaration],
      partialAttainment: { attemptedCheckpointIds: ["CKPT-000"], completedCheckpointIds: ["CKPT-000"], highestVerifiedCheckpointId: "CKPT-000", stoppedReason: "candidate-stop" },
      sanitizationRequest: {
        profileDigest: launch.v4Contract.sanitizationProfile.digest,
      },
      v4Contract: launch.v4Contract, artifacts: [],
    };
    await writeJson(path.join(output, "submission.json"), submission);
    const v4Bundle = await validateCandidateBundle(output);
    assert.equal(v4Bundle.status, "valid", v4Bundle.issues.join("\n"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
