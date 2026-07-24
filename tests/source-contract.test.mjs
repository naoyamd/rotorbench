import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
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
import test from "node:test";
import {
  isSafeRelativePath,
  validateArtifact,
  validateBenchmark,
  validateFramework,
  validateRun,
} from "../scripts/framework-lib.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const digest = (value) => createHash("sha256").update(value).digest("hex");
const normalizedTextDigest = (value) =>
  digest(value.replace(/\r\n?/g, "\n"));

async function fixtureRoot() {
  const root = await mkdtemp(path.join(tmpdir(), "framework-fixture-"));
  await mkdir(path.join(root, "benchmarks"), { recursive: true });
  await mkdir(path.join(root, "runs"), { recursive: true });
  return root;
}

async function writeJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

function benchmark(id = "neutral-benchmark") {
  return {
    schemaVersion: "1.0",
    id,
    title: "Neutral benchmark",
    status: "draft",
    version: "1.0",
    extensions: {},
  };
}

function run(id, artifacts = []) {
  return {
    schemaVersion: "1.0",
    id,
    benchmarkId: "neutral-benchmark",
    benchmarkVersion: "1.0",
    status: "submitted",
    submittedAt: "2026-01-01T00:00:00Z",
    model: { provider: "Provider", name: "Model", version: "Version" },
    artifacts,
    extensions: {},
  };
}

test("Draft 2020-12 schemas are checked in and applied by Ajv", async () => {
  const schemaNames = [
    "benchmark.schema.json",
    "run.schema.json",
    "artifact.schema.json",
    "validation-report.schema.json",
  ];
  for (const name of schemaNames) {
    const schema = JSON.parse(await readFile(path.join(projectRoot, "schemas", name), "utf8"));
    assert.equal(schema.$schema, "https://json-schema.org/draft/2020-12/schema");
  }
  const artifact = {
    id: "evidence",
    role: "supporting",
    path: "files/note.txt",
    sha256: digest("note"),
    status: "present",
    mediaType: "text/plain",
  };
  assert.deepEqual(validateBenchmark(benchmark()), []);
  assert.deepEqual(validateArtifact(artifact), []);
  assert.deepEqual(validateRun(run("valid-run", [artifact])), []);
  assert.ok(validateBenchmark({ ...benchmark(), summary: 42 }).some((issue) => issue.code === "schema-type"));
  assert.ok(validateBenchmark({ ...benchmark(), version: 42 }).some((issue) => issue.code === "schema-type"));
  assert.ok(validateRun({ ...run("bad-run"), model: { provider: 42, name: "M", version: "V" } }).some((issue) => issue.code === "schema-type"));
  assert.ok(validateArtifact({ ...artifact, mediaType: 42 }).some((issue) => issue.code === "schema-type"));
  assert.ok(validateRun({ ...run("bad-run"), unexpected: true }).some((issue) => issue.code === "schema-additionalProperties"));
});

test("safe artifact paths reject traversal, URL-dangerous characters, and absolute paths", () => {
  assert.equal(isSafeRelativePath("files/design.step"), true);
  const artifact = {
    id: "path-contract",
    role: "supporting",
    path: "files/design.step",
    sha256: digest("path"),
    status: "present",
  };
  assert.deepEqual(validateArtifact(artifact), []);
  for (const unsafe of [
    "files/../design.step",
    "files/./design.step",
    "../design.step",
    "/design.step",
    ".hidden",
    "files/.hidden",
    "files/",
    "files\\design.step",
    "files/model?.step",
    "files/model#1.step",
    "files/model%20.step",
  ]) {
    assert.equal(isSafeRelativePath(unsafe), false, unsafe);
    assert.ok(
      validateArtifact({ ...artifact, path: unsafe }).some(
        (issue) => issue.code === "schema-pattern",
      ),
      `schema accepted ${unsafe}`,
    );
  }
});

