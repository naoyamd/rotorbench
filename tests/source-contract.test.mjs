import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import {
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";
import {
  bundleTreeHash,
  computeFairnessFingerprint,
  isSafeRelativePath,
  manifestDigest,
  validateArtifact,
  validateBenchmark,
  validateCohort,
  validateFramework,
  validateLaunch,
  validatePlan,
  validateRun,
  validateSubmission,
  validateTaskPacket,
  validateWorkRecord,
} from "../scripts/framework-lib.mjs";
import { validateCandidateBundle } from "../scripts/stage-contract.mjs";
import {
  MODEL_LAUNCH_MESSAGE,
  MODEL_TASK_PROMPT,
  PUBLISH_LAUNCH_MESSAGE,
  PUBLISH_TASK_PROMPT,
  STAGE0_AUTHOR_HANDOFF,
  STAGE0_COORDINATOR_HANDOFF,
  STAGE0_RELEASE_HANDOFF,
  STAGE0_REVIEW_HANDOFF,
  buildLaunchPrompt,
} from "../shared/prompts.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const normalizedTextDigest = (value) => digest(value.replace(/\r\n?/g, "\n"));

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "engineering-benchmark-"));
  for (const name of ["benchmarks", "task-packets", "launches", "cohorts", "runs"]) {
    await mkdir(path.join(root, name), { recursive: true });
  }
  return root;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function benchmark() {
  return {
    schemaVersion: "1.0",
    id: "neutral-benchmark",
    title: "Neutral fixture",
    status: "active",
    version: "1.0",
    extensions: {},
  };
}

async function writeProtocolFixture(
  root,
  launchId = "neutral-launch",
  requiredOutputs = ["supporting"],
  candidateIds = ["candidate-a"],
) {
  const taskText = "Fixture protocol task. No real engineering design is performed.";
  const packet = {
    schemaVersion: "1.0",
    id: "neutral-benchmark",
    version: "1.0",
    title: "Protocol-only fixture",
    instructions: { path: "TASK.md", sha256: digest(taskText) },
    inputs: [],
    requiredOutputs,
    environment: { baseline: "fixture", cad: "fixture", stepPipeline: "fixture" },
    completionCriteria: ["Produce protocol evidence only"],
  };
  const launch = {
    schemaVersion: "1.0",
    id: launchId,
    protocolVersion: "2.0",
    taskPacket: { id: packet.id, version: packet.version, digest: manifestDigest(packet) },
    baselineCommit: "0".repeat(40),
    workspaceDigest: "1".repeat(64),
    outputRoot: "candidate-output",
    startAction: "checkpoint-initial-plan",
    stopConditions: ["A declared input is missing or its hash differs"],
    fairnessFingerprint: "",
  };
  launch.fairnessFingerprint = computeFairnessFingerprint(launch);
  const cohort = {
    schemaVersion: "1.0",
    id: "neutral-cohort",
    openedAt: "2026-07-29T00:00:00Z",
    launchId: launch.id,
    fairnessFingerprint: launch.fairnessFingerprint,
    status: "open",
    candidateIds,
    extensions: {},
  };
  await writeJson(path.join(root, "benchmarks", packet.id, "benchmark.json"), benchmark());
  await mkdir(path.join(root, "task-packets", packet.id), { recursive: true });
  await writeFile(path.join(root, "task-packets", packet.id, "TASK.md"), taskText);
  await writeJson(path.join(root, "task-packets", packet.id, "packet.json"), packet);
  await writeJson(path.join(root, "launches", launch.id, "launch.json"), launch);
  await writeJson(path.join(root, "legacy-v2-grandfather.json"), {
    schemaVersion: "1.0",
    status: "immutable",
    entries: [{
      taskPacket: {
        id: packet.id,
        version: packet.version,
        digest: manifestDigest(packet),
      },
      launch: {
        id: launch.id,
        fairnessFingerprint: launch.fairnessFingerprint,
      },
    }],
  });
  await writeJson(path.join(root, "cohorts", cohort.id, "cohort.json"), cohort);
  return { packet, launch, cohort, taskText };
}

