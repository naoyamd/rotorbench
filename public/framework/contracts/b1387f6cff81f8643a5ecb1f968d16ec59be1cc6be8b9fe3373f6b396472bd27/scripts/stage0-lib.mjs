import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { createRequire } from "node:module";
import {
  computeFairnessFingerprint,
  canonicalJson,
  ensureInside,
  manifestDigest,
  pathExists,
  readJson,
  sha256,
  validateBaselineAttestation,
  validateActivationVerification,
  validateEngineeringReview,
  validateExecutionProfile,
  validateLaunch,
  validateLaunchRelease,
  validateLiveVerification,
  validatePacketLock,
  validateProtocolReview,
  validateTaskDefinition,
  validateTaskPacket,
} from "./framework-lib.mjs";
import { MODEL_LAUNCH_MESSAGE } from "../shared/prompts.mjs";

const execFileAsync = promisify(execFile);
const zero40 = "0".repeat(40);
const zero64 = "0".repeat(64);

export function canonicalBaseUrl(value) {
  if (typeof value !== "string") {
    throw new Error("canonicalBaseUrl must be a string");
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("canonicalBaseUrl is not a valid URL");
  }
  if (
    parsed.protocol !== "https:"
    || parsed.username
    || parsed.password
    || parsed.search
    || parsed.hash
    || !parsed.hostname
    || !/^\/(?:[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*)?$/.test(parsed.pathname)
  ) {
    throw new Error("canonicalBaseUrl must be HTTPS, credential-free, query-free, fragment-free, and have a canonical path");
  }
  const canonical = `${parsed.origin}${parsed.pathname === "/" ? "" : parsed.pathname}`;
  if (value !== canonical) {
    throw new Error("canonicalBaseUrl must use canonical spelling without a trailing slash");
  }
  return canonical;
}

function publicUrl(canonicalBase, relativePath) {
  return `${canonicalBase}/${relativePath}`;
}

function packetForFrozenPrompt(packet, launch, instructionsText) {
  const base = canonicalBaseUrl(launch.canonicalBaseUrl);
  const packetRoot = `framework/task-packets/${packet.id}/${packet.version}`;
  const contractRoot = `framework/contracts/${launch.executionContractDigest}/schemas`;
  return {
    ...packet,
    instructionsText,
    inputs: (packet.inputs ?? []).map((input) => ({
      ...input,
      sourceUrl: publicUrl(base, `${packetRoot}/${input.path}`),
    })),
    contractUrls: {
      plan: publicUrl(base, `${contractRoot}/plan.schema.json`),
      workRecord: publicUrl(base, `${contractRoot}/work-record.schema.json`),
      submission: publicUrl(base, `${contractRoot}/submission.schema.json`),
      artifact: publicUrl(base, `${contractRoot}/artifact.schema.json`),
      ...(launch.protocolVersion === "4.0" ? {
        stageV4: publicUrl(base, `${contractRoot}/stage-contract-v4.schema.json`),
        evaluationRecord: publicUrl(base, `${contractRoot}/evaluation-record.schema.json`),
        assessmentEvidence: publicUrl(base, `${contractRoot}/assessment-evidence.schema.json`),
      } : {}),
    },
    ...(launch.workspaceBootstrap ? { workspaceBootstrap: launch.workspaceBootstrap } : {}),
  };
}

function posixRelative(root, candidate) {
  return path.relative(root, candidate).split(path.sep).join("/");
}

async function listExactRegularFiles(root, directory = root) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const candidate = path.join(directory, entry.name);
    const relative = posixRelative(root, candidate);
    if (entry.isSymbolicLink()) {
      throw new Error(`Symbolic links are not permitted: ${relative}`);
    }
    if (entry.isDirectory()) {
      files.push(...await listExactRegularFiles(root, candidate));
    } else if (entry.isFile()) {
      files.push(relative);
    } else {
      throw new Error(`Unsupported filesystem entry: ${relative}`);
    }
  }
  return files.sort();
}