test("an empty temporary catalog validates without relying on repository counts", async () => {
  const root = await fixtureRoot();
  try {
    const result = await validateFramework(root);
    assert.deepEqual(result.issues, []);
    assert.equal(result.benchmarks.length, 0);
    assert.equal(result.runs.length, 0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("repository directories and generated catalog have matching actual counts", async () => {
  const contentDirectories = async (name) =>
    (await readdir(path.join(projectRoot, name), { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).length;
  const catalog = JSON.parse(
    await readFile(path.join(projectRoot, "public", "framework", "catalog.json"), "utf8"),
  );
  assert.equal(catalog.benchmarks.length, await contentDirectories("benchmarks"));
  assert.equal(catalog.runs.length, await contentDirectories("runs"));
  const validation = await validateFramework(projectRoot);
  assert.deepEqual(validation.issues, []);
});

test("validation reports duplicate IDs, malformed manifests, and hash mismatches as diagnostics", async () => {
  const root = await fixtureRoot();
  try {
    await writeJson(path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"), benchmark());
    await writeJson(path.join(root, "benchmarks", "another", "benchmark.json"), benchmark("neutral-benchmark"));
    const file = Buffer.from("unmodified test file");
    await mkdir(path.join(root, "runs", "first-run", "files"), { recursive: true });
    await writeFile(path.join(root, "runs", "first-run", "files", "note.txt"), file);
    const artifact = {
      id: "evidence",
      role: "supporting",
      path: "files/note.txt",
      sha256: digest("wrong"),
      status: "present",
    };
    await writeJson(path.join(root, "runs", "first-run", "run.json"), run("first-run", [artifact]));
    await writeJson(path.join(root, "runs", "second-run", "run.json"), run("first-run"));
    await mkdir(path.join(root, "runs", "broken-json"), { recursive: true });
    await writeFile(path.join(root, "runs", "broken-json", "run.json"), "{not-json");
    await mkdir(path.join(root, "runs", "missing-manifest"), { recursive: true });
    const result = await validateFramework(root);
    assert.ok(result.issues.some((issue) => issue.code === "duplicate-id"));
    assert.ok(result.issues.some((issue) => issue.code === "hash-mismatch"));
    assert.ok(result.issues.some((issue) => issue.code === "invalid-json"));
    assert.ok(result.issues.some((issue) => issue.code === "missing-manifest"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("artifact validation rejects directories and symlinks without throwing", async (context) => {
  const root = await fixtureRoot();
  try {
    await writeJson(path.join(root, "benchmarks", "neutral-benchmark", "benchmark.json"), benchmark());
    const runRoot = path.join(root, "runs", "path-run");
    await mkdir(path.join(runRoot, "files", "directory.txt"), { recursive: true });
    const directoryArtifact = {
      id: "directory",
      role: "supporting",
      path: "files/directory.txt",
      sha256: digest("irrelevant"),
      status: "present",
    };
    await writeJson(path.join(runRoot, "run.json"), run("path-run", [directoryArtifact]));
    let result = await validateFramework(root);
    assert.ok(result.issues.some((issue) => issue.code === "artifact-not-file"));

    const outsideDirectory = path.join(root, "outside");
    await mkdir(outsideDirectory);
    await writeFile(path.join(outsideDirectory, "outside.txt"), "outside");
    const linkedDirectory = path.join(runRoot, "files", "escape");
    try {
      await symlink(outsideDirectory, linkedDirectory, "junction");
    } catch (error) {
      if (error && typeof error === "object" && error.code === "EPERM") {
        context.diagnostic("File symlink creation is unavailable; directory rejection still exercised.");
        return;
      }
      throw error;
    }
    const linkArtifact = {
      id: "linked",
      role: "supporting",
      path: "files/escape/outside.txt",
      sha256: digest("outside"),
      status: "present",
    };
    await writeJson(path.join(runRoot, "run.json"), run("path-run", [linkArtifact]));
    result = await validateFramework(root);
    assert.ok(result.issues.some((issue) => issue.code === "artifact-escape"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("legacy prompt and submission text remains unchanged across line endings", async () => {
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
    const text = await readFile(path.join(projectRoot, relativePath), "utf8");
    assert.equal(normalizedTextDigest(text), expectedHash, relativePath);
  }
});