async function writeCandidateBundle(root, protocol) {
  const output = path.join(root, "candidate-output");
  const plan = {
    schemaVersion: "1.0",
    status: "initial",
    requirements: [{ id: "REQ-001", source: "fixture", statement: "Produce protocol evidence" }],
    assumptions: [],
    steps: [{ id: "STEP-001", statement: "Create the protocol artifact", requirementRefs: ["REQ-001"] }],
    alternativesToEvaluate: [{ id: "ALT-001", question: "Which evidence encoding is inspectable?", requirementRefs: ["REQ-001"] }],
    verificationPlan: [{ id: "VER-001", requirementRefs: ["REQ-001"], method: "Hash comparison", expectedEvidence: "Matching SHA-256" }],
  };
  const workRecord = {
    schemaVersion: "1.0",
    alternatives: [{ id: "ALT-001", description: "Plain text evidence", disposition: "selected" }],
    decisions: [{ id: "DEC-001", requirementRefs: ["REQ-001"], alternativeRefs: ["ALT-001"], choice: "plain text", rationale: "inspectable", tradeoffs: "minimal fixture only" }],
    planRevisions: [],
    verificationClaims: [{ id: "CLAIM-001", requirementRefs: ["REQ-001"], method: "Hash comparison", result: "pass", evidenceArtifactRefs: ["protocol-evidence"] }],
  };
  const evidence = "protocol evidence";
  const planText = `${JSON.stringify(plan, null, 2)}\n`;
  const checkpointText = `${digest(planText)}  plan.json\n`;
  const recordText = `${JSON.stringify(workRecord, null, 2)}\n`;
  await mkdir(path.join(output, "artifacts"), { recursive: true });
  await writeFile(path.join(output, "plan.json"), planText);
  await writeFile(path.join(output, "initial-plan.sha256"), checkpointText);
  await writeFile(path.join(output, "work-record.json"), recordText);
  await writeFile(path.join(output, "artifacts", "evidence.txt"), evidence);
  const submission = {
    schemaVersion: "1.0",
    protocolVersion: "2.0",
    status: "complete",
    launchId: protocol.launch.id,
    taskPacket: {
      id: protocol.packet.id,
      version: protocol.packet.version,
      digest: manifestDigest(protocol.packet),
    },
    fairnessFingerprint: protocol.launch.fairnessFingerprint,
    model: { provider: "unknown", name: "unknown", version: "unknown" },
    initialPlan: { path: "plan.json", sha256: digest(planText) },
    initialPlanCheckpoint: {
      path: "initial-plan.sha256",
      sha256: digest(checkpointText),
    },
    workRecord: { path: "work-record.json", sha256: digest(recordText) },
    artifacts: [{
      id: "protocol-evidence",
      role: "supporting",
      path: "artifacts/evidence.txt",
      sha256: digest(evidence),
      status: "present",
    }],
  };
  await writeJson(path.join(output, "submission.json"), submission);
  return { output, submission, plan, checkpointText, workRecord };
}

function validRun(protocol, bundleHash, submission) {
  return {
    schemaVersion: "1.0",
    id: "candidate-a",
    benchmarkId: protocol.packet.id,
    benchmarkVersion: protocol.packet.version,
    launchId: protocol.launch.id,
    cohortId: protocol.cohort.id,
    taskPacketDigest: protocol.launch.taskPacket.digest,
    fairnessFingerprint: protocol.launch.fairnessFingerprint,
    status: "validated",
    submittedAt: "2026-01-01T00:00:00Z",
    model: submission.model,
    seal: { sealed: true, bundlePath: "submitted", bundleSha256: bundleHash, algorithm: "sha256-tree-v1" },
    processEvidence: {
      initialPlan: { path: "submitted/plan.json", sha256: submission.initialPlan.sha256 },
      workRecord: { path: "submitted/work-record.json", sha256: submission.workRecord.sha256 },
    },
    artifacts: submission.artifacts.map((artifact) => ({ ...artifact, path: `submitted/${artifact.path}` })),
    extensions: {},
  };
}

