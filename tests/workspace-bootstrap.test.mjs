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
const bundleV2Path = path.join(
  projectRoot,
  "workspace-bootstrap",
  "integrated-robotic-handling-v2.json",
);
const profileV2Path = path.join(
  projectRoot,
  "execution-profiles",
  "integrated-robotic-handling-v2",
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

test("v2 bootstrap seals create-only output-contract-bound artifact snapshots", async () => {
  const temporaryParent = await mkdtemp(path.join(os.tmpdir(), "edbf-bootstrap-v2-"));
  const workspace = path.join(temporaryParent, "workspace");
  const candidateRoot = path.join(workspace, "candidate-output");
  try {
    const materialized = await materializeWorkspaceBootstrap({
      bundlePath: bundleV2Path,
      targetRoot: workspace,
    });
    const profile = JSON.parse(await readFile(profileV2Path, "utf8"));
    assert.equal(profile.version, "1.1");
    assert.equal(profile.workspaceBootstrap.sha256, materialized.bundleSha256);
    assert.equal(
      profile.workspaceBootstrap.location,
      "https://naoyamd.github.io/rotorbench/framework/workspaces/integrated-robotic-handling-v2.json",
    );

    const planBytes = Buffer.from(`${JSON.stringify({
      schemaVersion: "1.0",
      status: "initial",
      requirements: [{ id: "REQ-001", source: "test", statement: "test requirement" }],
      assumptions: [],
      steps: [{ id: "STEP-001", statement: "test step", requirementRefs: ["REQ-001"] }],
      alternativesToEvaluate: [],
      verificationPlan: [{ id: "VER-001", requirementRefs: ["REQ-001"], method: "inspect", expectedEvidence: "test" }],
    })}\n`);
    await writeFile(path.join(candidateRoot, "plan.json"), planBytes);
    await runNode(["tools/stage1-checkpoint.mjs", "--root", "candidate-output"], workspace);
    await mkdir(path.join(candidateRoot, "artifacts", "design"), { recursive: true });
    const contract = {
      version: "test-1.0",
      candidateCheckpoints: [
        {
          id: "CKPT-010",
          requiresPriorCheckpointIds: ["CKPT-000"],
          requiredArtefacts: ["artifacts/design/concept.json"],
        },
        {
          id: "CKPT-040",
          requiresPriorCheckpointIds: ["CKPT-010"],
          requiredArtefacts: [
            "artifacts/design/concept.json",
            "artifacts/cad/source-manifest.json",
            "artifacts/drawings/critical-drawing-index.csv",
          ],
        },
        {
          id: "CKPT-050",
          requiresPriorCheckpointIds: ["CKPT-040"],
          requiredArtefacts: ["artifacts/design/change-impact.json"],
        },
      ],
      artefacts: [
        {
          id: "ART-CONCEPT",
          path: "artifacts/design/concept.json",
          role: "supporting",
          requiredOutputRef: "OUT-002",
          mediaType: "application/json",
          requiredFields: ["marker"],
        },
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
            allowedMediaTypes: ["text/plain"],
          },
        },
        {
          id: "ART-DRAWING-INDEX",
          path: "artifacts/drawings/critical-drawing-index.csv",
          role: "drawing",
          requiredOutputRef: "OUT-006",
          mediaType: "text/csv",
          requiredFields: ["drawingPath"],
          indexedFileReferences: {
            kind: "csv-row-paths",
            drawingPath: {
              required: true,
              allowedMediaTypes: ["application/pdf"],
            },
            pathRoot: "artifacts/drawings",
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
        changeEventId: "CHG-001",
        impactArtifact: "artifacts/design/change-impact.json",
        affectedOutputRefs: ["OUT-001", "OUT-002", "OUT-006"],
      },
    };
    const contractPath = path.join(temporaryParent, "output-contract.json");
    await writeFile(contractPath, `${JSON.stringify(contract)}\n`);
    const contractSha256 = sha256(await readFile(contractPath));
    const checkpoint010 = [
      "tools/stage1-checkpoint.mjs",
      "--root", "candidate-output",
      "--checkpoint", "CKPT-010",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
    ];
    const checkpoint000 = JSON.parse(await runNode([
      "tools/stage1-checkpoint.mjs",
      "--root", "candidate-output",
      "--checkpoint", "CKPT-000",
    ], workspace));
    let result = await runNodeResult(checkpoint010, workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /concept\.json/);

    const conceptBytes = Buffer.from(`${JSON.stringify({ marker: "sealed" })}\n`);
    await writeFile(path.join(candidateRoot, "artifacts", "design", "concept.json"), conceptBytes);
    const checkpoint010Receipt = JSON.parse(await runNode(checkpoint010, workspace));
    const checkpoint010Record = JSON.parse(await readFile(
      path.join(candidateRoot, checkpoint010Receipt.path),
      "utf8",
    ));
    assert.equal(checkpoint010Record.schemaVersion, "1.1");
    assert.deepEqual(checkpoint010Record.outputContract, {
      componentVersion: "test-1.0",
      sha256: contractSha256,
      requiredArtefactPaths: ["artifacts/design/concept.json"],
    });
    assert.equal(checkpoint010Record.artifactSnapshots.length, 1);
    const [snapshot] = checkpoint010Record.artifactSnapshots;
    assert.equal(snapshot.sourcePath, "artifacts/design/concept.json");
    assert.equal(snapshot.snapshotPath, "receipts/snapshots/001-CKPT-010/artifacts/design/concept.json");

    const writeSubmission = async ({
      artifacts,
      receipts,
      completedCheckpointIds,
      highestVerifiedCheckpointId,
    }) => {
      await writeFile(path.join(candidateRoot, "submission.json"), `${JSON.stringify({
        artifacts,
        checkpointReceipts: receipts,
        partialAttainment: {
          completedCheckpointIds,
          highestVerifiedCheckpointId,
        },
      })}\n`);
    };
    const conceptArtifact = {
      id: "ART-CONCEPT",
      path: "artifacts/design/concept.json",
      role: "supporting",
      mediaType: "application/json",
      requiredOutputRefs: ["OUT-002"],
      status: "present",
      sha256: sha256(conceptBytes),
    };
    await writeFile(
      path.join(candidateRoot, "artifacts", "design", "concept.json"),
      `${JSON.stringify({ marker: "changed-after-checkpoint" })}\n`,
    );
    await writeSubmission({
      artifacts: [conceptArtifact],
      receipts: [checkpoint000, checkpoint010Receipt],
      completedCheckpointIds: ["CKPT-000", "CKPT-010"],
      highestVerifiedCheckpointId: "CKPT-010",
    });
    const preflight010Args = [
      "tools/stage1-preflight.mjs",
      "--root", "candidate-output",
      "--highest", "CKPT-010",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
      "--submission", "submission.json",
    ];
    result = await runNodeResult(preflight010Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "submission-artifact-current-snapshot-mismatch",
    ));

    await writeFile(path.join(candidateRoot, "artifacts", "design", "concept.json"), conceptBytes);
    let valid = JSON.parse(await runNode(preflight010Args, workspace));
    assert.equal(valid.status, "valid", JSON.stringify(valid));

    await writeSubmission({
      artifacts: [conceptArtifact],
      receipts: [
        checkpoint000,
        {
          ...checkpoint010Receipt,
          previousReceiptSha256: "f".repeat(64),
        },
      ],
      completedCheckpointIds: ["CKPT-000", "CKPT-010"],
      highestVerifiedCheckpointId: "CKPT-010",
    });
    result = await runNodeResult(preflight010Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "submission-receipt-declaration-chain-mismatch",
    ));

    const checkpoint010Bytes = await readFile(path.join(candidateRoot, checkpoint010Receipt.path));
    const checkpoint010WithBadEvidence = JSON.parse(checkpoint010Bytes.toString("utf8"));
    checkpoint010WithBadEvidence.evidence.push({
      path: "artifacts/design/concept.json",
      sha256: "0".repeat(64),
    });
    await writeFile(
      path.join(candidateRoot, checkpoint010Receipt.path),
      `${JSON.stringify(checkpoint010WithBadEvidence)}\n`,
    );
    await writeSubmission({
      artifacts: [conceptArtifact],
      receipts: [
        checkpoint000,
        {
          ...checkpoint010Receipt,
          sha256: sha256(await readFile(path.join(candidateRoot, checkpoint010Receipt.path))),
        },
      ],
      completedCheckpointIds: ["CKPT-000", "CKPT-010"],
      highestVerifiedCheckpointId: "CKPT-010",
    });
    result = await runNodeResult(preflight010Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "receipt-evidence-hash-mismatch",
    ));
    await writeFile(path.join(candidateRoot, checkpoint010Receipt.path), checkpoint010Bytes);
    await writeSubmission({
      artifacts: [conceptArtifact],
      receipts: [checkpoint000, checkpoint010Receipt],
      completedCheckpointIds: ["CKPT-000", "CKPT-010"],
      highestVerifiedCheckpointId: "CKPT-010",
    });

    await writeFile(path.join(candidateRoot, "plan.json"), "retrospective plan\n");
    result = await runNodeResult(preflight010Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "receipt-ckpt000-plan",
    ));
    await writeFile(path.join(candidateRoot, "plan.json"), planBytes);

    await writeFile(path.join(candidateRoot, snapshot.snapshotPath), "tampered snapshot\n");
    result = await runNodeResult(preflight010Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "receipt-snapshot-bytes",
    ));
    await writeFile(path.join(candidateRoot, snapshot.snapshotPath), conceptBytes);

    const sourcePath = "artifacts/cad/source/model.txt";
    const sourceManifestPath = "artifacts/cad/source-manifest.json";
    const drawingIndexPath = "artifacts/drawings/critical-drawing-index.csv";
    const drawingPath = "artifacts/drawings/detail.pdf";
    const sourceBytes = Buffer.from("opaque native source bytes\n");
    const drawingBytes = Buffer.from("%PDF-1.4\nbaseline drawing\n%%EOF\n");
    await mkdir(path.join(candidateRoot, "artifacts", "cad", "source"), { recursive: true });
    await mkdir(path.join(candidateRoot, "artifacts", "drawings"), { recursive: true });
    await writeFile(path.join(candidateRoot, sourcePath), sourceBytes);
    const sourceManifestBytes = Buffer.from(`${JSON.stringify({
      sourceFiles: [{
        path: sourcePath,
        mediaType: "text/plain",
        sha256: sha256(sourceBytes),
      }],
    })}\n`);
    const drawingIndexBytes = Buffer.from(`drawingPath\n${drawingPath}\n`);
    await writeFile(path.join(candidateRoot, sourceManifestPath), sourceManifestBytes);
    await writeFile(path.join(candidateRoot, drawingIndexPath), drawingIndexBytes);
    const checkpoint040Args = [
      "tools/stage1-checkpoint.mjs",
      "--root", "candidate-output",
      "--checkpoint", "CKPT-040",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
    ];
    result = await runNodeResult(checkpoint040Args, workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /detail\.pdf/);

    await writeFile(path.join(candidateRoot, drawingPath), drawingBytes);
    const checkpoint040Receipt = JSON.parse(await runNode(checkpoint040Args, workspace));
    const checkpoint040Record = JSON.parse(await readFile(
      path.join(candidateRoot, checkpoint040Receipt.path),
      "utf8",
    ));
    assert.deepEqual(
      checkpoint040Record.artifactSnapshots.map(({ sourcePath: value }) => value).sort(),
      [
        "artifacts/cad/source-manifest.json",
        "artifacts/cad/source/model.txt",
        "artifacts/design/concept.json",
        "artifacts/drawings/critical-drawing-index.csv",
        "artifacts/drawings/detail.pdf",
      ],
    );

    const baselineArtifacts = [
      conceptArtifact,
      {
        id: "ART-SOURCE-MANIFEST",
        path: sourceManifestPath,
        role: "cad-source",
        mediaType: "application/json",
        requiredOutputRefs: ["OUT-001"],
        status: "present",
        sha256: sha256(sourceManifestBytes),
      },
      {
        id: "ART-SOURCE",
        path: sourcePath,
        role: "cad-source",
        mediaType: "text/plain",
        requiredOutputRefs: ["OUT-001"],
        status: "present",
        sha256: sha256(sourceBytes),
      },
      {
        id: "ART-DRAWING-INDEX",
        path: drawingIndexPath,
        role: "drawing",
        mediaType: "text/csv",
        requiredOutputRefs: ["OUT-006"],
        status: "present",
        sha256: sha256(drawingIndexBytes),
      },
      {
        id: "ART-DRAWING",
        path: drawingPath,
        role: "drawing",
        mediaType: "application/pdf",
        requiredOutputRefs: ["OUT-006"],
        status: "present",
        sha256: sha256(drawingBytes),
      },
    ];
    await writeSubmission({
      artifacts: baselineArtifacts,
      receipts: [checkpoint000, checkpoint010Receipt, checkpoint040Receipt],
      completedCheckpointIds: ["CKPT-000", "CKPT-010", "CKPT-040"],
      highestVerifiedCheckpointId: "CKPT-040",
    });
    const preflight040Args = [
      "tools/stage1-preflight.mjs",
      "--root", "candidate-output",
      "--highest", "CKPT-040",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
      "--submission", "submission.json",
    ];
    valid = JSON.parse(await runNode(preflight040Args, workspace));
    assert.equal(valid.status, "valid", JSON.stringify(valid));

    await writeFile(
      path.join(candidateRoot, drawingPath),
      "%PDF-1.4\nchanged but valid drawing\n%%EOF\n",
    );
    result = await runNodeResult(preflight040Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "submission-artifact-current-snapshot-mismatch",
    ));
    await writeFile(path.join(candidateRoot, drawingPath), drawingBytes);

    const indexedDrawingSnapshot = checkpoint040Record.artifactSnapshots.find(
      ({ sourcePath: value }) => value === drawingPath,
    );
    await writeFile(
      path.join(candidateRoot, indexedDrawingSnapshot.snapshotPath),
      "tampered indexed snapshot\n",
    );
    result = await runNodeResult(preflight040Args, workspace);
    assert.equal(result.code, 1);
    assert.ok(JSON.parse(result.stdout).admissionIssues.some(
      ({ code }) => code === "receipt-snapshot-bytes",
    ));
    await writeFile(path.join(candidateRoot, indexedDrawingSnapshot.snapshotPath), drawingBytes);

    await writeFile(
      path.join(candidateRoot, "artifacts", "design", "change-impact.json"),
      `${JSON.stringify({
        changeEventId: "CHG-001",
        affectedOutputRefs: ["OUT-002"],
        revisedArtifactPaths: [],
      })}\n`,
    );
    const checkpoint050Base = [
      "tools/stage1-checkpoint.mjs",
      "--root", "candidate-output",
      "--checkpoint", "CKPT-050",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
    ];
    result = await runNodeResult(checkpoint050Base, workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires --change-event/);
    result = await runNodeResult([
      ...checkpoint050Base,
      "--change-event", "CHG-999",
    ], workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /requires exact change event CHG-001/);
    result = await runNodeResult([
      ...checkpoint050Base,
      "--change-event", "CHG-001",
    ], workspace);
    assert.equal(result.code, 1);
    assert.match(result.stderr, /OUT-002 is affected but artifacts\/design\/concept\.json is absent/);
  } finally {
    await rm(temporaryParent, { recursive: true, force: true });
  }
});
