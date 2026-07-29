import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  bundleTreeHash,
  computeFairnessFingerprint,
  manifestDigest,
} from "../scripts/framework-lib.mjs";
import {
  MODEL_LAUNCH_MESSAGE,
  STAGE0_AUTHOR_HANDOFF,
  STAGE0_COORDINATOR_HANDOFF,
  STAGE0_RELEASE_HANDOFF,
  STAGE0_REVIEW_HANDOFF,
  materializeHandoff,
  materializeHandoffValues,
} from "../shared/prompts.mjs";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const defaultSiteUrl = "https://rotorbench-lab.naoyamd.chatgpt.site";

function normalizedBasePath() {
  const value = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

function renderedSitePath(relativePath) {
  const clean = relativePath.replace(/^\/+/, "");
  return `${normalizedBasePath()}/${clean}`.replace(/\/{2,}/g, "/");
}

function renderedAbsoluteUrl(relativePath) {
  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? defaultSiteUrl);
  const basePath = normalizedBasePath();
  const sitePathname = site.pathname.replace(/\/+$/, "");
  const prefix = basePath && sitePathname.endsWith(basePath)
    ? sitePathname
    : `${sitePathname}${basePath}`;
  site.pathname = `${prefix}/${relativePath.replace(/^\/+/, "")}`.replace(
    /\/{2,}/g,
    "/",
  );
  site.search = "";
  site.hash = "";
  return site.toString();
}

function firstPromptBlock(html) {
  const match = html.match(/<pre class="prompt-block"><code>([\s\S]*?)<\/code><\/pre>/);
  assert.ok(match, "prompt block must be rendered");
  return match[1]
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", "\"")
    .replaceAll("&#x27;", "'")
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");
}

