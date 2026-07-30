import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  deriveNeutralReviewEvidence,
  parseBoundedStepWorkerOutput,
} from "../scripts/review-evidence-lib.mjs";
import { normalize } from "../scripts/review-evidence-step-worker.mjs";
import { sha256, validateReviewPackage } from "../scripts/framework-lib.mjs";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "review-evidence-"));
  const packetRoot = path.join(root, "packet");
  const outputRoot = path.join(root, "artifacts");
  await mkdir(path.join(packetRoot, "inputs"), { recursive: true });
  await mkdir(outputRoot, { recursive: true });
  const outputContract = {
    artefacts: [
      { path: "artifacts/bom/bom.csv", requiredFields: ["partNumber", "quantity", "makeBuy"] },
      { path: "artifacts/design/requirements-trace.csv", requiredFields: ["requirementId", "evidencePath", "status"] },
      { path: "artifacts/drawings/critical-drawing-index.csv", requiredFields: ["drawingId", "drawingPath", "pmiPath"] },
    ],
  };
  const requirements = { requirements: [{ id: "REQ-001" }, { id: "REQ-002" }] };
  await writeFile(path.join(packetRoot, "inputs", "output-contract.json"), `${JSON.stringify(outputContract)}\n`);
  await writeFile(path.join(packetRoot, "inputs", "requirements.json"), `${JSON.stringify(requirements)}\n`);
  const cubeSource = path.join(repositoryRoot, "node_modules", "occt-import-js", "test", "testfiles", "simple-basic-cube", "cube.stp");
  const files = {
    "artifacts/cad/assembly.step": cubeSource,
    "artifacts/bom/bom.csv": "partNumber,quantity,makeBuy\nP-001,2,make\n",
    "artifacts/design/requirements-trace.csv": "requirementId,evidencePath,status\nREQ-001,artifacts/cad/assembly.step,pass\nREQ-999,missing,pass\n",
    "artifacts/drawings/critical-drawing-index.csv": "drawingId,drawingPath,pmiPath\nDRW-001,artifacts/cad/assembly.step,\n",
  };
  const artifacts = [];
  const artifactPaths = new Map();
  const evidenceIds = new Map();
  for (const [index, [relativePath, value]] of Object.entries(files).entries()) {
    const destination = path.join(outputRoot, ...relativePath.split("/"));
    await mkdir(path.dirname(destination), { recursive: true });
    if (relativePath.endsWith(".step")) await cp(value, destination);
    else await writeFile(destination, value);
    const bytes = await readFile(destination);
    const id = ["step", "bom", "requirements", "drawing-index"][index];
    artifacts.push({
      id,
      path: relativePath,
      mediaType: relativePath.endsWith(".step") ? "model/step" : "text/csv",
      role: relativePath.includes("bom") ? "bom" : relativePath.includes("drawing") ? "drawing" : relativePath.endsWith(".step") ? "step" : "supporting",
      outputSha256: sha256(bytes),
      bytes,
    });
    artifactPaths.set(id, destination);
    evidenceIds.set(id, `EVD-${String(index + 1).padStart(3, "0")}`);
  }
  return {
    root,
    packetRoot,
    packet: { inputs: [{ id: "output-contract", path: "inputs/output-contract.json" }, { id: "requirements", path: "inputs/requirements.json" }] },
    artifacts,
    artifactPaths,
    evidenceIds,
  };
}