function sameStringSet(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function taskSourceFiles(task) {
  return [
    "task.json",
    task.instructions?.path,
    ...(task.inputs ?? []).map((input) => input.path),
  ].sort();
}

function frozenPacketFiles(task) {
  return [
    ...taskSourceFiles(task),
    "packet.json",
    "packet-lock.json",
  ].sort();
}

function buildPacketFromTask(task, instructionBytes, inputBytes) {
  return {
    schemaVersion: task.schemaVersion,
    id: task.id,
    version: task.version,
    title: task.title,
    ...(task.summary ? { summary: task.summary } : {}),
    taskDefinitionDigest: manifestDigest(task),
    authorId: task.author.id,
    instructions: toPacketFile(task.instructions, instructionBytes),
    inputs: task.inputs.map((input, index) => toPacketFile(input, inputBytes[index])),
    requiredOutputs: task.requiredOutputs,
    environment: task.environment,
    completionCriteria: task.completionCriteria,
    ...(task.schemaVersion === "4.0" ? {
      v4Contract: task.v4Contract,
      checkpoints: task.checkpoints,
      changeEvents: task.changeEvents,
    } : {}),
  };
}

export function packetVersionRoot(projectRoot, packetId, version) {
  return path.join(projectRoot, "task-packets", packetId, version);
}

export function launchRoot(projectRoot, launchId) {
  return path.join(projectRoot, "launches", launchId);
}

export function activationRoot(projectRoot, launchId) {
  return path.join(projectRoot, "activations", launchId);
}

export function issueText(issues) {
  return issues.map((issue) => `${issue.code}: ${issue.message}`).join("\n");
}

function addIssue(issues, code, message, issuePath) {
  issues.push({ code, message, ...(issuePath ? { path: issuePath } : {}) });
}

export async function readRegularFileInside(root, relativePath) {
  const candidate = ensureInside(root, relativePath);
  if (!candidate) throw new Error(`Unsafe relative path: ${relativePath}`);
  const fileStats = await lstat(candidate);
  if (!fileStats.isFile() || fileStats.isSymbolicLink()) {
    throw new Error(`Declared path is not a regular file: ${relativePath}`);
  }
  const [resolvedRoot, resolvedFile] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Declared path escapes its root: ${relativePath}`);
  }
  return readFile(candidate);
}

function validateTaskRelationships(task) {
  const issues = [];
  const declaredPaths = new Set(["task.json"]);
  for (const declaration of [task?.instructions, ...(task?.inputs ?? [])]) {
    if (!declaration?.path) continue;
    if (declaredPaths.has(declaration.path)) {
      addIssue(issues, "duplicate-declared-file", `${declaration.path} is declared more than once`, declaration.path);
    }
    declaredPaths.add(declaration.path);
  }
  const outputIds = new Set();
  for (const output of task?.requiredOutputs ?? []) {
    if (outputIds.has(output.id)) {
      addIssue(issues, "duplicate-output-id", `${output.id} is duplicated`, "requiredOutputs");
    }
    outputIds.add(output.id);
  }
  const criterionIds = new Set();
  for (const criterion of task?.completionCriteria ?? []) {
    if (criterionIds.has(criterion.id)) {
      addIssue(issues, "duplicate-criterion-id", `${criterion.id} is duplicated`, "completionCriteria");
    }
    criterionIds.add(criterion.id);
    for (const ref of criterion.requiredOutputRefs ?? []) {
      if (!outputIds.has(ref)) {
        addIssue(
          issues,
          "unknown-required-output",
          `${criterion.id} references unknown output ${ref}`,
          "completionCriteria",
        );
      } else {
        const output = (task.requiredOutputs ?? []).find((entry) => entry.id === ref);
        if (output && !criterion.evidenceRoles?.includes(output.role)) {
          addIssue(
            issues,
            "criterion-output-role-mismatch",
            `${criterion.id} must admit the declared role for ${ref}`,
            "completionCriteria",
          );
        }
      }
    }
  }
  for (const value of task?.engineeringValues ?? []) {
    if (value.status === "unresolved" || value.source?.kind === "author-assumption") {
      addIssue(
        issues,
        "blocking-engineering-value",
        `${value.id} is unresolved or based on an author assumption`,
        "engineeringValues",
      );
    }
  }
  if (task?.schemaVersion === "4.0") {
    const contract = task.v4Contract ?? {};
    const commitments = [
      contract.instanceBankManifest,
      contract.visibilityPolicy,
      contract.checkpointContract,
      contract.changeEventContract,
      contract.evaluationContract,
      contract.sanitizationProfile,
      ...(contract.sealedAssetCommitments ?? []),
      ...(contract.disclosureSchedule ?? []),
    ].filter(Boolean);
    const commitmentIds = new Set();
    for (const commitment of commitments) {
      if (commitmentIds.has(commitment.id)) {
        addIssue(issues, "duplicate-v4-commitment", `${commitment.id} is duplicated`, "v4Contract");
      }
      commitmentIds.add(commitment.id);
    }
    const expectedVisibility = [
      ["visibilityPolicy", "candidate-public"],
      ["checkpointContract", "candidate-public"],
      ["changeEventContract", "event-private-change"],
      ["evaluationContract", "candidate-public"],
      ["sanitizationProfile", "candidate-public"],
    ];
    if (
      contract.instanceBankManifest
      && !["candidate-public", "run-private-instance"].includes(
        contract.instanceBankManifest.visibilityClass,
      )
    ) {
      addIssue(
        issues,
        "v4-visibility-policy",
        "instanceBankManifest must be candidate-public for a public anchor or run-private-instance for a provisioned private launch",
        "v4Contract.instanceBankManifest",
      );
    }
    for (const [key, visibilityClass] of expectedVisibility) {
      if (contract[key]?.visibilityClass !== visibilityClass) {
        addIssue(issues, "v4-visibility-policy", `${key} must use ${visibilityClass}`, `v4Contract.${key}`);
      }
    }
    const checkpoints = task.checkpoints ?? [];
    const checkpointIds = new Set();
    const checkpointSequences = new Set();
    const outputs = new Set((task.requiredOutputs ?? []).map((output) => output.id));
    for (const checkpoint of checkpoints) {
      if (checkpointIds.has(checkpoint.id)) {
        addIssue(issues, "duplicate-checkpoint-id", `${checkpoint.id} is duplicated`, "checkpoints");
      }
      checkpointIds.add(checkpoint.id);
      if (checkpointSequences.has(checkpoint.sequence)) {
        addIssue(issues, "duplicate-checkpoint-sequence", `checkpoint sequence ${checkpoint.sequence} is duplicated`, "checkpoints");
      }
      checkpointSequences.add(checkpoint.sequence);
      for (const outputRef of checkpoint.requiredOutputRefs ?? []) {
        if (!outputs.has(outputRef)) {
          addIssue(issues, "unknown-checkpoint-output", `${checkpoint.id} references unknown output ${outputRef}`, "checkpoints");
        }
      }
    }
    const checkpointsById = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
    for (const checkpoint of checkpoints) {
      for (const prerequisite of checkpoint.requiresPriorCheckpointIds ?? []) {
        const prior = checkpointsById.get(prerequisite);
        if (!prior) {
          addIssue(issues, "unknown-checkpoint-prerequisite", `${checkpoint.id} references unknown checkpoint ${prerequisite}`, "checkpoints");
        } else if (prior.sequence >= checkpoint.sequence) {
          addIssue(issues, "checkpoint-order", `${checkpoint.id} must follow ${prerequisite}`, "checkpoints");
        }
      }
    }
    const initial = checkpoints.find((checkpoint) => checkpoint.phase === "initial-plan" && checkpoint.sequence === 0);
    if (!initial) {
      addIssue(issues, "missing-initial-plan-checkpoint", "v4 requires an initial-plan checkpoint at sequence 0", "checkpoints");
    }
    const requirementIds = new Set((task.requiredOutputs ?? []).flatMap(() => []));
    // Requirement IDs are declared by the candidate plan; task-level change events bind their
    // identifiers syntactically here and are cross-checked when a candidate submits the plan.
    for (const event of task.changeEvents ?? []) {
      const trigger = checkpointsById.get(event.triggerAfterCheckpointId);
      const response = checkpointsById.get(event.responseCheckpointId);
      if (!trigger || !response) {
        addIssue(issues, "unknown-change-checkpoint", `${event.id} references an unknown checkpoint`, "changeEvents");
      } else if (trigger.sequence >= response.sequence) {
        addIssue(issues, "change-checkpoint-order", `${event.id} response checkpoint must follow its trigger`, "changeEvents");
      } else if (
        response.phase !== "change-response"
        || response.requiredForBaseline !== false
      ) {
        addIssue(
          issues,
          "change-checkpoint-baseline-boundary",
          `${event.id} response checkpoint must be an optional change-response checkpoint`,
          "changeEvents",
        );
      }
      if (event.visibilityClass !== "event-private-change") {
        addIssue(issues, "change-visibility", `${event.id} must remain event-private-change`, "changeEvents");
      }
      void requirementIds;
    }
  }
  return issues;
}

function validateV4PacketRelationships(packet) {
  const issues = [];
  if (packet?.schemaVersion !== "4.0") return issues;
  const declaredInputDigests = new Set((packet.inputs ?? []).map((input) => input.sha256));
  for (const key of ["visibilityPolicy", "checkpointContract", "evaluationContract", "sanitizationProfile"]) {
    if (packet.v4Contract?.[key]?.digest && !declaredInputDigests.has(packet.v4Contract[key].digest)) {
      addIssue(issues, "v4-public-contract-input", `${key} digest must be declared as a candidate-public task input`, `v4Contract.${key}`);
    }
  }
  return issues;
}

async function validateOutputContractArtifactAssignments(sourceRoot, task) {
  const issues = [];
  const declaration = (task.inputs ?? []).find(({ id }) => id === "output-contract");
  if (!declaration?.path) return issues;

  let contract;
  try {
    contract = JSON.parse((await readRegularFileInside(sourceRoot, declaration.path)).toString("utf8"));
  } catch {
    addIssue(
      issues,
      "output-contract-invalid-json",
      "output-contract must be readable JSON before packet freeze",
      declaration.path,
    );
    return issues;
  }

  const artefacts = contract?.artefacts;
  const candidateCheckpoints = contract?.candidateCheckpoints;
  if (!Array.isArray(artefacts)) {
    addIssue(
      issues,
      "output-contract-artefacts-invalid",
      "output-contract must declare an artefacts array",
      declaration.path,
    );
    return issues;
  }
  if (!Array.isArray(candidateCheckpoints)) {
    addIssue(
      issues,
      "output-contract-checkpoints-invalid",
      "output-contract must declare a candidateCheckpoints array",
      declaration.path,
    );
    return issues;
  }

  const packetCheckpoints = new Map((task.checkpoints ?? []).map((checkpoint) => [checkpoint.id, checkpoint]));
  const artefactsByPath = new Map();
  const artefactIds = new Set();
  for (const artefact of artefacts) {
    if (!artefact?.id || !artefact?.path || !artefact?.requiredOutputRef) {
      addIssue(
        issues,
        "output-contract-artefact-invalid",
        "Each output-contract artefact must declare id, path, and requiredOutputRef",
        declaration.path,
      );
      continue;
    }
    if (artefactIds.has(artefact.id) || artefactsByPath.has(artefact.path)) {
      addIssue(
        issues,
        "duplicate-output-contract-artefact",
        `${artefact.id} or ${artefact.path} is declared more than once`,
        declaration.path,
      );
      continue;
    }
    artefactIds.add(artefact.id);
    artefactsByPath.set(artefact.path, artefact);
  }

  const assignments = new Map();
  const outputContractCheckpointIds = new Set();
  for (const candidateCheckpoint of candidateCheckpoints) {
    const checkpointId = candidateCheckpoint?.id;
    if (!checkpointId || outputContractCheckpointIds.has(checkpointId)) {
      addIssue(
        issues,
        "output-contract-checkpoint-invalid",
        "Each output-contract candidate checkpoint must have a unique id",
        declaration.path,
      );
      continue;
    }
    outputContractCheckpointIds.add(checkpointId);
    const packetCheckpoint = packetCheckpoints.get(checkpointId);
    if (!packetCheckpoint) {
      addIssue(
        issues,
        "output-contract-unknown-checkpoint",
        `${checkpointId} is not a declared packet checkpoint`,
        declaration.path,
      );
      continue;
    }
    if (!Array.isArray(candidateCheckpoint.requiredArtefacts)) {
      addIssue(
        issues,
        "output-contract-checkpoint-artefacts-invalid",
        `${checkpointId} must declare requiredArtefacts as an array`,
        declaration.path,
      );
      continue;
    }
    for (const artefactPath of candidateCheckpoint.requiredArtefacts) {
      const artefact = artefactsByPath.get(artefactPath);
      if (!artefact) {
        addIssue(
          issues,
          "output-contract-unknown-artefact",
          `${checkpointId} assigns an undeclared artefact: ${artefactPath}`,
          declaration.path,
        );
        continue;
      }
      if (!(packetCheckpoint.requiredOutputRefs ?? []).includes(artefact.requiredOutputRef)) {
        addIssue(
          issues,
          "output-contract-checkpoint-output-mismatch",
          `${artefact.id} (${artefact.requiredOutputRef}) is assigned to ${checkpointId}, which does not require that output`,
          declaration.path,
        );
        continue;
      }
      const assigned = assignments.get(artefact.path) ?? [];
      assigned.push(checkpointId);
      assignments.set(artefact.path, assigned);
    }
  }

  for (const artefact of artefactsByPath.values()) {
    if (!(assignments.get(artefact.path) ?? []).length) {
      addIssue(
        issues,
        "unassigned-output-contract-artefact",
        `${artefact.id} (${artefact.path}) must be assigned to at least one valid packet checkpoint before freeze`,
        declaration.path,
      );
    }
  }
  return issues;
}

export async function lintTaskDefinition(sourceRoot) {
  const issues = [];
  let task;
  try {
    task = await readJson(path.join(sourceRoot, "task.json"));
  } catch {
    return {
      status: "invalid",
      issues: [{ code: "missing-task-definition", message: "task.json is missing or invalid" }],
    };
  }
  issues.push(...validateTaskDefinition(task));
  issues.push(...validateTaskRelationships(task));
  if (issues.length === 0) {
    const declarations = [task.instructions, ...(task.inputs ?? [])];
    for (const declaration of declarations) {
      try {
        await readRegularFileInside(sourceRoot, declaration.path);
      } catch (error) {
        addIssue(
          issues,
          "invalid-declared-file",
          error instanceof Error ? error.message : "Declared file is invalid",
          declaration.path,
        );
      }
    }
    if (issues.length === 0) {
      issues.push(...await validateOutputContractArtifactAssignments(sourceRoot, task));
    }
  }
  return { status: issues.length === 0 ? "valid" : "invalid", issues, task };
}

function packetBundleRecords(task) {
  return [
    "task.json",
    "packet.json",
    task.instructions.path,
    ...(task.inputs ?? []).map(({ path: inputPath }) => inputPath),
  ].sort();
}

export async function computePacketBundleDigest(root, task) {
  const records = [];
  for (const relativePath of packetBundleRecords(task)) {
    const bytes = await readRegularFileInside(root, relativePath);
    records.push(`${relativePath}\0${sha256(bytes)}\n`);
  }
  return sha256(Buffer.from(records.join("")));
}

function toPacketFile(declaration, bytes) {
  return {
    ...declaration,
    sha256: sha256(bytes),
    sizeBytes: bytes.byteLength,
  };
}

async function atomicPublishDirectory(sourceRoot, targetRoot, build) {
  if (await pathExists(targetRoot)) {
    throw new Error(`Destination already exists: ${targetRoot}`);
  }
  const parent = path.dirname(targetRoot);
  await mkdir(parent, { recursive: true });
  const temporary = path.join(
    parent,
    `.${path.basename(targetRoot)}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await mkdir(temporary, { recursive: false });
    await build(temporary);
    await rename(temporary, targetRoot);
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

export async function freezePacket({
  projectRoot,
  sourceRoot,
  packetId,
  version,
  now = new Date().toISOString(),
}) {
  const lint = await lintTaskDefinition(sourceRoot);
  if (lint.status !== "valid") {
    throw new Error(`Task definition is invalid:\n${issueText(lint.issues)}`);
  }
  const task = lint.task;
  if (task.id !== packetId || task.version !== version) {
    throw new Error("Task definition id/version does not match the requested destination");
  }
  const expectedSourceFiles = taskSourceFiles(task);
  let actualSourceFiles;
  try {
    actualSourceFiles = await listExactRegularFiles(sourceRoot);
  } catch (error) {
    throw new Error(`Task source is unsafe: ${error instanceof Error ? error.message : "cannot enumerate source"}`);
  }
  if (!sameStringSet(actualSourceFiles, expectedSourceFiles)) {
    throw new Error(
      `Task source must contain exactly task.json and declared files (found: ${actualSourceFiles.join(", ") || "none"})`,
    );
  }
  const targetRoot = packetVersionRoot(projectRoot, packetId, version);
  let result;
  await atomicPublishDirectory(sourceRoot, targetRoot, async (temporary) => {
    for (const relativePath of expectedSourceFiles) {
      const source = await readRegularFileInside(sourceRoot, relativePath);
      const destination = ensureInside(temporary, relativePath);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, source, { flag: "wx" });
    }
    const instructionBytes = await readRegularFileInside(
      temporary,
      task.instructions.path,
    );
    const inputBytes = [];
    for (const input of task.inputs) {
      inputBytes.push(await readRegularFileInside(temporary, input.path));
    }
    const taskDefinitionDigest = manifestDigest(task);
    const packet = buildPacketFromTask(task, instructionBytes, inputBytes);
    const packetIssues = validateTaskPacket(packet);
    packetIssues.push(...validateV4PacketRelationships(packet));
    if (packetIssues.length > 0) {
      throw new Error(`Generated packet is invalid:\n${issueText(packetIssues)}`);
    }
    await writeFile(
      path.join(temporary, "packet.json"),
      `${JSON.stringify(packet, null, 2)}\n`,
      { flag: "wx" },
    );
    const packetDigest = manifestDigest(packet);
    const bundleDigest = await computePacketBundleDigest(temporary, task);
    const lock = {
      schemaVersion: task.schemaVersion,
      status: "packet-frozen",
      taskPacket: { id: packet.id, version: packet.version },
      taskDefinitionDigest,
      packetDigest,
      bundleDigest,
      bundleAlgorithm: "sha256-packet-bundle-v1",
      frozenAt: now,
    };
    const lockIssues = validatePacketLock(lock);
    if (lockIssues.length > 0) {
      throw new Error(`Generated packet lock is invalid:\n${issueText(lockIssues)}`);
    }
    await writeFile(
      path.join(temporary, "packet-lock.json"),
      `${JSON.stringify(lock, null, 2)}\n`,
      { flag: "wx" },
    );
    result = { task, packet, lock, root: targetRoot };
  });
  return result;
}

export async function validateFrozenPacket(root) {
  const issues = [];
  let task;
  let packet;
  let lock;
  try {
    [task, packet, lock] = await Promise.all([
      readJson(path.join(root, "task.json")),
      readJson(path.join(root, "packet.json")),
      readJson(path.join(root, "packet-lock.json")),
    ]);
  } catch {
    return {
      status: "invalid",
      issues: [{ code: "missing-frozen-packet", message: "Frozen packet files are missing or invalid" }],
    };
  }
  issues.push(...validateTaskDefinition(task));
  issues.push(...validateTaskRelationships(task));
  issues.push(...validateTaskPacket(packet));
  issues.push(...validateV4PacketRelationships(packet));
  issues.push(...validatePacketLock(lock));
  try {
    const actualFiles = await listExactRegularFiles(root);
    const permittedFiles = [...frozenPacketFiles(task), "engineering-review.json"].sort();
    if (!actualFiles.every((file) => permittedFiles.includes(file))) {
      addIssue(issues, "undeclared-frozen-file", "Frozen packet contains a file outside its exact allowlist");
    }
    const requiredFiles = frozenPacketFiles(task);
    if (!requiredFiles.every((file) => actualFiles.includes(file))) {
      addIssue(issues, "missing-frozen-file", "Frozen packet is missing a required file");
    }
  } catch (error) {
    addIssue(
      issues,
      "frozen-packet-files-invalid",
      error instanceof Error ? error.message : "Frozen packet files cannot be enumerated",
    );
  }
  if (packet.id !== task.id || packet.version !== task.version) {
    addIssue(issues, "packet-identity-mismatch", "packet and task identity differ");
  }
  if (lock.taskPacket?.id !== task.id || lock.taskPacket?.version !== task.version) {
    addIssue(issues, "lock-task-packet-mismatch", "packet-lock taskPacket must bind the task id and version");
  }
  if (manifestDigest(task) !== lock.taskDefinitionDigest) {
    addIssue(issues, "task-definition-digest-mismatch", "task definition digest differs from lock");
  }
  if (manifestDigest(packet) !== lock.packetDigest) {
    addIssue(issues, "packet-digest-mismatch", "packet digest differs from lock");
  }
  try {
    const instructionBytes = await readRegularFileInside(root, task.instructions.path);
    const inputBytes = [];
    for (const input of task.inputs ?? []) {
      inputBytes.push(await readRegularFileInside(root, input.path));
    }
    const expectedPacket = buildPacketFromTask(task, instructionBytes, inputBytes);
    if (canonicalJson(expectedPacket) !== canonicalJson(packet)) {
      addIssue(issues, "packet-reconstruction-mismatch", "packet.json does not exactly reconstruct from task.json and declared bytes");
    }
    if (await computePacketBundleDigest(root, task) !== lock.bundleDigest) {
      addIssue(issues, "packet-bundle-digest-mismatch", "packet bundle digest differs from lock");
    }
  } catch (error) {
    addIssue(
      issues,
      "packet-bundle-invalid",
      error instanceof Error ? error.message : "Packet bundle cannot be read",
    );
  }
  return {
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    task,
    packet,
    lock,
    root,
  };
}

async function git(workspace, args) {
  return execFileAsync("git", ["-C", workspace, ...args], {
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function gitBytes(workspace, args) {
  return execFileAsync("git", ["-C", workspace, ...args], {
    encoding: "buffer",
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function verifyWorkspaceTree(root) {
  const rootStats = await lstat(root);
  if (!rootStats.isDirectory() || rootStats.isSymbolicLink()) {
    throw new Error("Git workspace root must be a real directory");
  }
  const resolvedRoot = await realpath(root);
  const walk = async (directory) => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const candidate = path.join(directory, entry.name);
      const relative = posixRelative(root, candidate);
      const atRepositoryMetadata = directory === root && entry.name === ".git";
      if (entry.name === ".git" && !atRepositoryMetadata) {
        throw new Error(`Nested .git metadata is not permitted: ${relative}`);
      }
      const stats = await lstat(candidate);
      if (stats.isSymbolicLink()) {
        throw new Error(`Symbolic links, junctions, and reparse points are not permitted: ${relative}`);
      }
      if (atRepositoryMetadata) {
        if (!stats.isDirectory() && !stats.isFile()) {
          throw new Error("Repository .git metadata is not a regular file or directory");
        }
        continue;
      }
      const resolvedCandidate = await realpath(candidate);
      if (
        resolvedCandidate !== resolvedRoot
        && !resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)
      ) {
        throw new Error(`Workspace path resolves outside the repository: ${relative}`);
      }
      if (stats.isDirectory()) {
        await walk(candidate);
      } else if (!stats.isFile()) {
        throw new Error(`Unsupported filesystem entry in workspace: ${relative}`);
      }
    }
  };
  await walk(root);
  return resolvedRoot;
}

export async function verifyGitWorkspace(workspace, now = new Date().toISOString()) {
  const absolute = path.resolve(workspace);
  const { stdout: rootOutput } = await git(absolute, ["rev-parse", "--show-toplevel"]);
  const repositoryRoot = path.resolve(rootOutput.trim());
  if (repositoryRoot !== absolute) {
    throw new Error("Workspace path must be the Git repository root");
  }
  const resolvedRepositoryRoot = await verifyWorkspaceTree(absolute);
  const { stdout: statusOutput } = await git(absolute, [
    "status",
    "--porcelain=v1",
    "--ignored",
    "--untracked-files=all",
  ]);
  if (statusOutput.trim()) throw new Error("Git workspace is dirty");
  const { stdout: strayOutput } = await git(absolute, [
    "ls-files",
    "--others",
    "--ignored",
    "--exclude-standard",
    "-z",
  ]);
  if (strayOutput.length > 0) {
    throw new Error("Git workspace contains ignored or untracked files");
  }
  const { stdout: sparseOutput } = await git(
    absolute,
    ["config", "--bool", "core.sparseCheckout"],
  ).catch((error) => {
    if (error && typeof error === "object" && error.code === 1) {
      return { stdout: "" };
    }
    throw error;
  });
  if (sparseOutput.trim().toLowerCase() === "true") {
    throw new Error("Git workspace uses sparse checkout");
  }
  const { stdout: indexFlags } = await git(absolute, ["ls-files", "-v", "-t", "-z"]);
  for (const record of indexFlags.split("\0").filter(Boolean)) {
    const marker = record[0];
    if (marker === "S" || marker === marker.toLowerCase()) {
      throw new Error("Git workspace contains skip-worktree or assume-unchanged paths");
    }
  }
  const { stdout: commitOutput } = await git(absolute, ["rev-parse", "HEAD"]);
  const baselineCommit = commitOutput.trim();
  if (!/^[a-f0-9]{40}$/.test(baselineCommit) || baselineCommit === zero40) {
    throw new Error("Git baseline commit is invalid or all-zero");
  }
  if (await pathExists(path.join(absolute, ".gitmodules"))) {
    throw new Error("Git workspace declares submodules");
  }
  const { stdout: treeOutput } = await git(absolute, ["ls-tree", "-r", "HEAD"]);
  const treeEntries = treeOutput.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^(100644|100755|120000|160000) (blob|commit) ([a-f0-9]{40})\t(.+)$/.exec(line);
    if (!match) throw new Error("Git HEAD tree contains an unsupported entry");
    const [, mode, type, blob, name] = match;
    if (mode === "120000") throw new Error("Git workspace contains a symbolic link");
    if (mode === "160000" || type === "commit") throw new Error("Git workspace contains a submodule");
    return { mode, blob, name };
  }).sort((left, right) => left.name.localeCompare(right.name));
  const { stdout: indexOutput } = await git(absolute, ["ls-files", "-s"]);
  const indexEntries = indexOutput.split(/\r?\n/).filter(Boolean).map((line) => {
    const match = /^(\d+) ([a-f0-9]{40}) \d+\t(.+)$/.exec(line);
    if (!match) throw new Error("Git index contains an unsupported entry");
    return { mode: match[1], blob: match[2], name: match[3] };
  }).sort((left, right) => left.name.localeCompare(right.name));
  if (treeEntries.length !== indexEntries.length || treeEntries.some((entry, index) =>
    entry.name !== indexEntries[index].name
    || entry.mode !== indexEntries[index].mode
    || entry.blob !== indexEntries[index].blob,
  )) {
    throw new Error("Git index does not exactly match HEAD");
  }
  const records = [];
  for (const entry of treeEntries) {
    const candidate = path.join(absolute, ...entry.name.split("/"));
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      throw new Error(`Tracked path is not a regular file: ${entry.name}`);
    }
    const resolvedCandidate = await realpath(candidate);
    if (!resolvedCandidate.startsWith(`${resolvedRepositoryRoot}${path.sep}`)) {
      throw new Error(`Tracked path resolves outside the repository: ${entry.name}`);
    }
    const executable = (stats.mode & 0o111) !== 0;
    if ((entry.mode === "100755") !== executable) {
      throw new Error(`Tracked file mode does not match HEAD: ${entry.name}`);
    }
    const [bytes, headBytes] = await Promise.all([
      readFile(candidate),
      gitBytes(absolute, ["show", `${baselineCommit}:${entry.name}`]).then(({ stdout }) => stdout),
    ]);
    if (!bytes.equals(headBytes)) {
      throw new Error(`Tracked file bytes do not match HEAD: ${entry.name}`);
    }
    records.push(`${entry.mode}\0${entry.name}\0${sha256(bytes)}\n`);
  }
  const workspaceDigest = sha256(Buffer.from(records.join("")));
  if (workspaceDigest === zero64) throw new Error("Workspace digest is all-zero");
  const [{ stdout: finalStatus }, { stdout: finalCommitOutput }] = await Promise.all([
    git(absolute, [
      "status",
      "--porcelain=v1",
      "--ignored",
      "--untracked-files=all",
    ]),
    git(absolute, ["rev-parse", "HEAD"]),
  ]);
  if (finalStatus.trim()) {
    throw new Error("Git workspace changed during attestation");
  }
  if (finalCommitOutput.trim() !== baselineCommit) {
    throw new Error("Git HEAD changed during attestation");
  }
  const attestation = {
    schemaVersion: "3.0",
    algorithm: "sha256-git-worktree-v1",
    baselineCommit,
    workspaceDigest,
    clean: true,
    symlinkFree: true,
    submoduleFree: true,
    verifiedAt: now,
  };
  const issues = validateBaselineAttestation(attestation);
  if (issues.length > 0) {
    throw new Error(`Baseline attestation is invalid:\n${issueText(issues)}`);
  }
  return attestation;
}

export const executionContractFiles = [
  "schemas/benchmark.schema.json",
  "schemas/task-packet.schema.json",
  "schemas/launch.schema.json",
  "schemas/cohort.schema.json",
  "schemas/measurement-conditions.schema.json",
  "schemas/cohort-disclosure.schema.json",
  "schemas/cohort-evaluation-aggregate.schema.json",
  "schemas/plan.schema.json",
  "schemas/work-record.schema.json",
  "schemas/submission.schema.json",
  "schemas/artifact.schema.json",
  "schemas/run.schema.json",
  "schemas/run-authorization.schema.json",
  "schemas/validation-report.schema.json",
  "schemas/stage0-task-definition.schema.json",
  "schemas/task-packet-lock.schema.json",
  "schemas/execution-profile.schema.json",
  "schemas/baseline-attestation.schema.json",
  "schemas/engineering-review.schema.json",
  "schemas/protocol-review.schema.json",
  "schemas/launch-release.schema.json",
  "schemas/live-verification.schema.json",
  "schemas/activation-verification.schema.json",
  "schemas/stage-contract-v4.schema.json",
  "schemas/evaluation-record.schema.json",
  "schemas/assessment-evidence.schema.json",
  "schemas/sanitization-report.schema.json",
  "schemas/review-package.schema.json",
  "schemas/review-submission.schema.json",
  "schemas/review-record.schema.json",
  "schemas/cohort-publication-bundle.schema.json",
  "schemas/public-run-metadata.schema.json",
  "schemas/public-validation-summary.schema.json",
  "schemas/public-evaluation-summary.schema.json",
  "schemas/candidate-workspace-isolation-policy.schema.json",
  "schemas/candidate-workspace-receipt.schema.json",
  "evaluation/integrated-robotic-handling-v1/assessment.schema.json",
  "scripts/artifact-contract.mjs",
  "scripts/evaluate-engineering-submission.mjs",
  "scripts/framework-lib.mjs",
  "scripts/frozen-contract.mjs",
  "scripts/stage0-lib.mjs",
  "scripts/stage-contract.mjs",
  "scripts/official-execution-guard.mjs",
  "scripts/candidate-workspace-lib.mjs",
  "scripts/initialize-candidate-workspace.mjs",
  "scripts/candidate-workspace-preflight.mjs",
  "scripts/stage1-authorize-run.mjs",
  "scripts/stage2-open-cohort.mjs",
  "scripts/stage2-integrate.mjs",
  "scripts/stage2-sanitize.mjs",
  "scripts/stage2-review-package.mjs",
  "scripts/stage2-seal-review.mjs",
  "scripts/stage2-finalize-evaluation.mjs",
  "scripts/stage2-publish-cohort.mjs",
  "scripts/stage2-export-publication.mjs",
  "scripts/publication-lib.mjs",
  "scripts/aggregate-engineering-benchmark.mjs",
  "scripts/public-evaluation-summary.mjs",
  "shared/prompts.mjs",
];

const requiredFrozenContractFiles = new Set([
  "schemas/benchmark.schema.json",
  "schemas/task-packet.schema.json",
  "schemas/launch.schema.json",
  "schemas/cohort.schema.json",
  "schemas/measurement-conditions.schema.json",
  "schemas/cohort-disclosure.schema.json",
  "schemas/cohort-evaluation-aggregate.schema.json",
  "schemas/plan.schema.json",
  "schemas/work-record.schema.json",
  "schemas/submission.schema.json",
  "schemas/artifact.schema.json",
  "schemas/run.schema.json",
  "schemas/run-authorization.schema.json",
  "schemas/validation-report.schema.json",
  "schemas/stage0-task-definition.schema.json",
  "schemas/task-packet-lock.schema.json",
  "schemas/execution-profile.schema.json",
  "schemas/baseline-attestation.schema.json",
  "schemas/engineering-review.schema.json",
  "schemas/protocol-review.schema.json",
  "schemas/launch-release.schema.json",
  "schemas/live-verification.schema.json",
  "schemas/stage-contract-v4.schema.json",
  "schemas/evaluation-record.schema.json",
  "schemas/assessment-evidence.schema.json",
  "schemas/sanitization-report.schema.json",
  "schemas/review-package.schema.json",
  "schemas/review-submission.schema.json",
  "schemas/review-record.schema.json",
  "schemas/cohort-publication-bundle.schema.json",
  "schemas/public-run-metadata.schema.json",
  "schemas/public-validation-summary.schema.json",
  "schemas/public-evaluation-summary.schema.json",
  "schemas/candidate-workspace-isolation-policy.schema.json",
  "schemas/candidate-workspace-receipt.schema.json",
  "evaluation/integrated-robotic-handling-v1/assessment.schema.json",
  "scripts/artifact-contract.mjs",
  "scripts/evaluate-engineering-submission.mjs",
  "scripts/framework-lib.mjs",
  "scripts/frozen-contract.mjs",
  "scripts/stage0-lib.mjs",
  "scripts/stage-contract.mjs",
  "scripts/official-execution-guard.mjs",
  "scripts/candidate-workspace-lib.mjs",
  "scripts/initialize-candidate-workspace.mjs",
  "scripts/candidate-workspace-preflight.mjs",
  "scripts/stage1-authorize-run.mjs",
  "scripts/stage2-open-cohort.mjs",
  "scripts/stage2-integrate.mjs",
  "scripts/stage2-sanitize.mjs",
  "scripts/stage2-review-package.mjs",
  "scripts/stage2-seal-review.mjs",
  "scripts/stage2-finalize-evaluation.mjs",
  "scripts/stage2-publish-cohort.mjs",
  "scripts/stage2-export-publication.mjs",
  "scripts/publication-lib.mjs",
  "scripts/aggregate-engineering-benchmark.mjs",
  "scripts/public-evaluation-summary.mjs",
  "shared/prompts.mjs",
]);

// The frozen validator modules import these packages at runtime.  Copy their
// exact installed bytes into the execution contract so a future evaluator does
// not silently pick up a changed dependency from the host application's
// node_modules tree.
async function frozenRuntimePackageRecords(projectRoot) {
  const records = new Map();
  const seen = new Set();
  const dependencyRoot = await pathExists(path.join(projectRoot, "node_modules", "ajv"))
    ? projectRoot
    : process.cwd();
  const rootRequire = createRequire(path.join(dependencyRoot, "package.json"));
  const collect = async (packageName, resolver) => {
    if (seen.has(packageName)) return;
    const manifestPath = resolver.resolve(`${packageName}/package.json`);
    const packageRoot = path.dirname(manifestPath);
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    seen.add(packageName);
    for (const packageFile of await listExactRegularFiles(packageRoot)) {
      // Dotfiles such as .npmignore and test fixtures cannot participate in
      // Node resolution and are intentionally excluded from the safe runtime
      // module tree.
      if (!ensureInside("runtime", packageFile)) continue;
      records.set(
        `node_modules/${packageName}/${packageFile}`,
        await readFile(path.join(packageRoot, ...packageFile.split("/"))),
      );
    }
    const dependencyRequire = createRequire(manifestPath);
    for (const dependency of Object.keys(manifest.dependencies ?? {}).sort()) {
      await collect(dependency, dependencyRequire);
    }
  };
  await collect("ajv", rootRequire);
  await collect("ajv-formats", rootRequire);
  return records;
}

async function executionContractRecords(projectRoot) {
  const records = new Map();
  for (const relativePath of executionContractFiles) {
    records.set(
      relativePath,
      await readFile(path.join(projectRoot, ...relativePath.split("/"))),
    );
  }
  for (const [relativePath, bytes] of await frozenRuntimePackageRecords(projectRoot)) records.set(relativePath, bytes);
  return records;
}

function contractDigestFromRecords(launcherBytes, fileBytes, files) {
  const records = [
    `launcher-message\0${sha256(launcherBytes)}\n`,
    ...files.map((relativePath) =>
      `${relativePath}\0${sha256(fileBytes.get(relativePath))}\n`,
    ),
  ];
  return sha256(Buffer.from(records.join("")));
}

export async function computeExecutionContractDigest(projectRoot) {
  const fileBytes = await executionContractRecords(projectRoot);
  const files = [...fileBytes.keys()].sort();
  return contractDigestFromRecords(
    Buffer.from(MODEL_LAUNCH_MESSAGE),
    fileBytes,
    files,
  );
}

async function writeExecutionContractSnapshot(projectRoot, snapshotRoot, digest) {
  const fileBytes = await executionContractRecords(projectRoot);
  const files = [...fileBytes.keys()].sort();
  const launcherBytes = Buffer.from(MODEL_LAUNCH_MESSAGE);
  if (
    contractDigestFromRecords(
      launcherBytes,
      fileBytes,
      files,
    ) !== digest
  ) {
    throw new Error("Execution contract changed while the launch was freezing");
  }
  for (const [relativePath, bytes] of fileBytes) {
    const destination = ensureInside(snapshotRoot, relativePath);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, bytes, { flag: "wx" });
  }
  await writeFile(path.join(snapshotRoot, "launcher-message.txt"), launcherBytes, { flag: "wx" });
  await writeFile(
    path.join(snapshotRoot, "contract.json"),
    `${JSON.stringify({
      schemaVersion: "1.0",
      digest,
      algorithm: "sha256-execution-contract-v1",
      files,
      launcherMessage: "launcher-message.txt",
    }, null, 2)}\n`,
    { flag: "wx" },
  );
}

