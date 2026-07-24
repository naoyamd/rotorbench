import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");

async function makeRunFixture(artifact, id = "fixture-run") {
  const root = await mkdtemp(path.join(tmpdir(), "run-fixture-"));
  await mkdir(path.join(root, "benchmarks", "neutral-benchmark"), { recursive: true });
  await mkdir(path.join(root, "runs", id, "files"), { recursive: true });
  await writeFile(
    path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id: "neutral-benchmark",
      title: "Neutral benchmark",
      status: "draft",
      version: "1.0",
      extensions: {},
    }),
  );
  const target = path.join(root, "runs", id, artifact.path);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, artifact.contents);
  await writeFile(
    path.join(root, "runs", id, "run.json"),
    JSON.stringify({
      schemaVersion: "1.0",
      id,
      benchmarkId: "neutral-benchmark",
      benchmarkVersion: "1.0",
      status: "submitted",
      submittedAt: "2026-01-01T00:00:00Z",
      model: { provider: "Provider", name: "Model", version: "Version" },
      artifacts: [{
        id: artifact.id,
        role: artifact.role,
        path: artifact.path,
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
    const report = JSON.parse(await readFile(path.join(root, "public", "framework", "reports", "fixture-run.json"), "utf8"));
    const metadata = JSON.parse(await readFile(path.join(root, "public", "framework", "meshes", "fixture-run", "model.metadata.json"), "utf8"));
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
    const report = JSON.parse(await readFile(path.join(root, "public", "framework", "reports", "fixture-run.json"), "utf8"));
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
  assert.match(home, new RegExp(`<strong>${catalog.runs.length}</strong><span>RUNS</span>`));
  for (const route of ["benchmarks", "format", "compare", "legacy", "model-task", "publish-task"]) {
    await readFile(path.join(projectRoot, "out", route, "index.html"), "utf8");
  }
  for (const benchmark of catalog.benchmarks) {
    await readFile(path.join(projectRoot, "out", "benchmarks", benchmark.id, "index.html"), "utf8");
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
  const layout = await readFile(path.join(projectRoot, "app", "layout.tsx"), "utf8");
  assert.match(layout, /https:\/\/rotorbench-lab\.naoyamd\.chatgpt\.site/);
  assert.doesNotMatch(layout, /og-engineering-framework\.png/);
  await assert.rejects(
    stat(path.join(projectRoot, "public", "og-engineering-framework.png")),
  );
});

test("the static model-task URL contains only the pinned common execution prompt", async () => {
  const html = await readFile(
    path.join(projectRoot, "out", "model-task", "index.html"),
    "utf8",
  );
  assert.match(html, /Common model prompt \| Engineering Design Benchmark Framework/);
  assert.match(html, /EDBF-COMMON-1\.0/);
  assert.match(html, /STAGE 01/);
  assert.match(html, /モデルへ渡す共通実行プロンプト/);
  assert.match(html, /runs\/&lt;candidate-id&gt;\//);
  assert.match(html, /github\.com\/naoyamd\/rotorbench/);
  assert.doesNotMatch(html, /Prepare a framework run/);
});

test("the home and publishing URL expose the two-stage handoff in order", async () => {
  const home = await readFile(path.join(projectRoot, "out", "index.html"), "utf8");
  const publish = await readFile(
    path.join(projectRoot, "out", "publish-task", "index.html"),
    "utf8",
  );
  assert.ok(home.indexOf("STAGE 01") < home.indexOf("STAGE 02"));
  assert.match(home, /MODEL RUN PROMPT/);
  assert.match(home, /PUBLISHING PROMPT/);
  assert.match(home, /候補モデルにはSTAGE 01だけを渡し/);
  assert.match(publish, /Publishing prompt \| Engineering Design Benchmark Framework/);
  assert.match(publish, /EDBF-PUBLISH-1\.0/);
  assert.match(publish, /STAGE 02/);
  assert.match(publish, /候補モデルには渡しません/);
});