async function makeRunFixture(artifact, id = "fixture-run") {
  const root = await mkdtemp(path.join(tmpdir(), "run-fixture-"));
  await mkdir(path.join(root, "benchmarks", "neutral-benchmark"), { recursive: true });
  await mkdir(path.join(root, "task-packets", "neutral-benchmark"), { recursive: true });
  await mkdir(path.join(root, "launches", "neutral-launch"), { recursive: true });
  await mkdir(path.join(root, "cohorts", "fixture-cohort"), { recursive: true });
  await mkdir(path.join(root, "runs", id, "submitted"), { recursive: true });
  const taskText = "Protocol-only rendering fixture";
  await writeFile(
    path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id: "neutral-benchmark",
      title: "Neutral benchmark",
      status: "active",
      version: "1.0",
      extensions: {},
    }),
  );
  await writeFile(path.join(root, "task-packets", "neutral-benchmark", "TASK.md"), taskText);
  const packet = {
    schemaVersion: "1.0",
    id: "neutral-benchmark",
    version: "1.0",
    title: "Neutral benchmark",
    instructions: { path: "TASK.md", sha256: digest(taskText) },
    inputs: [],
    requiredOutputs: [artifact.role],
    environment: { baseline: "fixture", cad: "fixture", stepPipeline: "fixture" },
    completionCriteria: ["Fixture complete"],
  };
  await writeFile(
    path.join(root, "task-packets", "neutral-benchmark", "packet.json"),
    JSON.stringify(packet),
  );
  const launch = {
    schemaVersion: "1.0",
    id: "neutral-launch",
    protocolVersion: "2.0",
    taskPacket: { id: packet.id, version: packet.version, digest: manifestDigest(packet) },
    baselineCommit: "0".repeat(40),
    workspaceDigest: "1".repeat(64),
    outputRoot: "candidate-output",
    startAction: "checkpoint-initial-plan",
    stopConditions: ["Declared input unavailable"],
    fairnessFingerprint: "",
  };
  launch.fairnessFingerprint = computeFairnessFingerprint(launch);
  await writeFile(
    path.join(root, "launches", "neutral-launch", "launch.json"),
    JSON.stringify(launch),
  );
  await writeFile(
    path.join(root, "legacy-v2-grandfather.json"),
    JSON.stringify({
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
    }),
  );
  await writeFile(
    path.join(root, "cohorts", "fixture-cohort", "cohort.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id: "fixture-cohort",
      openedAt: "2026-07-29T00:00:00Z",
      launchId: launch.id,
      fairnessFingerprint: launch.fairnessFingerprint,
      status: "open",
      candidateIds: [id],
      extensions: {},
    }),
  );
  const plan = Buffer.from(JSON.stringify({
    schemaVersion: "1.0",
    status: "initial",
    requirements: [{ id: "REQ-001", source: "fixture", statement: "Render fixture" }],
    assumptions: [],
    steps: [{ id: "STEP-001", statement: "Process artifact", requirementRefs: ["REQ-001"] }],
    alternativesToEvaluate: [],
    verificationPlan: [{ id: "VER-001", requirementRefs: ["REQ-001"], method: "processor", expectedEvidence: "report" }],
  }));
  const record = Buffer.from(JSON.stringify({
    schemaVersion: "1.0",
    alternatives: [],
    decisions: [],
    planRevisions: [],
    verificationClaims: [{ id: "CLAIM-001", requirementRefs: ["REQ-001"], method: "processor", result: "pass", evidenceArtifactRefs: [artifact.id] }],
  }));
  await writeFile(path.join(root, "runs", id, "submitted", "plan.json"), plan);
  const checkpoint = Buffer.from(`${digest(plan)}  plan.json\n`);
  await writeFile(
    path.join(root, "runs", id, "submitted", "initial-plan.sha256"),
    checkpoint,
  );
  await writeFile(path.join(root, "runs", id, "submitted", "work-record.json"), record);
  const target = path.join(root, "runs", id, "submitted", artifact.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, artifact.contents);
  const submission = {
    schemaVersion: "1.0",
    protocolVersion: "2.0",
    status: "complete",
    launchId: launch.id,
    taskPacket: launch.taskPacket,
    fairnessFingerprint: launch.fairnessFingerprint,
    model: { provider: "Provider", name: "Model", version: "Version" },
    initialPlan: { path: "plan.json", sha256: digest(plan) },
    initialPlanCheckpoint: {
      path: "initial-plan.sha256",
      sha256: digest(checkpoint),
    },
    workRecord: { path: "work-record.json", sha256: digest(record) },
    artifacts: [{
      id: artifact.id,
      role: artifact.role,
      path: artifact.path,
      sha256: digest(artifact.contents),
      status: "present",
    }],
  };
  await writeFile(
    path.join(root, "runs", id, "submitted", "submission.json"),
    JSON.stringify(submission),
  );
  const bundleHash = await bundleTreeHash(path.join(root, "runs", id, "submitted"));
  await writeFile(
    path.join(root, "runs", id, "run.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id,
      benchmarkId: "neutral-benchmark",
      benchmarkVersion: "1.0",
      launchId: "neutral-launch",
      cohortId: "fixture-cohort",
      taskPacketDigest: launch.taskPacket.digest,
      fairnessFingerprint: launch.fairnessFingerprint,
      status: "validated",
      submittedAt: "2026-01-01T00:00:00Z",
      model: { provider: "Provider", name: "Model", version: "Version" },
      seal: { sealed: true, bundlePath: "submitted", bundleSha256: bundleHash, algorithm: "sha256-tree-v1" },
      processEvidence: {
        initialPlan: { path: "submitted/plan.json", sha256: digest(plan) },
        workRecord: { path: "submitted/work-record.json", sha256: digest(record) },
      },
      artifacts: [{
        id: artifact.id,
        role: artifact.role,
        path: `submitted/${artifact.path}`,
        sha256: digest(artifact.contents),
        status: "present",
      }],
      extensions: {},
    }),
  );
  return root;
}

async function runScript(script, root) {
  return execFileAsync(process.execPath, [script, "--root", root], {
    cwd: projectRoot,
    maxBuffer: 1024 * 1024 * 10,
  });
}

