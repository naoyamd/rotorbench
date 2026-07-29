import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { sha256, validatePlan, validateWorkRecord } from "../scripts/framework-lib.mjs";
import { materializeWorkspaceBootstrap } from "../scripts/materialize-workspace-bootstrap.mjs";

const projectRoot = path.resolve(import.meta.dirname, "..");
const bundlePath = path.join(
  projectRoot,
  "workspace-bootstrap",
  "integrated-robotic-handling-v1.json",
);
const profilePath = path.join(
  projectRoot,
  "execution-profiles",
  "integrated-robotic-handling-v1",
  "profile.json",
);

function runNodeResult(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

async function runNode(args, cwd) {
  const result = await runNodeResult(args, cwd);
  if (result.code !== 0) throw new Error(`${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

test("public workspace bundle materializes and emits a chained v4 receipt", async () => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "edbf-bootstrap-"));
  const workspace = path.join(temporaryParent, "workspace");
  try {
    const result = await materializeWorkspaceBootstrap({
      bundlePath,
      targetRoot: workspace,
    });
    assert.equal(result.fileCount, 8);
    assert.equal(result.bundleSha256, sha256(await readFile(bundlePath)));
    const profile = JSON.parse(await readFile(profilePath, "utf8"));
    assert.equal(profile.workspaceBootstrap.sha256, result.bundleSha256);
    assert.equal(
      validatePlan(JSON.parse(await readFile(
        path.join(workspace, "candidate-output", "templates", "plan.template.json"),
        "utf8",
      ))).length,
      0,
    );
    assert.equal(
      validateWorkRecord(JSON.parse(await readFile(
        path.join(workspace, "candidate-output", "templates", "work-record.template.json"),
        "utf8",
      ))).length,
      0,
    );
    await writeFile(
      path.join(workspace, "candidate-output", "plan.json"),
      `${JSON.stringify({ schemaVersion: "1.0", requirements: [] })}\n`,
    );
    const output = await runNode(
      [
        "tools/stage1-checkpoint.mjs",
        "--root",
        "candidate-output",
        "--checkpoint",
        "CKPT-000",
      ],
      workspace,
    );
    const receipt = JSON.parse(output);
    assert.equal(receipt.checkpointId, "CKPT-000");
    assert.equal(receipt.previousReceiptSha256, "0".repeat(64));
    assert.match(receipt.sha256, /^[a-f0-9]{64}$/);
    const contractPath = path.join(temporaryParent, "output-contract.json");
    await writeFile(contractPath, JSON.stringify({
      candidateCheckpoints: [
        { id: "CKPT-010", requiredArtefacts: ["design/trace.json"] },
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
      ],
    }));
    await writeFile(
      path.join(workspace, "candidate-output", "submission.json"),
      `${JSON.stringify({
        artifacts: [],
        partialAttainment: { highestVerifiedCheckpointId: "CKPT-000" },
      })}\n`,
    );
    const preflight = JSON.parse(await runNode(
      [
        "tools/stage1-preflight.mjs",
        "--root",
        "candidate-output",
        "--highest",
        "CKPT-000",
        "--contract",
        contractPath,
        "--submission",
        "submission.json",
      ],
      workspace,
    ));
    assert.equal(preflight.status, "valid");
    assert.equal(preflight.deferred.length, 1);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});

test("bootstrap preflight statically validates current indexed CAD, drawings, metadata, and CKPT-050 reissue", async () => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "edbf-bootstrap-preflight-"));
  const workspace = path.join(temporaryParent, "workspace");
  const candidateRoot = path.join(workspace, "candidate-output");
  try {
    await materializeWorkspaceBootstrap({ bundlePath, targetRoot: workspace });
    await mkdir(path.join(candidateRoot, "artifacts", "cad", "source"), { recursive: true });
    await mkdir(path.join(candidateRoot, "artifacts", "bom"), { recursive: true });
    await mkdir(path.join(candidateRoot, "artifacts", "drawings"), { recursive: true });
    await mkdir(path.join(candidateRoot, "artifacts", "design"), { recursive: true });

    const contract = {
      candidateCheckpoints: [
        { id: "CKPT-020", requiredArtefacts: [
          "artifacts/cad/source-manifest.json",
          "artifacts/cad/assembly.step",
          "artifacts/bom/bom.csv",
          "artifacts/drawings/critical-drawing-index.csv",
        ] },
        { id: "CKPT-050", requiredArtefacts: ["artifacts/design/change-impact.json"] },
      ],
      artefacts: [
        {
          id: "ART-SOURCE-MANIFEST",
          path: "artifacts/cad/source-manifest.json",
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
            pathRoot: "artifacts/cad/source",
            allowedMediaTypes: ["application/x-opaque-cad"],
          },
        },
        {
          id: "ART-STEP",
          path: "artifacts/cad/assembly.step",
          role: "step",
          requiredOutputRef: "OUT-002",
          mediaType: "model/step",
          requiredFields: [],
        },
        {
          id: "ART-BOM",
          path: "artifacts/bom/bom.csv",
          role: "bom",
          requiredOutputRef: "OUT-004",
          mediaType: "text/csv",
          requiredFields: ["partNumber"],
        },
        {
          id: "ART-DRAWING-INDEX",
          path: "artifacts/drawings/critical-drawing-index.csv",
          role: "drawing",
          requiredOutputRef: "OUT-006",
          mediaType: "text/csv",
          requiredFields: ["drawingPath", "pmiPath"],
          indexedFileReferences: {
            kind: "csv-row-paths",
            pathRoot: "artifacts/drawings",
            drawingPath: { required: true, allowedMediaTypes: ["application/pdf", "model/step"] },
            pmiPath: { required: false, allowedMediaTypes: ["application/pdf", "model/step", "application/json"] },
          },
        },
        {
          id: "ART-CHANGE-IMPACT",
          path: "artifacts/design/change-impact.json",
          role: "supporting",
          requiredOutputRef: "OUT-009",
          mediaType: "application/json",
          requiredFields: ["affectedOutputRefs", "revisedArtifactPaths"],
        },
      ],
      conditionalChangeResponse: {
        triggerCheckpoint: "CKPT-050",
        impactArtifact: "artifacts/design/change-impact.json",
        affectedOutputRefs: ["OUT-001", "OUT-002", "OUT-004", "OUT-006"],
      },
    };
    const nativePath = "artifacts/cad/source/assembly.fcstd";
    // A candidate source byte that would terminate Node if it were executed.
    const nativeSource = Buffer.from("process.exit(99);\n", "utf8");
    const stepPath = "artifacts/cad/assembly.step";
    const bomPath = "artifacts/bom/bom.csv";
    const drawingIndexPath = "artifacts/drawings/critical-drawing-index.csv";
    const drawingPath = "artifacts/drawings/critical.pdf";
    const pmiPath = "artifacts/drawings/critical-pmi.json";
    const impactPath = "artifacts/design/change-impact.json";
    const reissued = [
      "artifacts/cad/source-manifest.json",
      stepPath,
      bomPath,
      drawingIndexPath,
      drawingPath,
      pmiPath,
    ];
    await writeFile(path.join(candidateRoot, nativePath), nativeSource);
    await writeFile(path.join(candidateRoot, "artifacts", "cad", "source-manifest.json"), `${JSON.stringify({
      sourceFiles: [{
        path: nativePath,
        mediaType: "application/x-opaque-cad",
        sha256: sha256(nativeSource),
      }],
    })}\n`);
    await writeFile(path.join(candidateRoot, stepPath), "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    await writeFile(path.join(candidateRoot, bomPath), "partNumber\nA-1\n");
    await writeFile(path.join(candidateRoot, drawingIndexPath), `drawingPath,pmiPath\n${drawingPath},${pmiPath}\n`);
    await writeFile(path.join(candidateRoot, drawingPath), "%PDF-1.7\n%%EOF\n");
    await writeFile(path.join(candidateRoot, pmiPath), "{\"pmiRecords\":[{\"id\":\"PMI-001\"}]}\n");

    const artifact = (filePath, role, mediaType, requiredOutputRef) => ({
      path: filePath,
      role,
      mediaType,
      requiredOutputRefs: [requiredOutputRef],
      status: "present",
    });
    const submission = {
      artifacts: [
        artifact("artifacts/cad/source-manifest.json", "cad-source", "application/json", "OUT-001"),
        artifact(nativePath, "cad-source", "application/x-opaque-cad", "OUT-001"),
        artifact(stepPath, "step", "model/step", "OUT-002"),
        artifact(bomPath, "bom", "text/csv", "OUT-004"),
        artifact(drawingIndexPath, "drawing", "text/csv", "OUT-006"),
        artifact(drawingPath, "drawing", "application/pdf", "OUT-006"),
        artifact(pmiPath, "drawing", "application/json", "OUT-006"),
        artifact(impactPath, "supporting", "application/json", "OUT-009"),
      ],
      partialAttainment: { highestVerifiedCheckpointId: "CKPT-050" },
    };
    const writeImpact = async (revisedArtifactPaths = reissued) => {
      await writeFile(path.join(candidateRoot, impactPath), `${JSON.stringify({
        affectedOutputRefs: ["OUT-001", "OUT-002", "OUT-004", "OUT-006"],
        revisedArtifactPaths,
      })}\n`);
    };
    await writeImpact();
    await writeFile(path.join(candidateRoot, "submission.json"), `${JSON.stringify(submission)}\n`);
    const contractBytes = Buffer.from(JSON.stringify(contract));
    const contractPath = path.join(temporaryParent, "output-contract.json");
    await writeFile(contractPath, contractBytes);
    const preflightArgs = [
      "tools/stage1-preflight.mjs",
      "--root", "candidate-output",
      "--highest", "CKPT-050",
      "--submission", "submission.json",
      "--contract", contractPath,
      "--contract-sha256", sha256(contractBytes),
    ];

    const valid = JSON.parse(await runNode(preflightArgs, workspace));
    assert.equal(valid.status, "valid", JSON.stringify(valid));
    assert.equal(valid.indexedArtifacts.length, 3);
    assert.equal(valid.coverage.dueArtifactCount, 5);

    await writeImpact(reissued.filter((artifactPath) => artifactPath !== pmiPath));
    let result = await runNodeResult(preflightArgs, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(({ code }) => code === "change-affected-artifact-not-reissued"));

    await writeImpact();
    await writeFile(path.join(candidateRoot, nativePath), "changed bytes\n");
    result = await runNodeResult(preflightArgs, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(({ code }) => code === "indexed-cad-source-hash-mismatch"));

    await writeFile(path.join(candidateRoot, nativePath), nativeSource);
    await writeFile(path.join(candidateRoot, stepPath), "not a STEP file\n");
    result = await runNodeResult(preflightArgs, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(({ code }) => code === "artifact-step-invalid-envelope"));

    await writeFile(path.join(candidateRoot, stepPath), "ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\nENDSEC;\nEND-ISO-10303-21;\n");
    await writeFile(path.join(candidateRoot, drawingPath), "not a PDF\n");
    result = await runNodeResult(preflightArgs, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(({ code }) => code === "indexed-drawing-pdf-invalid"));
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});
