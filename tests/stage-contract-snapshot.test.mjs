import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sha256 } from "../scripts/framework-lib.mjs";
import { validateCandidateBundle } from "../scripts/stage-contract.mjs";

const execFileAsync = promisify(execFile);
const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const checkpointScript = path.join(repositoryRoot, "scripts", "stage1-checkpoint.mjs");
const noSchemaIssues = () => [];
const contractValidators = {
  validateSubmission: noSchemaIssues,
  validatePlan: noSchemaIssues,
  validateWorkRecord: noSchemaIssues,
};

async function checkpoint(args, cwd) {
  const result = await execFileAsync(process.execPath, [checkpointScript, ...args], { cwd });
  return JSON.parse(result.stdout);
}

async function writeJson(target, value) {
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(value, null, 2)}\n`);
}

test("v1.10 receipt validation binds exact change event and latest completed bytes", async () => {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "stage-contract-snapshot-"));
  const candidateRoot = path.join(temporaryRoot, "candidate-output");
  try {
    await mkdir(candidateRoot);
    const plan = {
      schemaVersion: "1.0",
      status: "initial",
      requirements: [{ id: "REQ-001", source: "fixture", statement: "fixture" }],
      assumptions: [],
      steps: [{ id: "STEP-001", statement: "fixture", requirementRefs: ["REQ-001"] }],
      alternativesToEvaluate: [],
      verificationPlan: [{
        id: "VER-001",
        requirementRefs: ["REQ-001"],
        method: "inspection",
        expectedEvidence: "fixture",
      }],
    };
    const workRecord = {
      schemaVersion: "1.0",
      alternatives: [],
      decisions: [],
      planRevisions: [],
      verificationClaims: [],
    };
    await writeJson(path.join(candidateRoot, "plan.json"), plan);
    await writeJson(path.join(candidateRoot, "work-record.json"), workRecord);
    await execFileAsync(process.execPath, [
      checkpointScript,
      "--root", candidateRoot,
    ], { cwd: temporaryRoot });
    const receipt000 = await checkpoint([
      "--root", candidateRoot,
      "--checkpoint", "CKPT-000",
      "--at", "2026-07-30T00:00:00.000Z",
    ], temporaryRoot);

    const conceptPath = "artifacts/design/concept.json";
    const impactPath = "artifacts/design/change-impact.json";
    const conceptBytes = Buffer.from('{"marker":"sealed"}\n');
    const impactBytes = Buffer.from(
      '{"changeEventId":"CHG-001","affectedOutputRefs":[],"revisedArtifactPaths":[]}\n',
    );
    await mkdir(path.join(candidateRoot, "artifacts", "design"), { recursive: true });
    await writeFile(path.join(candidateRoot, conceptPath), conceptBytes);
    const outputContract = {
      version: "fixture-1.10",
      candidateCheckpoints: [
        {
          id: "CKPT-010",
          requiresPriorCheckpointIds: ["CKPT-000"],
          requiredArtefacts: [conceptPath],
        },
        {
          id: "CKPT-050",
          requiresPriorCheckpointIds: ["CKPT-010"],
          requiredArtefacts: [impactPath],
        },
      ],
      artefacts: [
        {
          id: "ART-CONCEPT",
          path: conceptPath,
          role: "supporting",
          requiredOutputRef: "OUT-002",
          mediaType: "application/json",
        },
        {
          id: "ART-IMPACT",
          path: impactPath,
          role: "supporting",
          requiredOutputRef: "OUT-009",
          mediaType: "application/json",
        },
      ],
      conditionalChangeResponse: {
        triggerCheckpoint: "CKPT-050",
        changeEventId: "CHG-001",
        impactArtifact: impactPath,
        affectedOutputRefs: ["OUT-002"],
      },
    };
    const contractPath = path.join(temporaryRoot, "output-contract.json");
    await writeJson(contractPath, outputContract);
    const contractBytes = await readFile(contractPath);
    const contractSha256 = sha256(contractBytes);
    const receipt010 = await checkpoint([
      "--root", candidateRoot,
      "--checkpoint", "CKPT-010",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
      "--at", "2026-07-30T00:01:00.000Z",
    ], temporaryRoot);
    await writeFile(path.join(candidateRoot, impactPath), impactBytes);
    const receipt050 = await checkpoint([
      "--root", candidateRoot,
      "--checkpoint", "CKPT-050",
      "--change-event", "CHG-001",
      "--contract", contractPath,
      "--contract-sha256", contractSha256,
      "--at", "2026-07-30T00:02:00.000Z",
    ], temporaryRoot);

    const planBytes = await readFile(path.join(candidateRoot, "plan.json"));
    const initialPlanCheckpointBytes = await readFile(
      path.join(candidateRoot, "initial-plan.sha256"),
    );
    const workRecordBytes = await readFile(path.join(candidateRoot, "work-record.json"));
    const submission = {
      protocolVersion: "4.0",
      status: "partial",
      initialPlan: { path: "plan.json", sha256: sha256(planBytes) },
      initialPlanCheckpoint: {
        path: "initial-plan.sha256",
        sha256: sha256(initialPlanCheckpointBytes),
      },
      workRecord: { path: "work-record.json", sha256: sha256(workRecordBytes) },
      checkpointReceipts: [receipt000, receipt010, receipt050],
      partialAttainment: {
        attemptedCheckpointIds: ["CKPT-000", "CKPT-010", "CKPT-050"],
        completedCheckpointIds: ["CKPT-000", "CKPT-010", "CKPT-050"],
        highestVerifiedCheckpointId: "CKPT-050",
        stoppedReason: "candidate-stop",
      },
      sanitizationRequest: { profileDigest: "1".repeat(64) },
      artifacts: [
        { id: "ART-CONCEPT", path: conceptPath, sha256: sha256(conceptBytes) },
        { id: "ART-IMPACT", path: impactPath, sha256: sha256(impactBytes) },
      ],
    };
    const validate = () => validateCandidateBundle(candidateRoot, {
      requireReceiptSnapshots: true,
      outputContract,
      outputContractSha256: contractSha256,
      contractValidators,
    });
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    let result = await validate();
    assert.equal(result.status, "valid", result.issues.join("\n"));

    submission.checkpointReceipts[1] = {
      ...receipt010,
      previousReceiptSha256: "f".repeat(64),
    };
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    result = await validate();
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.some((message) => message.includes("does not bind the prior receipt digest")));
    submission.checkpointReceipts[1] = receipt010;

    const receipt050Path = path.join(candidateRoot, receipt050.path);
    const receipt050Bytes = await readFile(receipt050Path);
    const receipt050Record = JSON.parse(receipt050Bytes.toString("utf8"));
    delete receipt050Record.changeEventId;
    await writeJson(receipt050Path, receipt050Record);
    submission.checkpointReceipts[2] = {
      ...receipt050,
      sha256: sha256(await readFile(receipt050Path)),
    };
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    result = await validate();
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.some((message) => (
      message.includes("must have required property 'changeEventId'")
      || message.includes("exact CKPT-050")
    )));
    await writeFile(receipt050Path, receipt050Bytes);

    submission.checkpointReceipts[2] = {
      ...submission.checkpointReceipts[2],
      changeEventId: undefined,
      sha256: receipt050.sha256,
    };
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    result = await validate();
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.some((message) => message.includes("exact CKPT-050")));

    submission.checkpointReceipts[2] = {
      ...receipt050,
      changeEventId: "CHG-999",
    };
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    result = await validate();
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.some((message) => message.includes("exact CKPT-050")));

    submission.checkpointReceipts[2] = receipt050;
    await writeFile(path.join(candidateRoot, conceptPath), '{"marker":"replaced"}\n');
    submission.artifacts[0].sha256 = sha256(await readFile(path.join(candidateRoot, conceptPath)));
    await writeJson(path.join(candidateRoot, "submission.json"), submission);
    result = await validate();
    assert.equal(result.status, "invalid");
    assert.ok(result.issues.some((message) => message.includes("latest completed receipt snapshot")));
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
});