export async function validateExecutionContractSnapshot(snapshotRoot, expectedDigest) {
  const issues = [];
  let contract;
  try {
    contract = await readJson(path.join(snapshotRoot, "contract.json"));
    const describedFiles = Array.isArray(contract?.files)
      ? contract.files
      : [];
    const describedSet = new Set(describedFiles);
    const safeDescription = (
      describedFiles.length > 0
      && describedSet.size === describedFiles.length
      && describedFiles.every((relativePath) =>
        typeof relativePath === "string"
        && ensureInside(snapshotRoot, relativePath)
        && relativePath !== "contract.json"
        && relativePath !== contract?.launcherMessage
      )
      && typeof contract?.launcherMessage === "string"
      && ensureInside(snapshotRoot, contract.launcherMessage)
      && contract.launcherMessage !== "contract.json"
      && [...requiredFrozenContractFiles].every((name) => describedSet.has(name))
    );
    if (!safeDescription) {
      addIssue(
        issues,
        "execution-contract-description",
        "Execution contract manifest contains an unsafe or incomplete file description",
      );
    }
    const actualFiles = await listExactRegularFiles(snapshotRoot);
    const expectedFiles = [
      "contract.json",
      contract?.launcherMessage,
      ...describedFiles,
    ].filter((value) => typeof value === "string").sort();
    if (!sameStringSet(actualFiles, expectedFiles)) {
      addIssue(issues, "execution-contract-file-set", "Execution contract snapshot file set is not exact");
    }
    if (
      contract?.schemaVersion !== "1.0"
      || contract?.algorithm !== "sha256-execution-contract-v1"
      || contract?.digest !== expectedDigest
    ) {
      addIssue(issues, "execution-contract-manifest", "Execution contract snapshot metadata does not bind the launch digest");
    }
    const fileBytes = new Map();
    for (const relativePath of describedFiles) {
      fileBytes.set(relativePath, await readRegularFileInside(snapshotRoot, relativePath));
    }
    const launcherBytes = await readRegularFileInside(
      snapshotRoot,
      contract.launcherMessage,
    );
    if (
      contractDigestFromRecords(
        launcherBytes,
        fileBytes,
        describedFiles,
      ) !== expectedDigest
    ) {
      addIssue(issues, "execution-contract-digest", "Execution contract snapshot bytes do not match the launch digest");
    }
  } catch (error) {
    addIssue(
      issues,
      "execution-contract-snapshot-missing",
      error instanceof Error ? error.message : "Execution contract snapshot cannot be read",
    );
  }
  return { status: issues.length === 0 ? "valid" : "invalid", issues, contract };
}