test("neutral review evidence imports STEP in an isolated worker and emits identity-free geometry and views", async () => {
  const context = await fixture();
  try {
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: context.artifacts,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
    });
    const geometry = derived.find(({ role }) => role === "step-geometry");
    assert.equal(geometry.derivationStatus, "processed");
    const geometryJson = JSON.parse(geometry.bytes.toString("utf8"));
    assert.equal(geometryJson.status, "processed");
    assert.equal(geometryJson.tool.executionContractDigest, "a".repeat(64));
    assert.match(geometryJson.outputPayloadSha256, /^[a-f0-9]{64}$/);
    assert.ok(geometryJson.geometry.partCount >= 1);
    assert.ok(geometryJson.geometry.triangleCount >= 1);
    assert.ok(Number.isFinite(geometryJson.geometry.bounds.min.x));
    assert.equal(JSON.stringify(geometryJson).includes("cube"), false, "candidate STEP names are never copied");
    const views = derived.filter(({ role }) => role.startsWith("step-view-"));
    assert.deepEqual(views.map(({ role }) => role), ["step-view-x", "step-view-y", "step-view-z"]);
    for (const view of views) {
      assert.equal(view.mediaType, "image/svg+xml");
      assert.match(view.bytes.toString("utf8"), /<svg/);
      assert.equal(view.bytes.toString("utf8").includes("cube"), false);
    }
    const trace = derived.find(({ role }) => role === "normalized-requirements-trace");
    const traceJson = JSON.parse(trace.bytes.toString("utf8"));
    assert.equal(traceJson.knownRequirementReferenceCount, 1);
    assert.equal(traceJson.uncoveredPublishedRequirementCount, 1);
    assert.equal(traceJson.boundEvidencePathCount, 1);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("neutral review evidence records an unsupported STEP import without fabricating a render", async () => {
  const context = await fixture();
  try {
    const badStep = context.artifactPaths.get("step");
    await writeFile(badStep, "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    const bytes = await readFile(badStep);
    const source = context.artifacts.find(({ id }) => id === "step");
    source.bytes = bytes;
    source.outputSha256 = sha256(bytes);
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: context.artifacts,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
    });
    const geometry = derived.find(({ role }) => role === "step-geometry");
    assert.equal(geometry.derivationStatus, "evaluator-unsupported");
    assert.equal(JSON.parse(geometry.bytes.toString("utf8")).reason, "step-import-failed");
    assert.equal(derived.some(({ role }) => role.startsWith("step-view-")), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("STEP worker receives the verified admitted bytes, not a mutable sanitized source path", async () => {
  const context = await fixture();
  try {
    const source = context.artifacts.find(({ id }) => id === "step");
    const admittedSha256 = source.outputSha256;
    // This simulates a path replacement after the parent already retained and
    // verified the source bytes. The worker must still import those bytes.
    await writeFile(
      context.artifactPaths.get("step"),
      "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n",
    );
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: context.artifacts,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
    });
    const geometry = derived.find(({ role }) => role === "step-geometry");
    assert.equal(geometry.derivationStatus, "processed");
    assert.equal(JSON.parse(geometry.bytes.toString("utf8")).input.sha256, admittedSha256);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("STEP derivation rejects an artifact object whose claimed input hash differs from its bytes", async () => {
  const context = await fixture();
  try {
    const source = context.artifacts.find(({ id }) => id === "step");
    source.outputSha256 = "f".repeat(64);
    await assert.rejects(
      deriveNeutralReviewEvidence({
        packetRoot: context.packetRoot,
        packet: context.packet,
        reportArtifacts: context.artifacts,
        artifactEvidenceIds: context.evidenceIds,
        executionContractDigest: "a".repeat(64),
      }),
      /sanitized digest/i,
    );
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("STEP worker rejects a scratch input whose bytes do not match the expected digest", async () => {
  const context = await fixture();
  try {
    const output = path.join(context.root, "worker-mesh.json");
    await assert.rejects(
      execFileAsync(process.execPath, [
        path.join(repositoryRoot, "scripts", "review-evidence-step-worker.mjs"),
        "--input", context.artifactPaths.get("step"),
        "--output", output,
        "--expected-sha256", "0".repeat(64),
      ], { windowsHide: true }),
      (error) => /expected SHA-256/i.test(String(error.stderr ?? "")),
    );
    await assert.rejects(readFile(output), /ENOENT/);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("STEP derivation commits geometry and all views atomically", async () => {
  const context = await fixture();
  try {
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: context.artifacts,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
      renderStepView: (_geometry, direction) => {
        if (direction === "z") throw new Error("simulated renderer failure");
        return Buffer.from("<svg/>");
      },
    });
    const stepDerived = derived.filter(({ sourceEvidenceIds }) => (
      sourceEvidenceIds.length === 1 && sourceEvidenceIds[0] === "EVD-001"
    ));
    assert.equal(stepDerived.length, 1);
    assert.equal(stepDerived[0].role, "step-geometry");
    assert.equal(stepDerived[0].derivationStatus, "evaluator-unsupported");
    assert.equal(derived.some(({ role }) => role.startsWith("step-view-")), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("sealed artifact roles are required for STEP views and drawing/PMI bindings", async () => {
  const context = await fixture();
  try {
    const roleless = context.artifacts.map((artifact) => {
      const copy = { ...artifact };
      delete copy.role;
      return copy;
    });
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: roleless,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
    });
    assert.equal(derived.some(({ role }) => role === "step-geometry"), false);
    assert.equal(derived.some(({ role }) => role.startsWith("step-view-")), false);
    const drawingIndex = JSON.parse(derived
      .find(({ role }) => role === "normalized-drawing-index")
      .bytes
      .toString("utf8"));
    assert.equal(drawingIndex.boundDrawingPathCount, 0);
    assert.equal(drawingIndex.boundPmiPathCount, 0);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

test("STEP worker and parent reject resource-limit output before rendering", () => {
  assert.throws(
    () => normalize({ success: true, meshes: Array.from({ length: 257 }, () => ({})) }),
    /part limit/i,
  );
  assert.throws(
    () => normalize({
      success: true,
      meshes: [{
        attributes: { position: { array: new Float32Array((100_000 + 1) * 3) } },
        index: { array: new Uint32Array([0, 0, 0]) },
      }],
    }),
    /vertex limit/i,
  );
  assert.throws(
    () => normalize({
      success: true,
      meshes: [{
        attributes: { position: { array: new Float32Array([0, 0, 0]) } },
        index: { array: new Uint32Array((200_000 + 1) * 3) },
      }],
    }),
    /triangle limit/i,
  );
  assert.throws(
    () => parseBoundedStepWorkerOutput(Buffer.alloc(12_582_913, 0x20)),
    /output exceeds limit/i,
  );
});

test("STEP resource-limit failures become evaluator-unsupported evidence without SVG views", async () => {
  const context = await fixture();
  try {
    const source = context.artifacts.find(({ id }) => id === "step");
    const oversized = Buffer.alloc(26_214_401, 0x20);
    await writeFile(context.artifactPaths.get("step"), oversized);
    source.bytes = oversized;
    source.outputSha256 = sha256(oversized);
    const derived = await deriveNeutralReviewEvidence({
      packetRoot: context.packetRoot,
      packet: context.packet,
      reportArtifacts: context.artifacts,
      artifactEvidenceIds: context.evidenceIds,
      executionContractDigest: "a".repeat(64),
    });
    const geometry = derived.find(({ role }) => role === "step-geometry");
    assert.equal(geometry.derivationStatus, "evaluator-unsupported");
    assert.equal(JSON.parse(geometry.bytes.toString("utf8")).reason, "step-resource-limit");
    assert.equal(derived.some(({ role }) => role.startsWith("step-view-")), false);
  } finally {
    await rm(context.root, { recursive: true, force: true });
  }
});

function packageEvidence(id, kind, extra = {}) {
  return {
    id,
    kind,
    mediaType: "application/json",
    sha256: "a".repeat(64),
    bytes: 1,
    outputPath: `evidence/${id}.json`,
    ...extra,
  };
}

function reviewPackageWith(evidence) {
  return {
    schemaVersion: "1.0",
    generatedAt: "2026-07-29T00:00:00Z",
    status: "ready",
    reviewPackageId: "review-aaaaaaaaaaaaaaaa",
    evidenceRoot: "evidence",
    scoringContract: {
      id: "fixture",
      version: "1.0",
      sha256: "a".repeat(64),
      outputPath: "scoring-contract.json",
      outputSha256: "a".repeat(64),
    },
    sanitizationReport: { sha256: "a".repeat(64), status: "passed" },
    evidence: [
      packageEvidence("EVD-001", "initial-plan"),
      packageEvidence("EVD-002", "initial-plan-checkpoint"),
      packageEvidence("EVD-003", "work-record"),
      evidence,
    ],
  };
}

const derivation = {
  status: "processed",
  sourceEvidenceIds: ["EVD-001"],
  tool: {
    name: "rotorbench-neutral-review-evidence",
    version: "1.0",
    engine: "occt-import-js@0.0.23",
    isolation: "separate-node-worker",
    executionContractDigest: "a".repeat(64),
  },
};

test("review-package schema makes role and derivation exclusive by evidence kind", () => {
  assert.deepEqual(
    validateReviewPackage(reviewPackageWith(packageEvidence("EVD-004", "artifact", { role: "supporting" }))),
    [],
  );
  assert.deepEqual(
    validateReviewPackage(reviewPackageWith(packageEvidence("EVD-004", "derived", { derivation }))),
    [],
  );
  for (const invalidEvidence of [
    packageEvidence("EVD-004", "artifact", { role: "supporting", derivation }),
    packageEvidence("EVD-004", "derived", { role: "supporting", derivation }),
    packageEvidence("EVD-004", "initial-plan", { role: "supporting" }),
    packageEvidence("EVD-004", "initial-plan", { derivation }),
  ]) {
    assert.notDeepEqual(validateReviewPackage(reviewPackageWith(invalidEvidence)), []);
  }
});
