import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { validateArtifactContract } from "../scripts/artifact-contract.mjs";

const packet = {
  inputs: [{ id: "output-contract", path: "inputs/output-contract.json" }],
  checkpoints: [
    { id: "CKPT-000", sequence: 0 },
    { id: "CKPT-010", sequence: 10 },
    { id: "CKPT-020", sequence: 20 },
  ],
};

const outputContract = {
  candidateCheckpoints: [
    { id: "CKPT-010", requiredArtefacts: ["design/trace.json", "bom/bom.csv"] },
    { id: "CKPT-020", requiredArtefacts: ["cad/assembly.step", "drawings/critical.pdf"] },
  ],
  artefacts: [
    {
      id: "ART-001",
      path: "design/trace.json",
      role: "supporting",
      requiredOutputRef: "OUT-001",
      mediaType: "application/json",
      requiredFields: ["requirements"],
    },
    {
      id: "ART-002",
      path: "bom/bom.csv",
      role: "bom",
      requiredOutputRef: "OUT-002",
      mediaType: "text/csv",
      requiredFields: ["partNumber", "quantity"],
    },
    {
      id: "ART-003",
      path: "cad/assembly.step",
      role: "step",
      requiredOutputRef: "OUT-003",
      mediaType: "model/step",
      requiredFields: [],
    },
    {
      id: "ART-004",
      path: "drawings/critical.pdf",
      role: "drawing",
      requiredOutputRef: "OUT-004",
      mediaType: "application/pdf",
      requiredFields: [],
    },
  ],
};

function artifact(id, role, filePath, mediaType, output) {
  return {
    id,
    role,
    path: filePath,
    mediaType,
    requiredOutputRefs: [output],
    status: "present",
  };
}

async function fixture() {
  const parent = await mkdtemp(path.join(os.tmpdir(), "edbf-artifact-contract-"));
  const packetRoot = path.join(parent, "packet");
  const candidateRoot = path.join(parent, "candidate-output");
  await mkdir(path.join(packetRoot, "inputs"), { recursive: true });
  await mkdir(path.join(candidateRoot, "design"), { recursive: true });
  await mkdir(path.join(candidateRoot, "bom"), { recursive: true });
  await writeFile(
    path.join(packetRoot, "inputs", "output-contract.json"),
    `${JSON.stringify(outputContract, null, 2)}\n`,
  );
  await writeFile(path.join(candidateRoot, "design", "trace.json"), '{"requirements":[]}\n');
  await writeFile(path.join(candidateRoot, "bom", "bom.csv"), "partNumber,quantity\nA-1,1\n");
  return { parent, packetRoot, candidateRoot };
}

function submission(artifacts, checkpointId = "CKPT-010") {
  return {
    artifacts,
    partialAttainment: { highestVerifiedCheckpointId: checkpointId },
  };
}

test("artifact contract validates each due JSON and CSV artifact while deferring future checkpoints", async () => {
  const context = await fixture();
  try {
    const result = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([
        artifact("trace", "supporting", "design/trace.json", "application/json", "OUT-001"),
        artifact("bom", "bom", "bom/bom.csv", "text/csv", "OUT-002"),
      ]),
    });
    assert.equal(result.status, "valid", JSON.stringify(result));
    assert.deepEqual(result.coverage, {
      highestVerifiedCheckpointId: "CKPT-010",
      dueArtifactCount: 2,
      satisfiedArtifactCount: 2,
      ratio: 1,
      inspectedPaths: ["bom/bom.csv", "design/trace.json"],
      deferredArtifactCount: 2,
    });
    assert.deepEqual(
      result.deferred.map(({ path: deferredPath }) => deferredPath),
      ["cad/assembly.step", "drawings/critical.pdf"],
    );
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});

test("artifact contract rejects missing attained evidence and malformed CSV headers", async () => {
  const context = await fixture();
  try {
    await writeFile(path.join(context.candidateRoot, "bom", "bom.csv"), "partNumber,count\nA-1,1\n");
    const result = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([
        artifact("trace", "supporting", "design/trace.json", "application/json", "OUT-001"),
        artifact("bom", "bom", "bom/bom.csv", "text/csv", "OUT-002"),
      ]),
    });
    assert.equal(result.status, "invalid");
    assert.ok(result.admissionIssues.some(({ code }) => code === "artifact-csv-required-header-missing"));
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});

test("artifact contract does not turn unreached checkpoint outputs into a submission failure", async () => {
  const context = await fixture();
  try {
    const result = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([], "CKPT-000"),
    });
    assert.equal(result.status, "valid", JSON.stringify(result));
    assert.equal(result.coverage.dueArtifactCount, 0);
    assert.equal(result.deferred.length, 4);
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});