async function buildFrozenLaunchPrompt(snapshotRoot, launch, packet) {
  const rendererPath = ensureInside(snapshotRoot, "shared/prompts.mjs");
  const rendererBytes = await readRegularFileInside(snapshotRoot, "shared/prompts.mjs");
  const renderer = await import(
    `${pathToFileURL(rendererPath).href}?sha256=${sha256(rendererBytes)}`,
  );
  if (typeof renderer.buildLaunchPrompt !== "function") {
    throw new Error("Frozen execution contract does not export buildLaunchPrompt");
  }
  return `${renderer.buildLaunchPrompt(launch, packet)}\n`;
}

export function computeLaunchDigest(launch) {
  const core = { ...launch };
  delete core.launchDigest;
  delete core.promptSha256;
  return manifestDigest(core);
}

export async function freezeLaunch({
  projectRoot,
  launchId,
  packetId,
  version,
  profilePath,
  workspace,
  now = new Date().toISOString(),
}) {
  const frozenPacket = await validateFrozenPacket(
    packetVersionRoot(projectRoot, packetId, version),
  );
  if (frozenPacket.status !== "valid") {
    throw new Error(`Task packet is not frozen and valid:\n${issueText(frozenPacket.issues)}`);
  }
  const profile = await readJson(path.resolve(profilePath));
  const profileIssues = validateExecutionProfile(profile);
  if (profileIssues.length > 0) {
    throw new Error(`Execution profile is invalid:\n${issueText(profileIssues)}`);
  }
  let profileCanonicalBaseUrl;
  try {
    profileCanonicalBaseUrl = canonicalBaseUrl(profile.canonicalBaseUrl);
  } catch (error) {
    throw new Error(`Execution profile is invalid: ${error instanceof Error ? error.message : "canonicalBaseUrl is invalid"}`);
  }
  const attestation = await verifyGitWorkspace(workspace, now);
  const protocolVersion = profile.protocolVersion ?? "3.0";
  if (
    (protocolVersion === "4.0" && frozenPacket.packet.schemaVersion !== "4.0")
    || (protocolVersion === "3.0" && frozenPacket.packet.schemaVersion !== "3.0")
  ) {
    throw new Error("Execution profile protocolVersion must match the frozen task packet schema version");
  }
  const executionContractDigest = await computeExecutionContractDigest(projectRoot);
  const targetRoot = launchRoot(projectRoot, launchId);
  if (await pathExists(targetRoot)) {
    throw new Error(`Destination already exists: ${targetRoot}`);
  }
  const parent = path.dirname(targetRoot);
  await mkdir(parent, { recursive: true });
  const temporary = path.join(
    parent,
    `.${launchId}.tmp-${process.pid}-${randomBytes(6).toString("hex")}`,
  );
  try {
    await mkdir(temporary, { recursive: false });
    const snapshotRoot = path.join(temporary, "execution-contract");
    await mkdir(snapshotRoot, { recursive: false });
    await writeExecutionContractSnapshot(
      projectRoot,
      snapshotRoot,
      executionContractDigest,
    );
    const baselineAttestationDigest = manifestDigest(attestation);
    const launch = {
      schemaVersion: "1.0",
      id: launchId,
      protocolVersion,
      taskPacket: {
        id: packetId,
        version,
        digest: frozenPacket.lock.packetDigest,
        bundleDigest: frozenPacket.lock.bundleDigest,
      },
      baselineCommit: attestation.baselineCommit,
      workspaceDigest: attestation.workspaceDigest,
      canonicalBaseUrl: profileCanonicalBaseUrl,
      executionProfile: {
        id: profile.id,
        version: profile.version,
        digest: manifestDigest(profile),
      },
      baselineAttestationDigest,
      executionContractDigest,
      outputRoot: profile.outputRoot,
      startAction: profile.startAction,
      stopConditions: profile.stopConditions,
      fairnessFingerprint: "",
      launchDigest: "",
      promptSha256: zero64,
      ...(protocolVersion === "4.0" ? {
        v4Contract: frozenPacket.packet.v4Contract,
        workspaceBootstrap: profile.workspaceBootstrap,
      } : {}),
    };
    launch.fairnessFingerprint = computeFairnessFingerprint(launch);
    launch.launchDigest = computeLaunchDigest(launch);
    const packetForPrompt = packetForFrozenPrompt(
      frozenPacket.packet,
      launch,
      (
        await readRegularFileInside(
          frozenPacket.root,
          frozenPacket.packet.instructions.path,
        )
      ).toString("utf8"),
    );
    const prompt = await buildFrozenLaunchPrompt(snapshotRoot, launch, packetForPrompt);
    launch.promptSha256 = sha256(Buffer.from(prompt));
    const launchIssues = validateLaunch(launch);
    if (launchIssues.length > 0) {
      throw new Error(`Generated launch is invalid:\n${issueText(launchIssues)}`);
    }
    const release = {
      schemaVersion: "3.0",
      launchId,
      status: "launch-frozen",
      launchDigest: launch.launchDigest,
      packetDigest: frozenPacket.lock.packetDigest,
      packetBundleDigest: frozenPacket.lock.bundleDigest,
      executionContractDigest,
      canonicalBaseUrl: profileCanonicalBaseUrl,
      promptSha256: launch.promptSha256,
      updatedAt: now,
    };
    const releaseIssues = validateLaunchRelease(release);
    if (releaseIssues.length > 0) {
      throw new Error(`Generated release state is invalid:\n${issueText(releaseIssues)}`);
    }
    await Promise.all([
      writeFile(
        path.join(temporary, "launch.json"),
        `${JSON.stringify(launch, null, 2)}\n`,
        { flag: "wx" },
      ),
      writeFile(
        path.join(temporary, "prompt.txt"),
        prompt,
        { flag: "wx" },
      ),
      writeFile(
        path.join(temporary, "baseline-attestation.json"),
        `${JSON.stringify(attestation, null, 2)}\n`,
        { flag: "wx" },
      ),
      writeFile(
        path.join(temporary, "execution-profile.json"),
        `${JSON.stringify(profile, null, 2)}\n`,
        { flag: "wx" },
      ),
      writeFile(
        path.join(temporary, "release.json"),
        `${JSON.stringify(release, null, 2)}\n`,
        { flag: "wx" },
      ),
    ]);
    await rename(temporary, targetRoot);
    return {
      launch,
      release,
      attestation,
      profile,
      prompt,
      root: targetRoot,
    };
  } catch (error) {
    await rm(temporary, { recursive: true, force: true });
    throw error;
  }
}