test("all Stage 1, Stage 2, and publication schemas compile and reject unknown fields", async () => {
  const schemaNames = [
    "artifact.schema.json",
    "benchmark.schema.json",
    "task-packet.schema.json",
    "launch.schema.json",
    "cohort.schema.json",
    "measurement-conditions.schema.json",
    "cohort-disclosure.schema.json",
    "cohort-evaluation-aggregate.schema.json",
    "plan.schema.json",
    "work-record.schema.json",
    "submission.schema.json",
    "run.schema.json",
    "validation-report.schema.json",
    "stage0-task-definition.schema.json",
    "task-packet-lock.schema.json",
    "execution-profile.schema.json",
    "baseline-attestation.schema.json",
    "engineering-review.schema.json",
    "protocol-review.schema.json",
    "launch-release.schema.json",
    "live-verification.schema.json",
  ];
  for (const name of schemaNames) {
    const schema = JSON.parse(await readFile(path.join(projectRoot, "schemas", name), "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const bundleHash = await bundleTreeHash(bundle.output);
    assert.deepEqual(validateBenchmark(benchmark()), []);
    assert.deepEqual(validateTaskPacket(protocol.packet), []);
    assert.deepEqual(validateLaunch(protocol.launch), []);
    assert.deepEqual(validateCohort(protocol.cohort), []);
    assert.deepEqual(validatePlan(bundle.plan), []);
    assert.deepEqual(validateWorkRecord(bundle.workRecord), []);
    assert.deepEqual(validateSubmission(bundle.submission), []);
    assert.deepEqual(validateRun(validRun(protocol, bundleHash, bundle.submission)), []);
    assert.ok(validateLaunch({ ...protocol.launch, unexpected: true }).length > 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("schema-invalid cohort members are reported without crashing validation", async () => {
  const root = await fixtureRoot();
  try {
    await writeJson(path.join(root, "cohorts", "invalid-cohort", "cohort.json"), {
      schemaVersion: "1.0",
      id: "invalid-cohort",
      launchId: "missing-launch",
      fairnessFingerprint: "0".repeat(64),
      status: "published",
      candidateIds: {},
      extensions: {},
    });
    const validation = await validateFramework(root);
    assert.ok(
      validation.issues.some(
        (issue) => issue.scope === "cohorts/invalid-cohort",
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("safe artifact paths reject traversal and URL-dangerous characters", () => {
  const artifact = {
    id: "path-contract",
    role: "supporting",
    path: "artifacts/design.step",
    sha256: digest("path"),
    status: "present",
  };
  assert.deepEqual(validateArtifact(artifact), []);
  for (const unsafe of ["../design.step", "/design.step", ".hidden", "files/.hidden", "files\\design.step", "files/model?.step"]) {
    assert.equal(isSafeRelativePath(unsafe), false, unsafe);
    assert.ok(validateArtifact({ ...artifact, path: unsafe }).length > 0);
  }
});

test("empty catalogs remain valid and contain no hidden engineering task", async () => {
  const root = await fixtureRoot();
  try {
    const result = await validateFramework(root);
    assert.deepEqual(result.issues, []);
    assert.equal(result.benchmarks.length, 0);
    assert.equal(result.taskPackets.length, 0);
    assert.equal(result.launches.length, 0);
    assert.equal(result.cohorts.length, 0);
    assert.equal(result.runs.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a launch is self-contained, fail-closed, and identity-neutral", async () => {
  const root = await fixtureRoot();
  try {
    const first = await writeProtocolFixture(root, "launch-a");
    const second = { ...first.launch, id: "launch-b" };
    assert.equal(computeFairnessFingerprint(first.launch), computeFairnessFingerprint(second));
    const prompt = buildLaunchPrompt(first.launch, { ...first.packet, instructionsText: first.taskText });
    for (const required of [
      first.packet.id,
      first.launch.taskPacket.digest,
      first.launch.baselineCommit,
      first.launch.workspaceDigest,
      "candidate-output/plan.json",
      "candidate-output/work-record.json",
      "candidate-output/submission.json",
      "only in `submission.json.model`",
      "Do not clone or modify RotorBench",
    ]) assert.match(prompt, new RegExp(required.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    const broken = structuredClone(first.launch);
    broken.taskPacket.digest = "f".repeat(64);
    await writeJson(path.join(root, "launches", "launch-a", "launch.json"), broken);
    const result = await validateFramework(root);
    assert.ok(result.issues.some((issue) => issue.code === "task-packet-digest-mismatch"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate bundle validation traces requirements through decisions and evidence", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    assert.equal((await validateCandidateBundle(bundle.output)).status, "valid");
    await writeFile(
      path.join(bundle.output, "initial-plan.sha256"),
      `${"f".repeat(64)}  plan.json\n`,
    );
    assert.ok(
      (await validateCandidateBundle(bundle.output)).issues.some((issue) =>
        issue.includes("does not checkpoint"),
      ),
    );
    await writeFile(
      path.join(bundle.output, "initial-plan.sha256"),
      bundle.checkpointText,
    );
    const record = structuredClone(bundle.workRecord);
    record.verificationClaims[0].requirementRefs = ["REQ-999"];
    const recordText = `${JSON.stringify(record, null, 2)}\n`;
    await writeFile(path.join(bundle.output, "work-record.json"), recordText);
    const submission = { ...bundle.submission, workRecord: { path: "work-record.json", sha256: digest(recordText) } };
    await writeJson(path.join(bundle.output, "submission.json"), submission);
    const invalid = await validateCandidateBundle(bundle.output);
    assert.equal(invalid.status, "invalid");
    assert.ok(invalid.issues.some((issue) => issue.includes("dangling reference REQ-999")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 2 assigns identity and preserves the candidate bundle byte-for-byte", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const sourceHash = await bundleTreeHash(bundle.output);
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "stage2-integrate.mjs"), "--source", bundle.output, "--candidate-id", "candidate-a", "--cohort-id", protocol.cohort.id],
      { cwd: root },
    );
    const copied = path.join(root, "runs", "candidate-a", "submitted");
    assert.equal(await bundleTreeHash(copied), sourceHash);
    const run = JSON.parse(await readFile(path.join(root, "runs", "candidate-a", "run.json"), "utf8"));
    assert.equal(run.id, "candidate-a");
    assert.equal(run.status, "validated");
    assert.equal(run.seal.bundleSha256, sourceHash);
    assert.equal(run.fairnessFingerprint, protocol.launch.fairnessFingerprint);
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
        { cwd: root },
      ),
      /validation report/i,
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "process-step.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    const report = JSON.parse(
      await readFile(
        path.join(root, ".framework-staging", "reports", "candidate-a.json"),
        "utf8",
      ),
    );
    assert.equal(report.status, "valid");
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
      { cwd: root },
    );
    const published = JSON.parse(
      await readFile(path.join(root, "runs", "candidate-a", "run.json"), "utf8"),
    );
    assert.equal(published.status, "published");
    const publishedCohort = JSON.parse(
      await readFile(
        path.join(root, "cohorts", protocol.cohort.id, "cohort.json"),
        "utf8",
      ),
    );
    assert.equal(publishedCohort.status, "published");
    await writeFile(path.join(root, "runs", "candidate-a", "keep.txt"), "preserve");
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(projectRoot, "scripts", "stage2-integrate.mjs"), "--source", bundle.output, "--candidate-id", "candidate-a", "--cohort-id", protocol.cohort.id],
        { cwd: root },
      ),
    );
    assert.equal(
      await readFile(path.join(root, "runs", "candidate-a", "keep.txt"), "utf8"),
      "preserve",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("Stage 2 and framework validation require every task-packet output role", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(
      root,
      "neutral-launch",
      ["cad-source", "step"],
    );
    const bundle = await writeCandidateBundle(root, protocol);
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(projectRoot, "scripts", "stage2-integrate.mjs"), "--source", bundle.output, "--candidate-id", "candidate-a", "--cohort-id", protocol.cohort.id],
        { cwd: root },
      ),
      /missing required output role/i,
    );
    const runRoot = path.join(root, "runs", "candidate-a");
    await cp(bundle.output, path.join(runRoot, "submitted"), { recursive: true });
    const bundleHash = await bundleTreeHash(path.join(runRoot, "submitted"));
    await writeJson(
      path.join(runRoot, "run.json"),
      validRun(protocol, bundleHash, bundle.submission),
    );
    const validation = await validateFramework(root);
    const missingRoles = validation.issues
      .filter((issue) => issue.code === "missing-required-output")
      .map((issue) => issue.message);
    assert.equal(missingRoles.length, 2);
    assert.ok(missingRoles.some((message) => message.includes("cad-source")));
    assert.ok(missingRoles.some((message) => message.includes("step")));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cohort publication fails closed until every planned member is validated", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(
      root,
      "neutral-launch",
      ["supporting"],
      ["candidate-a", "candidate-b"],
    );
    const bundle = await writeCandidateBundle(root, protocol);
    await execFileAsync(
      process.execPath,
      [
        path.join(projectRoot, "scripts", "stage2-integrate.mjs"),
        "--source",
        bundle.output,
        "--candidate-id",
        "candidate-a",
        "--cohort-id",
        protocol.cohort.id,
      ],
      { cwd: root },
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "process-step.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
        { cwd: root },
      ),
      /candidate-b/i,
    );
    const run = JSON.parse(
      await readFile(path.join(root, "runs", "candidate-a", "run.json"), "utf8"),
    );
    const cohort = JSON.parse(
      await readFile(
        path.join(root, "cohorts", protocol.cohort.id, "cohort.json"),
        "utf8",
      ),
    );
    assert.equal(run.status, "validated");
    assert.equal(cohort.status, "open");
    await assert.rejects(
      readFile(path.join(root, "runs", "candidate-a", "publication-report.json")),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a complete two-member cohort publishes and enters the catalog together", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(
      root,
      "neutral-launch",
      ["supporting"],
      ["candidate-a", "candidate-b"],
    );
    const bundles = [
      ["candidate-a", await writeCandidateBundle(path.join(root, "work-a"), protocol)],
      ["candidate-b", await writeCandidateBundle(path.join(root, "work-b"), protocol)],
    ];
    for (const [candidateId, bundle] of bundles) {
      await execFileAsync(
        process.execPath,
        [
          path.join(projectRoot, "scripts", "stage2-integrate.mjs"),
          "--source",
          bundle.output,
          "--candidate-id",
          candidateId,
          "--cohort-id",
          protocol.cohort.id,
        ],
        { cwd: root },
      );
    }
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "process-step.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
      { cwd: root },
    );
    for (const candidateId of ["candidate-a", "candidate-b"]) {
      const run = JSON.parse(
        await readFile(path.join(root, "runs", candidateId, "run.json"), "utf8"),
      );
      assert.equal(run.status, "published");
      assert.equal(run.cohortId, protocol.cohort.id);
      assert.match(run.publicationReport.sha256, /^[a-f0-9]{64}$/);
    }
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    const catalog = JSON.parse(
      await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"),
    );
    assert.deepEqual(
      catalog.runs.map(({ id }) => id),
      ["candidate-a", "candidate-b"],
    );
    assert.deepEqual(
      catalog.cohorts[0].candidateIds,
      ["candidate-a", "candidate-b"],
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("cohort validation rejects duplicate membership and launch fingerprint drift", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    await writeJson(
      path.join(root, "cohorts", "second-cohort", "cohort.json"),
      {
        ...protocol.cohort,
        id: "second-cohort",
        fairnessFingerprint: "f".repeat(64),
      },
    );
    const validation = await validateFramework(root);
    assert.ok(validation.issues.some(
      (issue) => issue.code === "duplicate-cohort-member",
    ));
    assert.ok(validation.issues.some(
      (issue) =>
        issue.scope === "cohorts/second-cohort"
        && issue.code === "cohort-fingerprint-mismatch",
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("invalid task packets propagate through launches into dependent runs", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const runRoot = path.join(root, "runs", "candidate-a");
    await cp(bundle.output, path.join(runRoot, "submitted"), { recursive: true });
    const bundleHash = await bundleTreeHash(path.join(runRoot, "submitted"));
    await writeJson(
      path.join(runRoot, "run.json"),
      validRun(protocol, bundleHash, bundle.submission),
    );
    await writeFile(
      path.join(root, "task-packets", protocol.packet.id, "TASK.md"),
      "corrupted task packet",
    );
    const validation = await validateFramework(root);
    assert.ok(validation.issues.some(
      (issue) =>
        issue.scope === `launches/${protocol.launch.id}`
        && issue.code === "invalid-task-packet",
    ));
    assert.ok(validation.issues.some(
      (issue) =>
        issue.scope === "runs/candidate-a"
        && issue.code === "invalid-launch",
    ));
    assert.ok(validation.issues.some(
      (issue) =>
        issue.scope === "runs/candidate-a"
        && issue.code === "invalid-task-packet",
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("task-packet files cannot escape through an intermediate directory link", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const outside = path.join(root, "outside-packet");
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, "TASK.md"), protocol.taskText);
    const packetRoot = path.join(root, "task-packets", protocol.packet.id);
    await symlink(outside, path.join(packetRoot, "linked"), "junction");
    const linkedPacket = structuredClone(protocol.packet);
    linkedPacket.instructions.path = "linked/TASK.md";
    await writeJson(path.join(packetRoot, "packet.json"), linkedPacket);
    const validation = await validateFramework(root);
    assert.ok(validation.issues.some(
      (issue) =>
        issue.scope === `task-packets/${protocol.packet.id}`
        && issue.code === "file-escape",
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("framework validation rejects an altered seal and accepts a complete sealed run", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const runRoot = path.join(root, "runs", "candidate-a");
    await cp(bundle.output, path.join(runRoot, "submitted"), { recursive: true });
    const bundleHash = await bundleTreeHash(path.join(runRoot, "submitted"));
    const run = validRun(protocol, bundleHash, bundle.submission);
    await writeJson(path.join(runRoot, "run.json"), run);
    assert.deepEqual((await validateFramework(root)).issues, []);
    run.seal.bundleSha256 = "f".repeat(64);
    await writeJson(path.join(runRoot, "run.json"), run);
    assert.ok((await validateFramework(root)).issues.some((issue) => issue.code === "bundle-seal-mismatch"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("framework validation binds run paths and metadata to the sealed submission", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const runRoot = path.join(root, "runs", "candidate-a");
    const submittedRoot = path.join(runRoot, "submitted");
    await cp(bundle.output, submittedRoot, { recursive: true });
    const originalRun = validRun(
      protocol,
      await bundleTreeHash(submittedRoot),
      bundle.submission,
    );
    await writeJson(path.join(runRoot, "run.json"), originalRun);

    const outsideArtifact = structuredClone(originalRun);
    outsideArtifact.artifacts[0].path = "outside/evidence.txt";
    await mkdir(path.join(runRoot, "outside"), { recursive: true });
    await writeFile(path.join(runRoot, "outside", "evidence.txt"), "protocol evidence");
    await writeJson(path.join(runRoot, "run.json"), outsideArtifact);
    assert.ok((await validateFramework(root)).issues.some(
      (issue) => issue.code === "artifact-outside-sealed-bundle",
    ));

    const outsideProcess = structuredClone(originalRun);
    outsideProcess.processEvidence.initialPlan.path = "outside/plan.json";
    await writeFile(
      path.join(runRoot, "outside", "plan.json"),
      `${JSON.stringify(bundle.plan, null, 2)}\n`,
    );
    await writeJson(path.join(runRoot, "run.json"), outsideProcess);
    assert.ok((await validateFramework(root)).issues.some(
      (issue) => issue.code === "process-evidence-outside-sealed-bundle",
    ));

    const changedMetadata = structuredClone(originalRun);
    changedMetadata.model.name = "rewritten-after-seal";
    changedMetadata.artifacts[0].sha256 = "f".repeat(64);
    changedMetadata.processEvidence.initialPlan.sha256 = "e".repeat(64);
    await writeJson(path.join(runRoot, "run.json"), changedMetadata);
    const metadataIssues = (await validateFramework(root)).issues;
    assert.ok(metadataIssues.some((issue) => issue.code === "sealed-submission-model-mismatch"));
    assert.ok(metadataIssues.some((issue) => issue.code === "sealed-submission-artifacts-mismatch"));
    assert.ok(metadataIssues.some((issue) => issue.code === "sealed-submission-process-mismatch"));

    const bogusCheckpoint = `${"f".repeat(64)}  plan.json\n`;
    await writeFile(path.join(submittedRoot, "initial-plan.sha256"), bogusCheckpoint);
    const changedSubmission = structuredClone(bundle.submission);
    changedSubmission.initialPlanCheckpoint.sha256 = digest(bogusCheckpoint);
    await writeJson(path.join(submittedRoot, "submission.json"), changedSubmission);
    const checkpointRun = validRun(
      protocol,
      await bundleTreeHash(submittedRoot),
      changedSubmission,
    );
    await writeJson(path.join(runRoot, "run.json"), checkpointRun);
    assert.ok((await validateFramework(root)).issues.some(
      (issue) => issue.code === "initial-plan-checkpoint-mismatch",
    ));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the public catalog excludes valid but unpublished runs", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const runRoot = path.join(root, "runs", "candidate-a");
    await cp(bundle.output, path.join(runRoot, "submitted"), { recursive: true });
    const bundleHash = await bundleTreeHash(path.join(runRoot, "submitted"));
    const run = { ...validRun(protocol, bundleHash, bundle.submission), status: "validated" };
    await writeJson(path.join(runRoot, "run.json"), run);
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    let catalog = JSON.parse(await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"));
    assert.equal(catalog.runs.length, 0);
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "process-step.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    await assert.rejects(
      readFile(path.join(root, "public", "framework", "reports", "candidate-a.json")),
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
      { cwd: root },
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    catalog = JSON.parse(await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"));
    assert.deepEqual(catalog.runs.map(({ id }) => id), ["candidate-a"]);
    const reportPath = path.join(root, ".framework-staging", "reports", "candidate-a.json");
    const report = JSON.parse(await readFile(reportPath, "utf8"));
    report.status = "invalid";
    await writeJson(reportPath, report);
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    catalog = JSON.parse(await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"));
    assert.deepEqual(catalog.runs.map(({ id }) => id), ["candidate-a"]);
    assert.equal(catalog.runs[0].validation.status, "invalid");
    await writeFile(path.join(runRoot, "publication-report.json"), "{}");
    assert.ok((await validateFramework(root)).issues.some(
      (issue) => issue.code === "invalid-publication-report",
    ));
    await assert.rejects(
      execFileAsync(
        process.execPath,
        [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
        { cwd: projectRoot },
      ),
      /publication report/i,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("candidate HTML and SVG are published only under inert download names", async () => {
  const root = await fixtureRoot();
  try {
    const protocol = await writeProtocolFixture(root);
    const bundle = await writeCandidateBundle(root, protocol);
    const html = "<script>globalThis.candidateCodeRan = true</script>";
    const svg = "<svg xmlns=\"http://www.w3.org/2000/svg\"><script>globalThis.candidateSvgRan = true</script></svg>";
    await writeFile(path.join(bundle.output, "artifacts", "candidate.html"), html);
    await writeFile(path.join(bundle.output, "artifacts", "candidate.svg"), svg);
    const submission = structuredClone(bundle.submission);
    submission.artifacts = [
      {
        id: "protocol-evidence",
        role: "supporting",
        path: "artifacts/candidate.html",
        sha256: digest(html),
        status: "present",
      },
      {
        id: "candidate-svg",
        role: "supporting",
        path: "artifacts/candidate.svg",
        sha256: digest(svg),
        status: "present",
      },
    ];
    await writeJson(path.join(bundle.output, "submission.json"), submission);
    const runRoot = path.join(root, "runs", "candidate-a");
    const submittedRoot = path.join(runRoot, "submitted");
    await cp(bundle.output, submittedRoot, { recursive: true });
    await writeJson(
      path.join(runRoot, "run.json"),
      validRun(protocol, await bundleTreeHash(submittedRoot), submission),
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "process-step.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "stage2-publish-cohort.mjs"), "--cohort-id", protocol.cohort.id],
      { cwd: root },
    );
    await execFileAsync(
      process.execPath,
      [path.join(projectRoot, "scripts", "build-framework-catalog.mjs"), "--root", root],
      { cwd: projectRoot },
    );
    const catalog = JSON.parse(
      await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"),
    );
    for (const artifact of catalog.runs[0].artifacts) {
      assert.match(artifact.download, /\.download$/);
      assert.doesNotMatch(artifact.download, /\.(?:html|svg)$/i);
    }
    assert.equal(
      await readFile(
        path.join(root, "public", "framework", "files", "candidate-a", "artifacts", "protocol-evidence.download"),
        "utf8",
      ),
      html,
    );
    assert.equal(
      await readFile(
        path.join(root, "public", "framework", "files", "candidate-a", "artifacts", "candidate-svg.download"),
        "utf8",
      ),
      svg,
    );
    await assert.rejects(
      readFile(
        path.join(root, "public", "framework", "files", "candidate-a", "submitted", "artifacts", "candidate.html"),
      ),
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository catalog counts match checked-in non-template content", async () => {
  const contentDirectories = async (name) =>
    (await readdir(path.join(projectRoot, name), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).length;
  const catalog = JSON.parse(await readFile(path.join(projectRoot, "public", "framework", "catalog.json"), "utf8"));
  const framework = await validateFramework(projectRoot);
  assert.equal(catalog.benchmarks.length, await contentDirectories("benchmarks"));
  const publiclyReferencedPackets = new Set(
    catalog.launches.map((launch) => `${launch.taskPacket.id}@${launch.taskPacket.version}`),
  );
  assert.equal(catalog.taskPackets.length, publiclyReferencedPackets.size);
  assert.equal(
    catalog.launches.length,
    framework.launches.filter((launch) => launch.publicEligible).length,
  );
  assert.equal(catalog.cohorts.length, await contentDirectories("cohorts"));
  assert.deepEqual(framework.issues, []);
});

test("legacy material remains byte-identical", async () => {
  const expected = {
    "BENCHMARK_PROMPT.md": "98b503d8747874e973692d5d184c0750177627a5ab2313ed2a62df2865d51f9b",
    "submissions/_template/manifest.json": "899c171709c70384a6432ffc36f955affcd67426cf59e16059df4378d87038e1",
    "submissions/_template/site/index.html": "1b2c852f9b4bcc01f1026cc9da925909b02c9f614b86c36b4bfe5f59c6d11f44",
    "submissions/openai-gpt-5-6-terra-max/manifest.json": "cdb9ce017698030b1c4b95beb701483ff7783a2ca5ce627dbee337d372b1f667",
    "submissions/openai-gpt-5-6-terra-max/site/app.js": "02fc2238e807fe4b5aa0b201ff7c2d07a1b471d7ffb51911e3e7132a088e1643",
    "submissions/openai-gpt-5-6-terra-max/site/index.html": "ca3a573465402655941ada65c532f427f8e377c56cd67fcec7ebc77cda6b9c21",
    "submissions/openai-gpt-5-6-terra-max/site/styles.css": "1455911a561efdb6b118feeb71bdfbd2e344c971ee3b60234384665c79c78975",
  };
  for (const [relativePath, expectedHash] of Object.entries(expected)) {
    assert.equal(normalizedTextDigest(await readFile(path.join(projectRoot, relativePath), "utf8")), expectedHash, relativePath);
  }
});

test("operator contracts enforce the three-stage boundary", async () => {
  const [model, publish] = await Promise.all([
    readFile(path.join(projectRoot, "MODEL_TASK.md"), "utf8"),
    readFile(path.join(projectRoot, "PUBLISH_TASK.md"), "utf8"),
  ]);
  assert.match(model, /EDBF-STAGE1-4\.0/);
  assert.match(model, /no placeholders/i);
  assert.match(model, /candidate-output\//);
  assert.match(model, /candidate ID/);
  assert.match(model, /stage1:prepare-workspace/);
  assert.match(model, /receiptSha256/);
  assert.match(model, /external-run-configuration-sha256/);
  assert.match(MODEL_LAUNCH_MESSAGE, /このタスクに対する私の指示として実行/);
  assert.match(MODEL_TASK_PROMPT, /launch-bound isolated workspace/);
  assert.match(MODEL_TASK_PROMPT, /opaque three-run assignments/);
  assert.match(publish, /EDBF-STAGE2-4\.0/);
  assert.match(publish, /EVALUATE_TASK\.md/);
  assert.match(publish, /opaque\s+run\s+assignments/);
  assert.match(publish, /stage2:publish-cohort/);
  /* Legacy Japanese launcher assertions target the retired v3 handoff. */
  /*
  assert.match(PUBLISH_LAUNCH_MESSAGE, /このタスクに対する私の指示として実行/);
  assert.match(PUBLISH_LAUNCH_MESSAGE, /予定候補と完成済み成果/);
  */
  assert.match(PUBLISH_LAUNCH_MESSAGE, /evaluate-task/);
  assert.match(PUBLISH_TASK_PROMPT, /identity-blind independent engineering/);
  assert.match(PUBLISH_TASK_PROMPT, /complete cohort atomically/);
  for (const contract of [
    STAGE0_COORDINATOR_HANDOFF,
    STAGE0_AUTHOR_HANDOFF,
    STAGE0_REVIEW_HANDOFF,
    STAGE0_RELEASE_HANDOFF,
  ]) {
    assert.match(contract, /A URL alone is not an instruction/);
  }
  assert.match(STAGE0_AUTHOR_HANDOFF, /Do not solve the engineering task/);
  assert.match(STAGE0_REVIEW_HANDOFF, /without editing them/);
  assert.match(STAGE0_RELEASE_HANDOFF, /APPROVE RELEASE <launch-digest>/);
});

test("official entrypoints invoke only the launch-frozen execution contract", async () => {
  const packageJson = await readFile(path.join(projectRoot, "package.json"), "utf8");
  const scripts = JSON.parse(packageJson).scripts;
  const officialCommands = [
    "stage1:prepare-workspace",
    "stage1:authorize-run",
    "stage2:integrate",
    "stage2:open-cohort",
    "stage2:sanitize",
    "stage2:prepare-review",
    "stage2:seal-review",
    "stage2:finalize-evaluation",
    "stage2:publish-cohort",
    "stage2:export-publication",
    "evaluation:score",
    "evaluation:aggregate",
  ];
  for (const name of officialCommands) {
    assert.match(
      scripts[name],
      /^node launches\/integrated-robotic-handling-v1\/execution-contract\/scripts\/[a-z0-9-]+\.mjs$/,
      name,
    );
    assert.doesNotMatch(scripts[name], /-runner\.mjs$/, name);
  }
});

test("official integration binds the submitted workspace receipt to pre-run authorization", async () => {
  const [authorizeSource, integrateSource, frameworkSource] = await Promise.all([
    readFile(path.join(projectRoot, "scripts", "stage1-authorize-run.mjs"), "utf8"),
    readFile(path.join(projectRoot, "scripts", "stage2-integrate.mjs"), "utf8"),
    readFile(path.join(projectRoot, "scripts", "framework-lib.mjs"), "utf8"),
  ]);
  assert.match(authorizeSource, /candidateWorkspaceReceiptRequired/);
  assert.match(authorizeSource, /externalRunConfigurationSha256/);
  assert.match(integrateSource, /workspace-receipt\.json/);
  assert.match(
    integrateSource,
    /runAuthorization\.externalRunConfigurationSha256/,
  );
  assert.match(integrateSource, /workspaceReceiptBindingIssues/);
  assert.match(frameworkSource, /candidateWorkspaceReceiptSha256/);
  assert.match(frameworkSource, /candidate-workspace-receipt-time-order/);
});

test("launch rendering uses frozen prompt bytes while Stage 1 listing remains live-only", async () => {
  const [launchPage, modelTaskPage] = await Promise.all([
    readFile(path.join(projectRoot, "app", "launch", "[id]", "page.tsx"), "utf8"),
    readFile(path.join(projectRoot, "app", "model-task", "page.tsx"), "utf8"),
  ]);
  assert.match(launchPage, /entry\.launch\.promptText/);
  assert.doesNotMatch(launchPage, /buildLaunchPrompt/);
  assert.match(launchPage, /data-launch-digest/);
  assert.match(launchPage, /data-prompt-sha256/);
  assert.match(launchPage, /Version 4 execution boundary/);
  assert.match(launchPage, /packet-lock\.json/);
  assert.match(modelTaskPage, /releaseStatus.*live-verified/s);
  assert.match(modelTaskPage, /private payloads remain withheld/);
});