test("a broken STEP produces a complete failed report without failing the processor", async () => {
  const root = await makeRunFixture({
    id: "model",
    role: "step",
    path: "files/model.step",
    contents: "not a STEP file",
  });
  try {
    await runScript("scripts/process-step.mjs", root);
    const report = JSON.parse(await readFile(path.join(root, ".framework-staging", "reports", "fixture-run.json"), "utf8"));
    const metadata = JSON.parse(await readFile(path.join(root, ".framework-staging", "meshes", "fixture-run", "model.metadata.json"), "utf8"));
    assert.equal(report.status, "invalid");
    assert.equal(report.processor.stepEngine, "occt-import-js@0.0.23");
    assert.ok(report.checks.some((item) => item.name === "Run manifest" && item.status === "pass"));
    assert.ok(report.checks.some((item) => item.name === "Path model" && item.status === "pass"));
    assert.ok(report.checks.some((item) => item.name === "Hash model" && item.inputSha256));
    assert.ok(report.checks.some((item) => item.name === "STEP model" && item.status === "fail"));
    assert.equal(metadata.status, "failed");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a valid STEP catalog points to an existing public viewer mesh", async () => {
  const cube = path.join(
    projectRoot,
    "node_modules",
    "occt-import-js",
    "test",
    "testfiles",
    "simple-basic-cube",
    "cube.stp",
  );
  const root = await makeRunFixture({
    id: "model",
    role: "step",
    path: "files/model.step",
    contents: await readFile(cube),
  });
  try {
    await runScript("scripts/process-step.mjs", root);
    await execFileAsync(
      process.execPath,
      [
        "scripts/stage2-publish-cohort.mjs",
        "--cohort-id",
        "fixture-cohort",
        "--root",
        root,
      ],
      { cwd: projectRoot },
    );
    await runScript("scripts/build-framework-catalog.mjs", root);
    const catalog = JSON.parse(await readFile(path.join(root, "public", "framework", "catalog.json"), "utf8"));
    const viewer = catalog.runs[0].artifacts[0].viewer;
    assert.equal(viewer.status, "ready");
    assert.equal(viewer.mesh, "framework/meshes/fixture-run/model.mesh.json");
    await stat(path.join(root, "public", ...viewer.mesh.split("/")));
    const report = catalog.runs[0].validation;
    const stepCheck = report.checks.find((item) => item.name === "STEP model");
    assert.match(stepCheck.inputSha256, /^[a-f0-9]{64}$/);
    assert.match(stepCheck.derivedSha256, /^[a-f0-9]{64}$/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("a non-STEP run still receives manifest, path, and hash checks", async () => {
  const root = await makeRunFixture({
    id: "note",
    role: "supporting",
    path: "files/note.txt",
    contents: "neutral evidence",
  });
  try {
    await runScript("scripts/process-step.mjs", root);
    const report = JSON.parse(await readFile(path.join(root, ".framework-staging", "reports", "fixture-run.json"), "utf8"));
    assert.equal(report.status, "valid");
    assert.ok(report.checks.length >= 4);
    assert.ok(report.checks.some((item) => item.name === "Hash note" && item.status === "pass"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("static export counts match the generated catalog and preserves every legacy URL", async () => {
  const home = await readFile(path.join(projectRoot, "out", "index.html"), "utf8");
  const catalog = JSON.parse(await readFile(path.join(projectRoot, "public", "framework", "catalog.json"), "utf8"));
  assert.match(home, /Engineering Design Benchmark Framework/);
  assert.match(home, new RegExp(`<strong>${catalog.benchmarks.length}</strong><span>BENCHMARKS</span>`));
  assert.match(home, new RegExp(`<strong>${catalog.launches.length}</strong><span>LAUNCHES</span>`));
  assert.match(home, new RegExp(`<strong>${catalog.runs.length}</strong><span>PUBLISHED RUNS</span>`));
  for (const route of [
    "benchmarks",
    "format",
    "compare",
    "legacy",
    "stage0",
    "stage0/author",
    "stage0/review",
    "stage0/release",
    "model-task",
    "publish-task",
  ]) {
    await readFile(path.join(projectRoot, "out", route, "index.html"), "utf8");
  }
  for (const benchmark of catalog.benchmarks) {
    await readFile(path.join(projectRoot, "out", "benchmarks", benchmark.id, "index.html"), "utf8");
  }
  for (const launch of catalog.launches) {
    await readFile(path.join(projectRoot, "out", "launch", launch.id, "index.html"), "utf8");
  }
  for (const run of catalog.runs) {
    await readFile(path.join(projectRoot, "out", "runs", run.id, "index.html"), "utf8");
  }
  const legacy = JSON.parse(await readFile(path.join(projectRoot, "public", "results", "catalog.json"), "utf8"));
  for (const entry of legacy.results) {
    await readFile(path.join(projectRoot, "out", "results", entry.id, "index.html"), "utf8");
  }
  await assert.rejects(readFile(path.join(projectRoot, "out", "runs", "__framework-empty__", "index.html"), "utf8"));
  await assert.rejects(readFile(path.join(projectRoot, "out", "benchmarks", "__framework-empty__", "index.html"), "utf8"));
  await assert.rejects(readFile(path.join(projectRoot, "out", "launch", "__framework-empty__", "index.html"), "utf8"));
  const layout = await readFile(path.join(projectRoot, "app", "layout.tsx"), "utf8");
  assert.match(layout, /https:\/\/rotorbench-lab\.naoyamd\.chatgpt\.site/);
  assert.doesNotMatch(layout, /og-engineering-framework\.png/);
  assert.ok(home.includes(renderedAbsoluteUrl("engineering-benchmark-og.png")));
  assert.doesNotMatch(home, /\/rotorbench\/rotorbench\/og-stage0\.png/);
  await assert.rejects(
    stat(path.join(projectRoot, "public", "og-engineering-framework.png")),
  );
});

test("Stage 0 pages render the exact shared contracts and no task content", async () => {
  const pages = [
    {
      route: "stage0",
      expected: materializeHandoffValues(STAGE0_COORDINATOR_HANDOFF, {
        "<stage0-url>": renderedAbsoluteUrl("stage0/"),
        "<stage0-author-url>": renderedAbsoluteUrl("stage0/author/"),
        "<stage0-review-url>": renderedAbsoluteUrl("stage0/review/"),
        "<stage0-release-url>": renderedAbsoluteUrl("stage0/release/"),
      }),
    },
    {
      route: "stage0/author",
      expected: materializeHandoff(
        STAGE0_AUTHOR_HANDOFF,
        "<stage0-author-url>",
        renderedAbsoluteUrl("stage0/author/"),
      ),
    },
    {
      route: "stage0/review",
      expected: materializeHandoff(
        STAGE0_REVIEW_HANDOFF,
        "<stage0-review-url>",
        renderedAbsoluteUrl("stage0/review/"),
      ),
    },
    {
      route: "stage0/release",
      expected: materializeHandoff(
        STAGE0_RELEASE_HANDOFF,
        "<stage0-release-url>",
        renderedAbsoluteUrl("stage0/release/"),
      ),
    },
  ];
  for (const { route, expected } of pages) {
    const html = await readFile(
      path.join(projectRoot, "out", ...route.split("/"), "index.html"),
      "utf8",
    );
    assert.equal(firstPromptBlock(html), expected, route);
    assert.doesNotMatch(html, /neutral-benchmark|neutral-launch|candidate-a/);
  }
});

test("the Stage 1 guide stays closed until a launch is live-verified", async () => {
  const html = await readFile(
    path.join(projectRoot, "out", "model-task", "index.html"),
    "utf8",
  );
  assert.match(html, /Stage 1 launcher \| Engineering Design Benchmark Framework/);
  assert.match(html, /STAGE 01/);
  assert.match(html, /0 LIVE-VERIFIED LAUNCHES/);
  assert.ok(html.includes(`href="${renderedSitePath("stage0/")}"`));
  assert.doesNotMatch(html, new RegExp(MODEL_LAUNCH_MESSAGE.slice(0, 24)));
  assert.doesNotMatch(html, /&lt;launch-url&gt;/);
  assert.doesNotMatch(html, /runs\/&lt;candidate-id&gt;\//);
});

test("the three-stage home and publishing guide preserve the candidate boundary", async () => {
  const home = await readFile(path.join(projectRoot, "out", "index.html"), "utf8");
  const publish = await readFile(path.join(projectRoot, "out", "publish-task", "index.html"), "utf8");
  assert.ok(home.indexOf("STAGE 00") < home.indexOf("STAGE 01"));
  assert.ok(home.indexOf("STAGE 01") < home.indexOf("STAGE 02"));
  assert.match(home, /STAGE 0 PREP/);
  assert.match(home, /STAGE 1 DESIGN/);
  assert.match(home, /STAGE 2 EVALUATE/);
  assert.match(publish, /Stage 2 handoff moved \| Engineering Design Benchmark/);
  assert.match(publish, /publish-only procedure is obsolete/i);
  assert.match(publish, /complete cohort can be published/i);
  assert.match(publish, /EVALUATE_TASK\.md/);
  assert.match(publish, /no old command or prompt is executable/i);
});

/*
test.skip("the retired Stage 1 guide rendering contract", async () => {
  const html = await readFile(
    path.join(projectRoot, "out", "model-task", "index.html"),
    "utf8",
  );
  assert.match(html, /Stage 1 launcher \| Engineering Design Benchmark Framework/);
  assert.match(html, /STAGE 01/);
  assert.match(html, /URLを、実行指示として成立させる/);
  assert.match(html, /このタスクに対する私の指示として実行/);
  assert.match(html, /candidate-output\//);
  assert.doesNotMatch(html, /runs\/&lt;candidate-id&gt;\//);
});

test.skip("the retired two-stage home rendering contract", async () => {
  const home = await readFile(path.join(projectRoot, "out", "index.html"), "utf8");
  const publish = await readFile(path.join(projectRoot, "out", "publish-task", "index.html"), "utf8");
  assert.ok(home.indexOf("STAGE 01") < home.indexOf("STAGE 02"));
  assert.match(home, /STAGE 1 HANDOFF/);
  assert.match(home, /STAGE 2 HANDOFF/);
  assert.match(home, /候補IDやRotorBenchの操作は要求しません/);
  assert.match(publish, /Stage 2 cohort publishing \| Engineering Design Benchmark Framework/);
  assert.match(publish, /byte-for-byte/);
  assert.match(publish, /publish the cohort together/i);
  assert.match(publish, /stage2:publish-cohort/);
  assert.match(publish, /公開担当のCodexへ貼る全文/);
  assert.match(publish, /予定候補と完成済み成果/);
  assert.match(publish, /never sent to a candidate model/i);
});
*/