test("artifact contract rejects fake STEP and PDF envelopes at an attained checkpoint", async () => {
  const context = await fixture();
  try {
    await mkdir(path.join(context.candidateRoot, "cad"), { recursive: true });
    await mkdir(path.join(context.candidateRoot, "drawings"), { recursive: true });
    await writeFile(path.join(context.candidateRoot, "cad", "assembly.step"), "not a STEP file\n");
    await writeFile(path.join(context.candidateRoot, "drawings", "critical.pdf"), "not a PDF\n");
    const result = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([
        artifact("trace", "supporting", "design/trace.json", "application/json", "OUT-001"),
        artifact("bom", "bom", "bom/bom.csv", "text/csv", "OUT-002"),
        artifact("step", "step", "cad/assembly.step", "model/step", "OUT-003"),
        artifact("drawing", "drawing", "drawings/critical.pdf", "application/pdf", "OUT-004"),
      ], "CKPT-020"),
    });
    assert.equal(result.status, "invalid");
    assert.ok(result.admissionIssues.some(({ code }) => code === "artifact-step-invalid-envelope"));
    assert.ok(result.admissionIssues.some(({ code }) => code === "artifact-pdf-invalid-envelope"));
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});

test("artifact contract requires every hash-indexed native CAD source byte", async () => {
  const context = await fixture();
  try {
    const contract = {
      candidateCheckpoints: [
        { id: "CKPT-020", requiredArtefacts: ["cad/source-manifest.json"] },
      ],
      artefacts: [{
        id: "ART-SOURCE",
        path: "cad/source-manifest.json",
        role: "cad-source",
        requiredOutputRef: "OUT-001",
        mediaType: "application/json",
        requiredFields: ["sourceFiles"],
        indexedFileReferences: {
          kind: "json-records",
          recordsField: "sourceFiles",
          pathField: "path",
          mediaTypeField: "mediaType",
          sha256Field: "sha256",
          pathRoot: "cad/source",
          allowedMediaTypes: ["application/x-opaque-cad"],
        },
      }],
    };
    await mkdir(path.join(context.candidateRoot, "cad", "source"), { recursive: true });
    const sourceBytes = Buffer.from("opaque-cad-source\n");
    const sourcePath = "cad/source/model.fcstd";
    await writeFile(path.join(context.candidateRoot, sourcePath), sourceBytes);
    await writeFile(
      path.join(context.candidateRoot, "cad", "source-manifest.json"),
      `${JSON.stringify({ sourceFiles: [{
        path: sourcePath,
        mediaType: "application/x-opaque-cad",
        sha256: createHash("sha256").update(sourceBytes).digest("hex"),
      }] })}\n`,
    );
    await writeFile(
      path.join(context.packetRoot, "inputs", "output-contract.json"),
      `${JSON.stringify(contract, null, 2)}\n`,
    );
    const manifestArtifact = artifact("source-manifest", "cad-source", "cad/source-manifest.json", "application/json", "OUT-001");
    const result = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([manifestArtifact], "CKPT-020"),
    });
    assert.equal(result.status, "invalid");
    assert.ok(result.admissionIssues.some(({ code }) => code === "indexed-cad-source-artifact-missing"));

    const sourceArtifact = artifact("source-file", "cad-source", sourcePath, "application/x-opaque-cad", "OUT-001");
    const valid = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([manifestArtifact, sourceArtifact], "CKPT-020"),
    });
    assert.equal(valid.status, "valid", JSON.stringify(valid));
    assert.deepEqual(valid.indexedArtifacts, [{
      path: sourcePath,
      mediaType: "application/x-opaque-cad",
      role: "cad-source",
      requiredOutputRef: "OUT-001",
    }]);
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});

test("artifact contract requires every controlled drawing file named by its index", async () => {
  const context = await fixture();
  try {
    const contract = {
      candidateCheckpoints: [
        { id: "CKPT-020", requiredArtefacts: ["drawings/index.csv"] },
      ],
      artefacts: [{
        id: "ART-DRAWING-INDEX",
        path: "drawings/index.csv",
        role: "drawing",
        requiredOutputRef: "OUT-006",
        mediaType: "text/csv",
        requiredFields: ["drawingPath", "pmiPath"],
        indexedFileReferences: {
          kind: "csv-row-paths",
          pathRoot: "drawings",
          drawingPath: { required: true, allowedMediaTypes: ["application/pdf"] },
          pmiPath: { required: false, allowedMediaTypes: ["application/pdf"] },
        },
      }],
    };
    await mkdir(path.join(context.candidateRoot, "drawings"), { recursive: true });
    await writeFile(path.join(context.candidateRoot, "drawings", "index.csv"), "drawingPath,pmiPath\ndrawings/base.pdf,\n");
    await writeFile(path.join(context.packetRoot, "inputs", "output-contract.json"), `${JSON.stringify(contract, null, 2)}\n`);
    const indexArtifact = artifact("drawing-index", "drawing", "drawings/index.csv", "text/csv", "OUT-006");
    const missing = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([indexArtifact], "CKPT-020"),
    });
    assert.equal(missing.status, "invalid");
    assert.ok(missing.admissionIssues.some(({ code }) => code === "indexed-drawing-artifact-missing"));

    await writeFile(path.join(context.candidateRoot, "drawings", "base.pdf"), "%PDF-1.7\n%%EOF\n");
    const drawingArtifact = artifact("drawing-file", "drawing", "drawings/base.pdf", "application/pdf", "OUT-006");
    const valid = await validateArtifactContract({
      candidateRoot: context.candidateRoot,
      packetRoot: context.packetRoot,
      packet,
      submission: submission([indexArtifact, drawingArtifact], "CKPT-020"),
    });
    assert.equal(valid.status, "valid", JSON.stringify(valid));
  } finally {
    await rm(context.parent, { recursive: true, force: true });
  }
});