const releaseTransitionFile = "release-transition.json";
const releaseTransitionAlgorithm = "sha256-release-transition-v1";
const releaseTransitionPairs = new Set([
  "launch-frozen:approved",
  "approved:release-ready",
  "release-ready:live-verified",
]);
const releaseImmutableKeys = [
  "schemaVersion",
  "launchId",
  "launchDigest",
  "packetDigest",
  "packetBundleDigest",
  "executionContractDigest",
  "canonicalBaseUrl",
  "promptSha256",
];

function releaseBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function exactObjectKeys(value, expected) {
  return (
    value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join(",") === [...expected].sort().join(",")
  );
}

function stateRecord(value) {
  return { digest: manifestDigest(value), value };
}

async function durableCreate(filePath, bytes) {
  const handle = await open(filePath, "wx");
  try {
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function durableOverwriteExisting(filePath, bytes) {
  const handle = await open(filePath, "r+");
  try {
    await handle.truncate(0);
    await handle.writeFile(bytes);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readRegularJsonFile(filePath, label) {
  const stats = await lstat(filePath);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular file`);
  }
  return JSON.parse(await readFile(filePath, "utf8"));
}

function validateReleaseTransitionJournal(journal) {
  if (!exactObjectKeys(journal, [
    "schemaVersion",
    "algorithm",
    "releasePath",
    "prior",
    "next",
    "auxiliary",
  ])) {
    throw new Error("Release transition journal has an invalid file shape");
  }
  if (
    journal.schemaVersion !== "1.0"
    || journal.algorithm !== releaseTransitionAlgorithm
    || journal.releasePath !== "release.json"
    || !exactObjectKeys(journal.prior, ["digest", "value"])
    || !exactObjectKeys(journal.next, ["digest", "value"])
    || journal.prior.digest !== manifestDigest(journal.prior.value)
    || journal.next.digest !== manifestDigest(journal.next.value)
  ) {
    throw new Error("Release transition journal digests or metadata are invalid");
  }
  const priorIssues = validateLaunchRelease(journal.prior.value);
  const nextIssues = validateLaunchRelease(journal.next.value);
  if (priorIssues.length > 0 || nextIssues.length > 0) {
    throw new Error("Release transition journal contains an invalid release state");
  }
  const transition = `${journal.prior.value.status}:${journal.next.value.status}`;
  if (!releaseTransitionPairs.has(transition)) {
    throw new Error(`Release transition is not permitted: ${transition}`);
  }
  const allowedChanges = new Set([
    "status",
    "updatedAt",
    ...(transition === "launch-frozen:approved"
      ? [
        "engineeringReviewDigest",
        "protocolReviewDigest",
        "approvalAttestation",
        "approvalAttestationDigest",
      ]
      : []),
    ...(transition === "release-ready:live-verified"
      ? ["liveVerificationDigest"]
      : []),
  ]);
  for (const key of new Set([
    ...Object.keys(journal.prior.value),
    ...Object.keys(journal.next.value),
  ])) {
    if (
      !allowedChanges.has(key)
      && canonicalJson(journal.prior.value[key]) !== canonicalJson(journal.next.value[key])
    ) {
      throw new Error(`Release transition changes non-transition field ${key}`);
    }
  }
  for (const key of releaseImmutableKeys) {
    if (canonicalJson(journal.prior.value[key]) !== canonicalJson(journal.next.value[key])) {
      throw new Error(`Release transition changes immutable field ${key}`);
    }
  }
  if (transition === "launch-frozen:approved") {
    const approval = journal.next.value.approvalAttestation;
    if (
      approval?.engineeringReviewDigest !== journal.next.value.engineeringReviewDigest
      || approval?.protocolReviewDigest !== journal.next.value.protocolReviewDigest
      || journal.next.value.approvalAttestationDigest !== manifestDigest(approval)
    ) {
      throw new Error("Approved transition does not bind its review digests");
    }
  } else {
    for (const key of [
      "engineeringReviewDigest",
      "protocolReviewDigest",
      "approvalAttestation",
      "approvalAttestationDigest",
    ]) {
      if (canonicalJson(journal.prior.value[key]) !== canonicalJson(journal.next.value[key])) {
        throw new Error(`Release transition changes approval field ${key}`);
      }
    }
  }
  if (transition === "release-ready:live-verified") {
    if (
      !exactObjectKeys(journal.auxiliary, ["path", "digest", "value"])
      || journal.auxiliary.path !== "live-verification.json"
      || journal.auxiliary.digest !== manifestDigest(journal.auxiliary.value)
      || journal.next.value.liveVerificationDigest !== journal.auxiliary.digest
      || validateLiveVerification(journal.auxiliary.value).length > 0
    ) {
      throw new Error("Live transition auxiliary attestation is invalid");
    }
  } else if (journal.auxiliary !== null) {
    throw new Error("Only a live transition may contain an auxiliary file");
  }
}

async function ensureTransitionAuxiliary(root, auxiliary) {
  if (!auxiliary) return;
  const auxiliaryPath = path.join(root, auxiliary.path);
  if (await pathExists(auxiliaryPath)) {
    const existing = await readRegularJsonFile(
      auxiliaryPath,
      "Release transition auxiliary file",
    );
    if (
      manifestDigest(existing) !== auxiliary.digest
      || canonicalJson(existing) !== canonicalJson(auxiliary.value)
    ) {
      throw new Error("Release transition auxiliary file differs from its journal");
    }
    return;
  }
  await durableCreate(auxiliaryPath, releaseBytes(auxiliary.value));
}

export async function recoverReleaseTransition(root) {
  const journalPath = path.join(root, releaseTransitionFile);
  if (!await pathExists(journalPath)) return false;
  const journal = await readRegularJsonFile(
    journalPath,
    "Release transition journal",
  );
  validateReleaseTransitionJournal(journal);
  const releasePath = path.join(root, journal.releasePath);
  let current = null;
  try {
    current = await readRegularJsonFile(releasePath, "release.json");
  } catch (error) {
    if (!(error instanceof SyntaxError) || !await pathExists(releasePath)) {
      throw error;
    }
  }
  const currentDigest = current ? manifestDigest(current) : null;
  if (currentDigest === journal.next.digest) {
    if (canonicalJson(current) !== canonicalJson(journal.next.value)) {
      throw new Error("Current release state does not exactly match the journal");
    }
    await ensureTransitionAuxiliary(root, journal.auxiliary);
  } else if (
    current === null
    || (
      currentDigest === journal.prior.digest
      && canonicalJson(current) === canonicalJson(journal.prior.value)
    )
  ) {
    await ensureTransitionAuxiliary(root, journal.auxiliary);
    await durableOverwriteExisting(releasePath, releaseBytes(journal.next.value));
    const recovered = await readRegularJsonFile(releasePath, "release.json");
    if (
      manifestDigest(recovered) !== journal.next.digest
      || canonicalJson(recovered) !== canonicalJson(journal.next.value)
    ) {
      throw new Error("Recovered release state does not match the journal");
    }
  } else {
    throw new Error("Current release state matches neither journal state");
  }
  await rm(journalPath, { force: true });
  return true;
}

async function transitionReleaseState(root, expectedPrior, next, auxiliary = null) {
  await recoverReleaseTransition(root);
  const releasePath = path.join(root, "release.json");
  const current = await readRegularJsonFile(releasePath, "release.json");
  const expectedDigest = manifestDigest(expectedPrior);
  if (
    manifestDigest(current) !== expectedDigest
    || canonicalJson(current) !== canonicalJson(expectedPrior)
  ) {
    throw new Error("Release transition compare-and-swap failed: prior state changed");
  }
  const journal = {
    schemaVersion: "1.0",
    algorithm: releaseTransitionAlgorithm,
    releasePath: "release.json",
    prior: stateRecord(expectedPrior),
    next: stateRecord(next),
    auxiliary: auxiliary ? {
      path: auxiliary.path,
      digest: manifestDigest(auxiliary.value),
      value: auxiliary.value,
    } : null,
  };
  validateReleaseTransitionJournal(journal);
  const journalPath = path.join(root, releaseTransitionFile);
  await durableCreate(journalPath, releaseBytes(journal));
  const compared = await readRegularJsonFile(releasePath, "release.json");
  if (
    manifestDigest(compared) === journal.next.digest
    && canonicalJson(compared) === canonicalJson(next)
  ) {
    await ensureTransitionAuxiliary(root, journal.auxiliary);
    await rm(journalPath, { force: true });
    return;
  }
  if (
    manifestDigest(compared) !== expectedDigest
    || canonicalJson(compared) !== canonicalJson(expectedPrior)
  ) {
    throw new Error("Release transition compare-and-swap failed after journal creation");
  }
  await ensureTransitionAuxiliary(root, journal.auxiliary);
  await durableOverwriteExisting(releasePath, releaseBytes(next));
  const written = await readRegularJsonFile(releasePath, "release.json");
  if (
    manifestDigest(written) !== journal.next.digest
    || canonicalJson(written) !== canonicalJson(next)
  ) {
    throw new Error("Release transition write verification failed");
  }
  await rm(journalPath, { force: true });
}

export async function validateLaunchFreeze(projectRoot, launchId, { recover = true } = {}) {
  const root = launchRoot(projectRoot, launchId);
  const issues = [];
  if (recover) {
    try {
      await recoverReleaseTransition(root);
    } catch (error) {
      return {
        status: "invalid",
        issues: [{
          code: "release-transition-invalid",
          message: error instanceof Error
            ? error.message
            : "Release transition journal cannot be recovered",
        }],
        root,
      };
    }
  } else if (await pathExists(path.join(root, releaseTransitionFile))) {
    return {
      status: "invalid",
      issues: [{
        code: "release-transition-pending",
        message: "Release transition recovery is pending; a read-only audit will not modify release state",
      }],
      root,
    };
  }
  let launch;
  let release;
  let prompt;
  let attestation;
  let profile;
  try {
    [launch, release, prompt, attestation, profile] = await Promise.all([
      readJson(path.join(root, "launch.json")),
      readJson(path.join(root, "release.json")),
      readFile(path.join(root, "prompt.txt"), "utf8"),
      readJson(path.join(root, "baseline-attestation.json")),
      readJson(path.join(root, "execution-profile.json")),
    ]);
  } catch {
    return {
      status: "invalid",
      issues: [{ code: "missing-launch-freeze", message: "Frozen launch files are missing or invalid" }],
    };
  }
  issues.push(...validateLaunch(launch));
  issues.push(...validateLaunchRelease(release));
  issues.push(...validateBaselineAttestation(attestation));
  issues.push(...validateExecutionProfile(profile));
  if (launch.id !== launchId || release.launchId !== launchId) {
    addIssue(issues, "launch-identity-mismatch", "Launch directory and manifests differ");
  }
  if (computeLaunchDigest(launch) !== launch.launchDigest) {
    addIssue(issues, "launch-digest-mismatch", "Launch digest does not match launch core");
  }
  if (sha256(Buffer.from(prompt)) !== launch.promptSha256) {
    addIssue(issues, "prompt-hash-mismatch", "prompt.txt hash does not match launch");
  }
  if (manifestDigest(attestation) !== launch.baselineAttestationDigest) {
    addIssue(issues, "baseline-attestation-mismatch", "Baseline attestation digest differs");
  }
  if (manifestDigest(profile) !== launch.executionProfile?.digest) {
    addIssue(issues, "execution-profile-mismatch", "Execution profile digest differs");
  }
  if (
    launch.executionProfile?.id !== profile.id
    || launch.executionProfile?.version !== profile.version
    || launch.canonicalBaseUrl !== profile.canonicalBaseUrl
    || launch.outputRoot !== profile.outputRoot
    || launch.startAction !== profile.startAction
    || canonicalJson(launch.stopConditions) !== canonicalJson(profile.stopConditions)
  ) {
    addIssue(issues, "execution-profile-binding", "Launch profile identity, canonical base URL, or execution controls differ from the frozen profile");
  }
  try {
    canonicalBaseUrl(launch.canonicalBaseUrl);
  } catch (error) {
    addIssue(issues, "canonical-base-url-invalid", error instanceof Error ? error.message : "Launch canonical base URL is invalid");
  }
  if (
    launch.baselineCommit !== attestation.baselineCommit
    || launch.workspaceDigest !== attestation.workspaceDigest
  ) {
    addIssue(issues, "baseline-attestation-binding", "Launch baseline commit or workspace digest differs from its attestation");
  }
  let frozenPacket = { status: "invalid", issues: [], packet: null, lock: null, root: null };
  if (
    typeof launch.taskPacket?.id === "string"
    && typeof launch.taskPacket?.version === "string"
  ) {
    frozenPacket = await validateFrozenPacket(packetVersionRoot(
      projectRoot,
      launch.taskPacket.id,
      launch.taskPacket.version,
    ));
    issues.push(...frozenPacket.issues);
  } else {
    addIssue(issues, "launch-packet-binding", "Launch does not declare a usable task packet identity");
  }
  if (frozenPacket.packet && frozenPacket.lock && (
    launch.taskPacket?.id !== frozenPacket.packet.id
    || launch.taskPacket?.version !== frozenPacket.packet.version
    || launch.taskPacket?.digest !== frozenPacket.lock.packetDigest
    || launch.taskPacket?.bundleDigest !== frozenPacket.lock.bundleDigest
    || frozenPacket.lock.taskPacket?.id !== launch.taskPacket?.id
    || frozenPacket.lock.taskPacket?.version !== launch.taskPacket?.version
  )) {
    addIssue(issues, "launch-packet-binding", "Launch task packet does not exactly bind the current frozen packet and lock");
  }
  if (frozenPacket.packet) {
    try {
      const packetForPrompt = packetForFrozenPrompt(
        frozenPacket.packet,
        launch,
        (
          await readRegularFileInside(frozenPacket.root, frozenPacket.packet.instructions.path)
        ).toString("utf8"),
      );
      const expectedPrompt = await buildFrozenLaunchPrompt(
        path.join(root, "execution-contract"),
        launch,
        packetForPrompt,
      );
      if (prompt !== expectedPrompt) {
        addIssue(issues, "prompt-reconstruction-mismatch", "prompt.txt does not exactly reconstruct from the frozen packet and launch");
      }
    } catch (error) {
      addIssue(issues, "prompt-reconstruction-failed", error instanceof Error ? error.message : "Prompt cannot be reconstructed");
    }
  }
  if (
    release.launchDigest !== launch.launchDigest
    || release.packetDigest !== launch.taskPacket?.digest
    || release.packetBundleDigest !== launch.taskPacket?.bundleDigest
    || release.executionContractDigest !== launch.executionContractDigest
    || release.canonicalBaseUrl !== launch.canonicalBaseUrl
    || release.promptSha256 !== launch.promptSha256
  ) {
    addIssue(issues, "release-binding-mismatch", "release.json does not bind the frozen launch");
  }
  if (release.status !== "launch-frozen") {
    const approval = release.approvalAttestation;
    if (
      !approval
      || approval.expectedLaunchDigest !== launch.launchDigest
      || approval.engineeringReviewDigest !== release.engineeringReviewDigest
      || approval.protocolReviewDigest !== release.protocolReviewDigest
      || approval.statement !== `APPROVE RELEASE ${launch.launchDigest}`
      || release.approvalAttestationDigest !== manifestDigest(approval)
    ) {
      addIssue(
        issues,
        "release-approval-binding",
        "release.json approval does not bind the exact launch digest and phrase",
      );
    }
  }
  const contractSnapshot = await validateExecutionContractSnapshot(
    path.join(root, "execution-contract"),
    launch.executionContractDigest,
  );
  issues.push(...contractSnapshot.issues);
  try {
    const launchFiles = await listExactRegularFiles(root);
    const contractFiles = Array.isArray(contractSnapshot.contract?.files)
      ? contractSnapshot.contract.files
      : [];
    const allowedFiles = new Set([
      "launch.json",
      "prompt.txt",
      "baseline-attestation.json",
      "execution-profile.json",
      "release.json",
      "protocol-review.json",
      "live-verification.json",
      "execution-contract/contract.json",
      `execution-contract/${contractSnapshot.contract?.launcherMessage ?? "launcher-message.txt"}`,
      ...contractFiles.map((relativePath) => `execution-contract/${relativePath}`),
    ]);
    for (const relativePath of launchFiles) {
      if (!allowedFiles.has(relativePath)) {
        addIssue(
          issues,
          "launch-file-not-allowed",
          `Frozen launch contains a file outside the exact allowlist: ${relativePath}`,
          relativePath,
        );
      }
    }
  } catch (error) {
    addIssue(
      issues,
      "launch-file-set",
      error instanceof Error ? error.message : "Frozen launch file set cannot be enumerated",
    );
  }
  return {
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    launch,
    release,
    prompt,
    attestation,
    profile,
    contractSnapshot,
    root,
  };
}

export async function validateReviews(projectRoot, launchId, options = {}) {
  const frozen = await validateLaunchFreeze(projectRoot, launchId, options);
  const issues = [...frozen.issues];
  if (!frozen.launch) return { ...frozen, issues, status: "invalid" };
  const packetRoot = packetVersionRoot(
    projectRoot,
    frozen.launch.taskPacket.id,
    frozen.launch.taskPacket.version,
  );
  let task;
  let engineeringReview;
  let protocolReview;
  try {
    [task, engineeringReview, protocolReview] = await Promise.all([
      readJson(path.join(packetRoot, "task.json")),
      readJson(path.join(packetRoot, "engineering-review.json")),
      readJson(path.join(frozen.root, "protocol-review.json")),
    ]);
  } catch {
    addIssue(issues, "missing-review", "Engineering or protocol review is missing");
    return { ...frozen, issues, status: "invalid" };
  }
  issues.push(...validateEngineeringReview(engineeringReview));
  issues.push(...validateProtocolReview(protocolReview));
  if (
    engineeringReview.reviewer?.id === task.author?.id
    || protocolReview.reviewer?.id === task.author?.id
  ) {
    addIssue(issues, "author-self-review", "Task author cannot approve either review");
  }
  if (
    engineeringReview.authorId !== task.author?.id
    || protocolReview.authorId !== task.author?.id
  ) {
    addIssue(issues, "review-author-binding", "Both reviews must identify the task author");
  }
  if (engineeringReview.reviewer?.id === protocolReview.reviewer?.id) {
    addIssue(issues, "reviewer-separation", "Engineering and protocol reviewers must be different people");
  }
  if (
    engineeringReview.status !== "approved"
    || engineeringReview.blockingIssues?.length !== 0
    || protocolReview.status !== "approved"
    || protocolReview.blockingIssues?.length !== 0
  ) {
    addIssue(issues, "review-not-approved", "Both reviews must be approved with no blocking issues");
  }
  if (
    engineeringReview.packetDigest !== frozen.launch.taskPacket.digest
    || engineeringReview.bundleDigest !== frozen.launch.taskPacket.bundleDigest
  ) {
    addIssue(issues, "engineering-review-binding", "Engineering review does not bind the packet");
  }
  if (
    protocolReview.launchDigest !== frozen.launch.launchDigest
    || protocolReview.executionContractDigest !== frozen.launch.executionContractDigest
    || protocolReview.promptSha256 !== frozen.launch.promptSha256
  ) {
    addIssue(issues, "protocol-review-binding", "Protocol review does not bind the launch");
  }
  if (
    frozen.release.status !== "launch-frozen"
    && (
      frozen.release.engineeringReviewDigest !== manifestDigest(engineeringReview)
      || frozen.release.protocolReviewDigest !== manifestDigest(protocolReview)
    )
  ) {
    addIssue(issues, "release-review-binding", "Release review digests differ from the review files");
  }
  if (frozen.release.status !== "launch-frozen") {
    const approval = frozen.release.approvalAttestation;
    if (
      !approval
      || approval.expectedLaunchDigest !== frozen.launch.launchDigest
      || approval.engineeringReviewDigest !== manifestDigest(engineeringReview)
      || approval.protocolReviewDigest !== manifestDigest(protocolReview)
      || approval.engineeringReviewDigest !== frozen.release.engineeringReviewDigest
      || approval.protocolReviewDigest !== frozen.release.protocolReviewDigest
      || approval.statement !== `APPROVE RELEASE ${frozen.launch.launchDigest}`
      || frozen.release.approvalAttestationDigest !== manifestDigest(approval)
    ) {
      addIssue(
        issues,
        "release-approval-binding",
        "Release approval attestation does not bind the exact launch digest and phrase",
      );
    }
  }
  return {
    ...frozen,
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    task,
    engineeringReview,
    protocolReview,
  };
}

function requireExplicitApproval(launchDigest, expectedLaunchDigest, approvalStatement) {
  if (expectedLaunchDigest !== launchDigest) {
    throw new Error("Expected launch digest does not match the frozen launch");
  }
  const expectedStatement = `APPROVE RELEASE ${launchDigest}`;
  if (approvalStatement !== expectedStatement) {
    throw new Error(`Explicit approval must be exactly: ${expectedStatement}`);
  }
}

export async function approveLaunch(
  projectRoot,
  launchId,
  expectedLaunchDigest,
  approvalStatement,
  now = new Date().toISOString(),
) {
  const reviewed = await validateReviews(projectRoot, launchId);
  if (reviewed.status !== "valid") {
    throw new Error(`Reviews are invalid:\n${issueText(reviewed.issues)}`);
  }
  if (reviewed.release.status !== "launch-frozen") {
    throw new Error("Launch is not in launch-frozen state");
  }
  requireExplicitApproval(
    reviewed.launch.launchDigest,
    expectedLaunchDigest,
    approvalStatement,
  );
  const engineeringReviewDigest = manifestDigest(reviewed.engineeringReview);
  const protocolReviewDigest = manifestDigest(reviewed.protocolReview);
  const approvalAttestation = {
    expectedLaunchDigest,
    engineeringReviewDigest,
    protocolReviewDigest,
    statement: approvalStatement,
    attestedAt: now,
  };
  const next = {
    ...reviewed.release,
    status: "approved",
    engineeringReviewDigest,
    protocolReviewDigest,
    approvalAttestation,
    approvalAttestationDigest: manifestDigest(approvalAttestation),
    updatedAt: now,
  };
  const issues = validateLaunchRelease(next);
  if (issues.length > 0) throw new Error(`Approved release is invalid:\n${issueText(issues)}`);
  await transitionReleaseState(reviewed.root, reviewed.release, next);
  return next;
}

export async function markReleaseReady(
  projectRoot,
  launchId,
  expectedLaunchDigest,
  approvalStatement,
  now = new Date().toISOString(),
) {
  const reviewed = await validateReviews(projectRoot, launchId);
  if (reviewed.status !== "valid") {
    throw new Error(`Launch preview validation failed:\n${issueText(reviewed.issues)}`);
  }
  if (reviewed.release.status !== "approved") {
    throw new Error("Launch must be approved before release-ready");
  }
  requireExplicitApproval(
    reviewed.launch.launchDigest,
    expectedLaunchDigest,
    approvalStatement,
  );
  if (
    reviewed.release.approvalAttestation?.expectedLaunchDigest !== expectedLaunchDigest
    || reviewed.release.approvalAttestation?.engineeringReviewDigest
      !== reviewed.release.engineeringReviewDigest
    || reviewed.release.approvalAttestation?.protocolReviewDigest
      !== reviewed.release.protocolReviewDigest
    || reviewed.release.approvalAttestation?.statement !== approvalStatement
    || reviewed.release.approvalAttestationDigest
      !== manifestDigest(reviewed.release.approvalAttestation)
  ) {
    throw new Error("Release approval attestation differs from the explicit approval");
  }
  const next = { ...reviewed.release, status: "release-ready", updatedAt: now };
  await transitionReleaseState(reviewed.root, reviewed.release, next);
  return next;
}

export function validateCanonicalLiveUrls({
  launchId,
  canonicalBaseUrl: expectedCanonicalBaseUrl,
  launchUrl,
  launchJsonUrl,
  promptUrl,
}) {
  const parse = (label, value) => {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${label} is not a valid URL`);
    }
    if (
      parsed.protocol !== "https:"
      || parsed.username
      || parsed.password
      || parsed.search
      || parsed.hash
    ) {
      throw new Error(`${label} must be a canonical HTTPS URL without credentials, query, or fragment`);
    }
    if (parsed.href !== value) {
      throw new Error(`${label} must use its canonical URL spelling`);
    }
    return parsed;
  };
  const page = parse("launch URL", launchUrl);
  const launchJson = parse("launch.json URL", launchJsonUrl);
  const prompt = parse("prompt.txt URL", promptUrl);
  if (page.origin !== launchJson.origin || page.origin !== prompt.origin) {
    throw new Error("Live verification endpoints must use the same HTTPS origin");
  }
  const pageSuffix = `/launch/${launchId}/`;
  if (!page.pathname.endsWith(pageSuffix)) {
    throw new Error(`Launch URL path must end with ${pageSuffix}`);
  }
  const basePath = page.pathname.slice(0, -pageSuffix.length);
  if (
    basePath
    && !/^\/[A-Za-z0-9._~-]+(?:\/[A-Za-z0-9._~-]+)*$/.test(basePath)
  ) {
    throw new Error("Launch URL contains a non-canonical base path");
  }
  if (
    launchJson.pathname
      !== `${basePath}/framework/launches/${launchId}/launch.json`
    || prompt.pathname
      !== `${basePath}/framework/launches/${launchId}/prompt.txt`
  ) {
    throw new Error("Live verification endpoints do not share the canonical base path");
  }
  const resolvedCanonicalBaseUrl = `${page.origin}${basePath}`;
  if (
    expectedCanonicalBaseUrl !== undefined
    && canonicalBaseUrl(expectedCanonicalBaseUrl) !== resolvedCanonicalBaseUrl
  ) {
    throw new Error("Live verification endpoints do not match the launch canonicalBaseUrl");
  }
  return {
    canonicalBaseUrl: resolvedCanonicalBaseUrl,
    canonicalOrigin: page.origin,
    basePath,
    launchUrl: page.href,
    launchJsonUrl: launchJson.href,
    promptUrl: prompt.href,
  };
}

async function fetchCanonicalBytes(fetchImpl, label, url) {
  const response = await fetchImpl(url, { redirect: "manual" });
  if (response.status >= 300 && response.status < 400) {
    throw new Error(`${label} redirected; canonical endpoints must be redirect-free`);
  }
  if (response.redirected) {
    throw new Error(`${label} redirected; canonical endpoints must be redirect-free`);
  }
  if (response.status !== 200) {
    throw new Error(`${label} returned HTTP ${response.status}, expected 200`);
  }
  if (response.url && response.url !== url) {
    throw new Error(`${label} response URL differs from the canonical request URL`);
  }
  return Buffer.from(await response.arrayBuffer());
}

export async function validateLiveVerificationBindings(root, launch, verification) {
  const issues = [];
  try {
    const urls = validateCanonicalLiveUrls({
      launchId: launch.id,
      canonicalBaseUrl: launch.canonicalBaseUrl,
      launchUrl: verification.launchUrl,
      launchJsonUrl: verification.launchJsonUrl,
      promptUrl: verification.promptUrl,
    });
    if (
      verification.canonicalBaseUrl !== urls.canonicalBaseUrl
      || verification.canonicalBaseUrl !== launch.canonicalBaseUrl
      ||
      verification.canonicalOrigin !== urls.canonicalOrigin
      || verification.basePath !== urls.basePath
    ) {
      addIssue(issues, "live-url-binding", "Live verification origin or base path differs");
    }
  } catch (error) {
    addIssue(
      issues,
      "live-url-invalid",
      error instanceof Error ? error.message : "Live verification URLs are invalid",
    );
  }
  try {
    const [launchBytes, promptBytes] = await Promise.all([
      readFile(path.join(root, "launch.json")),
      readFile(path.join(root, "prompt.txt")),
    ]);
    if (verification.launchJsonSha256 !== sha256(launchBytes)) {
      addIssue(issues, "live-launch-json-binding", "Live launch.json hash differs from frozen bytes");
    }
    if (
      verification.promptSha256 !== sha256(promptBytes)
      || verification.promptSha256 !== launch.promptSha256
    ) {
      addIssue(issues, "live-prompt-binding", "Live prompt hash differs from frozen prompt bytes");
    }
  } catch {
    addIssue(issues, "live-local-files", "Frozen launch.json or prompt.txt cannot be read");
  }
  if (
    verification.launchId !== launch.id
    || verification.launchDigest !== launch.launchDigest
  ) {
    addIssue(issues, "live-launch-binding", "Live verification does not bind the frozen launch");
  }
  return issues;
}

const htmlNamespace = "http://www.w3.org/1999/xhtml";
const markerInertHtmlElements = new Set([
  "iframe", "noembed", "noframes", "noscript", "plaintext", "script", "style",
  "template", "textarea", "title", "xmp",
]);
const launchPageMarkerNames = [
  "data-stage1-launch-id",
  "data-launch-digest",
  "data-prompt-sha256",
];
const finalHandoffMarker = "data-stage1-handoff";
const finalHandoffValue = "executable";
const activationVerificationMarker = "data-activation-verification-digest";

function activeHtmlContext(node, parentContext) {
  if (!node.tagName) return parentContext;
  const foreign = parentContext.foreign || node.namespaceURI !== htmlNamespace;
  return {
    foreign,
    inert: parentContext.inert || foreign || markerInertHtmlElements.has(node.tagName),
  };
}

function activeHtmlText(node, parentContext = { foreign: false, inert: false }) {
  if (node.nodeName === "#text") return parentContext.inert ? "" : node.value;
  const context = activeHtmlContext(node, parentContext);
  if (context.inert) return "";
  if (node.tagName === "br") return "\n";
  return (node.childNodes ?? []).map((child) => activeHtmlText(child, context)).join("");
}

async function inspectStrictLaunchPage(
  pageText,
  {
    launchId,
    launchDigest,
    promptSha256,
    expectedPromptBytes = null,
    activationVerificationDigest = null,
    requireFinalHandoff = false,
  },
) {
  // Keep parse5 loaded only for operations that inspect a deployed launch page. Frozen
  // execution-contract scripts import this module for non-live checks and must stay
  // independently runnable from their snapshot.
  const { parse } = await import("parse5");
  const document = parse(pageText, { scriptingEnabled: true });
  const markerOccurrences = new Map(launchPageMarkerNames.map((name) => [name, []]));
  const markerSections = [];
  const finalHandoffs = [];
  const activationVerificationDigests = [];
  const visit = (node, parentContext = { foreign: false, inert: false }) => {
    const context = activeHtmlContext(node, parentContext);
    if (node.tagName && !context.inert) {
      const attributes = new Map((node.attrs ?? []).map(({ name, value }) => [name, value]));
      for (const name of launchPageMarkerNames) {
        if (attributes.has(name)) {
          markerOccurrences.get(name).push({ value: attributes.get(name), node });
        }
      }
      if (attributes.has(finalHandoffMarker)) {
        finalHandoffs.push({ value: attributes.get(finalHandoffMarker), node });
      }
      if (attributes.has(activationVerificationMarker)) {
        activationVerificationDigests.push({ value: attributes.get(activationVerificationMarker), node });
      }
      if (node.tagName === "section") {
        const byName = new Map();
        for (const name of launchPageMarkerNames) {
          if (attributes.has(name)) byName.set(name, [attributes.get(name)]);
        }
        markerSections.push({ node, byName });
      }
    }
    if (context.inert) return;
    for (const child of node.childNodes ?? []) visit(child, context);
  };
  visit(document);

  const expected = new Map([
    ["data-stage1-launch-id", launchId],
    ["data-launch-digest", launchDigest],
    ["data-prompt-sha256", promptSha256],
  ]);
  for (const [name, expectedValue] of expected) {
    const occurrences = markerOccurrences.get(name) ?? [];
    if (occurrences.length !== 1) {
      throw new Error(`Launch page must contain exactly one ${name} marker`);
    }
    if (occurrences[0].value !== expectedValue) {
      throw new Error(`Launch page ${name} marker does not exactly match the frozen launch`);
    }
  }
  const matchingSections = markerSections.filter(({ byName }) => (
    [...expected].every(([name, value]) => {
      const values = byName.get(name) ?? [];
      return values.length === 1 && values[0] === value;
    })
  ));
  if (matchingSections.length !== 1) {
    throw new Error("Launch page markers must occur together exactly once on an active section start tag");
  }
  if (requireFinalHandoff) {
    if (finalHandoffs.length !== 1) {
      throw new Error(`Launch page must contain exactly one ${finalHandoffMarker} marker`);
    }
    const handoff = finalHandoffs[0];
    if (
      handoff.value !== finalHandoffValue
      || handoff.node.tagName !== "pre"
      || !Buffer.from(activeHtmlText(handoff.node), "utf8").equals(expectedPromptBytes)
    ) {
      throw new Error("Launch page final handoff marker or rendered prompt does not exactly match prompt.txt");
    }
    if (
      activationVerificationDigests.length !== 1
      || activationVerificationDigests[0].value !== activationVerificationDigest
      || activationVerificationDigests[0].node !== matchingSections[0].node
    ) {
      throw new Error("Launch page activation verification marker does not bind the create-only record");
    }
  }
  return { launchId, launchDigest, promptSha256 };
}

async function collectCanonicalLiveArtifacts({
  root,
  launch,
  launchId,
  launchUrl,
  launchJsonUrl,
  promptUrl,
  fetchImpl,
  requireFinalHandoff = false,
  activationVerificationDigest = null,
}) {
  const urls = validateCanonicalLiveUrls({
    launchId,
    canonicalBaseUrl: launch.canonicalBaseUrl,
    launchUrl,
    launchJsonUrl,
    promptUrl,
  });
  const [pageBytes, remoteLaunchBytes, remotePromptBytes, localLaunchBytes, localPromptBytes] =
    await Promise.all([
      fetchCanonicalBytes(fetchImpl, "launch page", urls.launchUrl),
      fetchCanonicalBytes(fetchImpl, "launch.json", urls.launchJsonUrl),
      fetchCanonicalBytes(fetchImpl, "prompt.txt", urls.promptUrl),
      readFile(path.join(root, "launch.json")),
      readFile(path.join(root, "prompt.txt")),
    ]);
  if (!remoteLaunchBytes.equals(localLaunchBytes)) {
    throw new Error("Remote launch.json bytes differ from the frozen launch.json");
  }
  if (!remotePromptBytes.equals(localPromptBytes)) {
    throw new Error("Remote prompt.txt bytes differ from the frozen prompt.txt");
  }
  if (sha256(remotePromptBytes) !== launch.promptSha256) {
    throw new Error("Remote prompt.txt hash differs from the frozen launch binding");
  }
  const pageText = pageBytes.toString("utf8");
  if (!Buffer.from(pageText, "utf8").equals(pageBytes)) {
    throw new Error("Launch page is not valid UTF-8 HTML");
  }
  const markerProjection = await inspectStrictLaunchPage(pageText, {
    launchId,
    launchDigest: launch.launchDigest,
    promptSha256: launch.promptSha256,
    ...(requireFinalHandoff ? {
      requireFinalHandoff: true,
      expectedPromptBytes: localPromptBytes,
      activationVerificationDigest,
    } : {}),
  });
  return { urls, pageBytes, localLaunchBytes, localPromptBytes, markerProjection };
}

async function collectLiveVerification({
  root,
  launch,
  launchId,
  launchUrl,
  launchJsonUrl,
  promptUrl,
  now,
  fetchImpl,
}) {
  const { urls, pageBytes, localLaunchBytes } = await collectCanonicalLiveArtifacts({
    root,
    launch,
    launchId,
    launchUrl,
    launchJsonUrl,
    promptUrl,
    fetchImpl,
  });
  const verification = {
    schemaVersion: "3.0",
    launchId,
    launchDigest: launch.launchDigest,
    promptSha256: launch.promptSha256,
    launchJsonSha256: sha256(localLaunchBytes),
    pageSha256: sha256(pageBytes),
    canonicalBaseUrl: urls.canonicalBaseUrl,
    canonicalOrigin: urls.canonicalOrigin,
    basePath: urls.basePath,
    launchUrl: urls.launchUrl,
    launchJsonUrl: urls.launchJsonUrl,
    promptUrl: urls.promptUrl,
    checks: {
      redirectFree: true,
      sameOrigin: true,
      basePathMatched: true,
      launchJsonExact: true,
      promptExact: true,
      pageMarkerMatched: true,
    },
    status: "verified",
    verifiedAt: now,
  };
  const verificationIssues = [
    ...validateLiveVerification(verification),
    ...await validateLiveVerificationBindings(root, launch, verification),
  ];
  if (verificationIssues.length > 0) {
    throw new Error(`Live verification is invalid:\n${issueText(verificationIssues)}`);
  }
  return verification;
}

async function requireCurrentLiveVerification(frozen) {
  const verificationPath = path.join(frozen.root, "live-verification.json");
  let verification;
  try {
    verification = await readRegularJsonFile(
      verificationPath,
      "live-verification.json",
    );
  } catch (error) {
    throw new Error(
      `Existing live verification cannot be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const issues = [
    ...validateLiveVerification(verification),
    ...await validateLiveVerificationBindings(frozen.root, frozen.launch, verification),
  ];
  if (manifestDigest(verification) !== frozen.release.liveVerificationDigest) {
    addIssue(
      issues,
      "live-verification-digest-mismatch",
      "live verification digest differs from release.json",
    );
  }
  if (issues.length > 0) {
    throw new Error(`Existing live verification is invalid:\n${issueText(issues)}`);
  }
  return verification;
}

export async function validateActivationVerificationBindings(root, launch, release, verification) {
  const issues = [];
  try {
    const urls = validateCanonicalLiveUrls({
      launchId: launch.id,
      canonicalBaseUrl: launch.canonicalBaseUrl,
      launchUrl: verification.launchUrl,
      launchJsonUrl: verification.launchJsonUrl,
      promptUrl: verification.promptUrl,
    });
    if (
      verification.canonicalBaseUrl !== urls.canonicalBaseUrl
      || verification.canonicalOrigin !== urls.canonicalOrigin
      || verification.basePath !== urls.basePath
    ) {
      addIssue(issues, "activation-url-binding", "Activation verification origin or base path differs");
    }
  } catch (error) {
    addIssue(
      issues,
      "activation-url-invalid",
      error instanceof Error ? error.message : "Activation verification URLs are invalid",
    );
  }
  let localLaunchSha256 = null;
  try {
    localLaunchSha256 = sha256(await readFile(path.join(root, "launch.json")));
  } catch {
    // The local-file validation below reports this with the normal issue code.
  }
  const markerProjection = {
    schemaVersion: "1.0",
    algorithm: "sha256-canonical-launch-markers-v1",
    launchId: launch.id,
    launchDigest: launch.launchDigest,
    promptSha256: launch.promptSha256,
    launchJsonSha256: localLaunchSha256,
  };
  if (
    canonicalJson(verification.markerProjection) !== canonicalJson(markerProjection)
    || verification.markerProjectionDigest !== manifestDigest(markerProjection)
  ) {
    addIssue(
      issues,
      "activation-marker-binding",
      "Activation verification does not bind the canonical launch marker projection",
    );
  }
  if (verification.liveVerificationDigest !== release.liveVerificationDigest) {
    addIssue(
      issues,
      "activation-live-verification-binding",
      "Activation verification does not bind the current v3 live-verification digest",
    );
  }
  try {
    const [launchBytes, promptBytes] = await Promise.all([
      readFile(path.join(root, "launch.json")),
      readFile(path.join(root, "prompt.txt")),
    ]);
    if (verification.launchJsonSha256 !== sha256(launchBytes)) {
      addIssue(issues, "activation-launch-json-binding", "Activation launch.json hash differs from frozen bytes");
    }
    if (
      verification.promptSha256 !== sha256(promptBytes)
      || verification.promptSha256 !== launch.promptSha256
    ) {
      addIssue(issues, "activation-prompt-binding", "Activation prompt hash differs from frozen prompt bytes");
    }
  } catch {
    addIssue(issues, "activation-local-files", "Frozen launch.json or prompt.txt cannot be read");
  }
  if (
    verification.launchId !== launch.id
    || verification.launchDigest !== launch.launchDigest
  ) {
    addIssue(issues, "activation-launch-binding", "Activation verification does not bind the frozen launch");
  }
  return issues;
}

function activationVerificationPath(projectRoot, launchId) {
  return path.join(activationRoot(projectRoot, launchId), "verification.json");
}

async function readActivationVerification(projectRoot, launchId) {
  return readRegularJsonFile(
    activationVerificationPath(projectRoot, launchId),
    "activation verification",
  );
}

async function resolveActivationVerificationIssues(root, launch, release, verification) {
  return [
    ...validateActivationVerification(verification),
    ...await validateActivationVerificationBindings(root, launch, release, verification),
  ];
}

export async function activateLive({
  projectRoot,
  launchId,
  launchUrl,
  launchJsonUrl,
  promptUrl,
  now = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
}) {
  const frozen = await validateReviews(projectRoot, launchId);
  if (frozen.status !== "valid") {
    throw new Error(`Launch is not valid for activation:\n${issueText(frozen.issues)}`);
  }
  if (frozen.release.status !== "live-verified") {
    throw new Error("Launch is not already live-verified");
  }
  await requireCurrentLiveVerification(frozen);
  const { urls, pageBytes, localLaunchBytes, markerProjection: observedMarkers } = await collectCanonicalLiveArtifacts({
    root: frozen.root,
    launch: frozen.launch,
    launchId,
    launchUrl,
    launchJsonUrl,
    promptUrl,
    fetchImpl,
  });
  const markerProjection = {
    schemaVersion: "1.0",
    algorithm: "sha256-canonical-launch-markers-v1",
    ...observedMarkers,
    launchJsonSha256: sha256(localLaunchBytes),
  };
  const verification = {
    schemaVersion: "1.0",
    algorithm: "sha256-canonical-launch-markers-v1",
    launchId,
    launchDigest: frozen.launch.launchDigest,
    promptSha256: frozen.launch.promptSha256,
    launchJsonSha256: sha256(localLaunchBytes),
    liveVerificationDigest: frozen.release.liveVerificationDigest,
    markerProjection,
    markerProjectionDigest: manifestDigest(markerProjection),
    // This is a forensic observation. Audits validate the stable markers, not this value.
    observedPageSha256: sha256(pageBytes),
    canonicalBaseUrl: urls.canonicalBaseUrl,
    canonicalOrigin: urls.canonicalOrigin,
    basePath: urls.basePath,
    launchUrl: urls.launchUrl,
    launchJsonUrl: urls.launchJsonUrl,
    promptUrl: urls.promptUrl,
    checks: {
      redirectFree: true,
      sameOrigin: true,
      basePathMatched: true,
      launchJsonExact: true,
      promptExact: true,
      pageMarkerMatched: true,
    },
    status: "activated",
    activatedAt: now,
  };
  const issues = await resolveActivationVerificationIssues(
    frozen.root,
    frozen.launch,
    frozen.release,
    verification,
  );
  if (issues.length > 0) {
    throw new Error(`Activation verification is invalid:\n${issueText(issues)}`);
  }
  const destination = activationVerificationPath(projectRoot, launchId);
  await mkdir(path.dirname(destination), { recursive: true });
  try {
    await durableCreate(destination, releaseBytes(verification));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "EEXIST") {
      throw new Error("Activation verification already exists and is create-only");
    }
    throw error;
  }
  return verification;
}

export async function auditLive({
  projectRoot,
  launchId,
  launchUrl,
  launchJsonUrl,
  promptUrl,
  now = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
}) {
  const frozen = await validateReviews(projectRoot, launchId, { recover: false });
  if (frozen.status !== "valid") {
    throw new Error(`Launch is not valid for read-only activation audit:\n${issueText(frozen.issues)}`);
  }
  if (frozen.release.status !== "live-verified") {
    throw new Error("Launch is not already live-verified");
  }
  await requireCurrentLiveVerification(frozen);
  let verification;
  try {
    verification = await readActivationVerification(projectRoot, launchId);
  } catch (error) {
    throw new Error(
      `Activation verification cannot be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const issues = await resolveActivationVerificationIssues(
    frozen.root,
    frozen.launch,
    frozen.release,
    verification,
  );
  if (issues.length > 0) {
    throw new Error(`Activation verification is invalid:\n${issueText(issues)}`);
  }
  const canonicalUrls = validateCanonicalLiveUrls({
    launchId,
    canonicalBaseUrl: frozen.launch.canonicalBaseUrl,
    launchUrl,
    launchJsonUrl,
    promptUrl,
  });
  const activationUrl = publicUrl(
    canonicalUrls.canonicalBaseUrl,
    `framework/activations/${launchId}/verification.json`,
  );
  let localActivationBytes;
  try {
    localActivationBytes = await readFile(activationVerificationPath(projectRoot, launchId));
  } catch (error) {
    throw new Error(
      `Activation verification bytes cannot be read: ${error instanceof Error ? error.message : "unknown error"}`,
    );
  }
  const remoteActivationBytes = await fetchCanonicalBytes(
    fetchImpl,
    "activation verification",
    activationUrl,
  );
  if (!remoteActivationBytes.equals(localActivationBytes)) {
    throw new Error("Remote activation verification bytes differ from the create-only record");
  }
  const { urls, pageBytes } = await collectCanonicalLiveArtifacts({
    root: frozen.root,
    launch: frozen.launch,
    launchId,
    launchUrl,
    launchJsonUrl,
    promptUrl,
    fetchImpl,
    requireFinalHandoff: true,
    activationVerificationDigest: manifestDigest(verification),
  });
  if (
    verification.launchUrl !== urls.launchUrl
    || verification.launchJsonUrl !== urls.launchJsonUrl
    || verification.promptUrl !== urls.promptUrl
  ) {
    throw new Error("Activation audit URLs differ from the create-only activation verification");
  }
  return {
    activation: verification,
    activationUrl,
    observedPageSha256: sha256(pageBytes),
    auditedAt: now,
  };
}

export async function markLiveVerified({
  projectRoot,
  launchId,
  launchUrl,
  launchJsonUrl,
  promptUrl,
  now = new Date().toISOString(),
  fetchImpl = globalThis.fetch,
}) {
  const frozen = await validateReviews(projectRoot, launchId);
  if (frozen.status !== "valid" || frozen.release.status !== "release-ready") {
    throw new Error(`Launch is not release-ready:\n${issueText(frozen.issues)}`);
  }
  const verification = await collectLiveVerification({
    root: frozen.root,
    launch: frozen.launch,
    launchId,
    launchUrl,
    launchJsonUrl,
    promptUrl,
    now,
    fetchImpl,
  });
  const verificationPath = path.join(frozen.root, "live-verification.json");
  if (await pathExists(verificationPath)) {
    throw new Error("live-verification.json already exists");
  }
  const next = {
    ...frozen.release,
    status: "live-verified",
    liveVerificationDigest: manifestDigest(verification),
    updatedAt: now,
  };
  await transitionReleaseState(
    frozen.root,
    frozen.release,
    next,
    { path: "live-verification.json", value: verification },
  );
  return next;
}

export function publicReleaseStatus(status) {
  return status === "release-ready" || status === "live-verified";
}
