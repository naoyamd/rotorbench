import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, realpath, writeFile } from "node:fs/promises";
import path from "node:path";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function isSafeRelativePath(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
}

function ensureInside(root, relativePath) {
  if (!isSafeRelativePath(relativePath)) return null;
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  return candidate.startsWith(`${absoluteRoot}${path.sep}`) ? candidate : null;
}

// The frozen evaluator performs full schema validation. This local guard only
// prevents an invalid or incomplete initial-plan file from being checkpointed.
function validatePlan(plan) {
  const required = [
    "schemaVersion", "status", "requirements", "assumptions", "steps",
    "alternativesToEvaluate", "verificationPlan",
  ];
  const errors = [];
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) return ["plan.json must be an object"];
  for (const field of required) if (!(field in plan)) errors.push(`plan.json is missing ${field}`);
  if (plan.schemaVersion !== "1.0") errors.push("plan.json schemaVersion must be 1.0");
  if (plan.status !== "initial") errors.push("plan.json status must be initial");
  for (const field of ["requirements", "assumptions", "steps", "alternativesToEvaluate", "verificationPlan"]) {
    if (!Array.isArray(plan[field])) errors.push(`plan.json ${field} must be an array`);
  }
  if (!Array.isArray(plan.requirements) || plan.requirements.length === 0) errors.push("plan.json requires at least one requirement");
  if (!Array.isArray(plan.steps) || plan.steps.length === 0) errors.push("plan.json requires at least one step");
  if (!Array.isArray(plan.verificationPlan) || plan.verificationPlan.length === 0) errors.push("plan.json requires at least one verification item");
  return errors;
}

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function allArguments(name) {
  const values = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === name && process.argv[index + 1]) values.push(process.argv[index + 1]);
  }
  return values;
}

function safeCandidatePath(relativePath, label, { allowReceipts = false } = {}) {
  if (
    !isSafeRelativePath(relativePath)
    || (!allowReceipts && relativePath.startsWith("receipts/"))
  ) {
    throw new Error(`${label} must be a safe candidate artefact path outside receipts/: ${relativePath}`);
  }
  return relativePath;
}

async function regularCandidateFile(root, relativePath, label, options) {
  const safePath = safeCandidatePath(relativePath, label, options);
  const target = ensureInside(root, safePath);
  if (!target) throw new Error(`Unsafe ${label} path: ${relativePath}`);
  let stats;
  try {
    stats = await lstat(target);
  } catch {
    throw new Error(`${label} is missing: ${relativePath}`);
  }
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`${label} must be a regular, non-link file: ${relativePath}`);
  }
  const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`${label} escapes candidate-output: ${relativePath}`);
  }
  const bytes = await readFile(target);
  return { path: safePath, bytes, sha256: sha256(bytes) };
}

async function readEvidence(root, relativePath) {
  const file = await regularCandidateFile(root, relativePath, "Evidence");
  return { path: file.path, sha256: file.sha256 };
}

function parseContract(bytes) {
  let contract;
  try {
    contract = JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new Error("Output contract is not valid JSON");
  }
  if (
    typeof contract?.version !== "string"
    || !Array.isArray(contract?.candidateCheckpoints)
    || !Array.isArray(contract?.artefacts)
  ) {
    throw new Error("Output contract requires version, candidateCheckpoints, and artefacts");
  }
  return contract;
}

async function loadOutputContract() {
  const contractPath = argument("--contract", { required: true });
  const expectedSha256 = argument("--contract-sha256", { required: true }).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("--contract-sha256 must be a lowercase SHA-256 digest");
  }
  const bytes = await readFile(path.resolve(contractPath));
  const digest = sha256(bytes);
  if (digest !== expectedSha256) throw new Error("Output-contract SHA-256 mismatch");
  return { contract: parseContract(bytes), sha256: digest };
}

function checkpointDefinition(contract, checkpointId) {
  const checkpoint = contract.candidateCheckpoints.find(({ id }) => id === checkpointId);
  if (!checkpoint || !Array.isArray(checkpoint.requiredArtefacts)) {
    throw new Error(`Output contract does not declare requiredArtefacts for ${checkpointId}`);
  }
  return checkpoint;
}

function checkpointArtefactPaths(contract, checkpointId) {
  const checkpoint = checkpointDefinition(contract, checkpointId);
  const known = new Set((contract.artefacts ?? []).map(({ path: artefactPath }) => artefactPath));
  const paths = [...new Set(checkpoint.requiredArtefacts)].sort();
  for (const artefactPath of paths) {
    safeCandidatePath(artefactPath, "Output-contract artefact");
    if (!known.has(artefactPath)) {
      throw new Error(`Output contract ${checkpointId} names unknown artefact ${artefactPath}`);
    }
  }
  return paths;
}

function priorCheckpointIds(contract, checkpointId) {
  const checkpoint = checkpointDefinition(contract, checkpointId);
  if (!Array.isArray(checkpoint.requiresPriorCheckpointIds)) {
    throw new Error(`Output contract does not declare requiresPriorCheckpointIds for ${checkpointId}`);
  }
  for (const priorId of checkpoint.requiresPriorCheckpointIds) {
    if (priorId !== "CKPT-000" && !contract.candidateCheckpoints.some(({ id }) => id === priorId)) {
      throw new Error(`Output contract ${checkpointId} names unknown prerequisite ${priorId}`);
    }
  }
  return [...new Set(checkpoint.requiresPriorCheckpointIds)].sort();
}

function parseCsvRecords(bytes) {
  const source = bytes.toString("utf8").replace(/^\uFEFF/, "");
  const rows = [];
  let fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        value += character;
      }
      continue;
    }
    if (character === '"') quoted = true;
    else if (character === ",") {
      fields.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      fields.push(value.trim());
      rows.push(fields);
      fields = [];
      value = "";
    } else value += character;
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (value.length || fields.length) {
    fields.push(value.trim());
    rows.push(fields);
  }
  const [header = [], ...data] = rows;
  return data
    .filter((row) => row.some((cell) => cell.length))
    .map((row) => Object.fromEntries(header.map((field, index) => [field, row[index] ?? ""])));
}

async function indexedReferencePaths(root, contract, artefactPaths) {
  const requested = new Set(artefactPaths);
  const indexed = [];
  for (const artefact of contract.artefacts ?? []) {
    const config = artefact.indexedFileReferences;
    if (!requested.has(artefact.path) || !config) continue;
    const indexFile = await regularCandidateFile(root, artefact.path, "Indexed artefact");
    if (config.kind === "csv-row-paths") {
      for (const record of parseCsvRecords(indexFile.bytes)) {
        for (const [field, rule] of Object.entries(config)) {
          if (!rule || typeof rule !== "object" || !Object.hasOwn(rule, "required")) continue;
          const value = String(record[field] ?? "").trim();
          if (!value) {
            if (rule.required) throw new Error(`Indexed artefact ${artefact.path} requires ${field}`);
            continue;
          }
          safeCandidatePath(value, "Indexed artefact reference");
          if (typeof config.pathRoot === "string" && !value.startsWith(`${config.pathRoot}/`)) {
            throw new Error(`Indexed artefact reference is outside ${config.pathRoot}: ${value}`);
          }
          indexed.push(value);
        }
      }
      continue;
    }
    if (config.kind === "json-records") {
      let manifest;
      try {
        manifest = JSON.parse(indexFile.bytes.toString("utf8"));
      } catch {
        throw new Error(`Indexed artefact ${artefact.path} is not valid JSON`);
      }
      const records = manifest?.[config.recordsField];
      if (!Array.isArray(records) || records.length === 0) {
        throw new Error(`Indexed artefact ${artefact.path} requires a non-empty ${config.recordsField}`);
      }
      for (const [index, record] of records.entries()) {
        const value = String(record?.[config.pathField] ?? "").trim();
        const mediaType = String(record?.[config.mediaTypeField] ?? "").trim();
        const declaredSha256 = String(record?.[config.sha256Field] ?? "").trim().toLowerCase();
        safeCandidatePath(value, `Indexed artefact ${artefact.path} record ${index + 1}`);
        if (typeof config.pathRoot === "string" && !value.startsWith(`${config.pathRoot}/`)) {
          throw new Error(`Indexed artefact reference is outside ${config.pathRoot}: ${value}`);
        }
        if (!config.allowedMediaTypes?.includes(mediaType)) {
          throw new Error(`Indexed artefact ${artefact.path} has unsupported media type ${mediaType}`);
        }
        if (!/^[a-f0-9]{64}$/.test(declaredSha256)) {
          throw new Error(`Indexed artefact ${artefact.path} has invalid SHA-256 for ${value}`);
        }
        const referenced = await regularCandidateFile(root, value, "Indexed artefact reference");
        if (referenced.sha256 !== declaredSha256) {
          throw new Error(`Indexed artefact reference does not match manifest SHA-256: ${value}`);
        }
        indexed.push(value);
      }
      continue;
    }
    throw new Error(`Indexed artefact ${artefact.path} has unsupported reference kind ${config.kind}`);
  }
  return [...new Set(indexed)].sort();
}

async function changeResponsePaths(root, contract, checkpointId) {
  if (checkpointId !== "CKPT-050") return [];
  const policy = contract.conditionalChangeResponse;
  if (
    !policy
    || policy.triggerCheckpoint !== checkpointId
    || typeof policy.changeEventId !== "string"
    || typeof policy.impactArtifact !== "string"
  ) {
    throw new Error("CKPT-050 requires conditionalChangeResponse with changeEventId and impactArtifact");
  }
  const impactFile = await regularCandidateFile(root, policy.impactArtifact, "Change-impact artefact");
  let impact;
  try {
    impact = JSON.parse(impactFile.bytes.toString("utf8"));
  } catch {
    throw new Error(`${policy.impactArtifact} is not valid JSON`);
  }
  if (
    impact.changeEventId !== policy.changeEventId
    || !Array.isArray(impact.affectedOutputRefs)
    || !Array.isArray(impact.revisedArtifactPaths)
  ) {
    throw new Error(`${policy.impactArtifact} requires the exact changeEventId, affectedOutputRefs, and revisedArtifactPaths`);
  }
  const revisedPaths = [...new Set(impact.revisedArtifactPaths)];
  for (const revisedPath of revisedPaths) safeCandidatePath(revisedPath, "Revised artefact");
  const revised = new Set(revisedPaths);
  for (const outputRef of policy.affectedOutputRefs ?? []) {
    if (!impact.affectedOutputRefs.includes(outputRef)) continue;
    const required = (contract.artefacts ?? [])
      .filter((artefact) => artefact.requiredOutputRef === outputRef)
      .map((artefact) => artefact.path);
    required.push(...await indexedReferencePaths(root, contract, required));
    for (const requiredPath of new Set(required)) {
      if (!revised.has(requiredPath)) {
        throw new Error(`${outputRef} is affected but ${requiredPath} is absent from revisedArtifactPaths`);
      }
    }
  }
  const revisedIndexedPaths = await indexedReferencePaths(root, contract, revisedPaths);
  for (const indexedPath of revisedIndexedPaths) {
    if (!revised.has(indexedPath)) {
      throw new Error(`Indexed reissue ${indexedPath} is absent from revisedArtifactPaths`);
    }
  }
  return [...new Set([...revisedPaths, ...revisedIndexedPaths])].sort();
}

async function pathDoesNotExist(absolutePath, label) {
  try {
    await lstat(absolutePath);
  } catch {
    return;
  }
  throw new Error(`${label} already exists and checkpoint snapshots are create-only`);
}

async function createSnapshot(root, snapshotRoot, sourcePath, source) {
  const snapshotPath = path.posix.join(snapshotRoot, source.path);
  const target = ensureInside(root, snapshotPath);
  if (!target) throw new Error(`Unsafe snapshot path: ${snapshotPath}`);
  await mkdir(path.dirname(target), { recursive: true });
  const [resolvedRoot, resolvedParent] = await Promise.all([realpath(root), realpath(path.dirname(target))]);
  if (!resolvedParent.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Snapshot parent escapes candidate-output: ${snapshotPath}`);
  }
  await pathDoesNotExist(target, `Snapshot ${snapshotPath}`);
  await writeFile(target, source.bytes, { flag: "wx" });
  const saved = await regularCandidateFile(
    root,
    snapshotPath,
    "Checkpoint snapshot",
    { allowReceipts: true },
  );
  if (saved.sha256 !== source.sha256) {
    throw new Error(`Snapshot bytes changed while writing ${snapshotPath}`);
  }
  return { sourcePath: source.path, snapshotPath, sha256: source.sha256 };
}

const rootValue = argument("--root");
const root = rootValue ? path.resolve(rootValue) : path.resolve("candidate-output");
const checkpointId = argument("--checkpoint");
const planPath = path.join(root, "plan.json");
const planData = await readFile(planPath);
const plan = JSON.parse(planData.toString("utf8"));
const issues = validatePlan(plan);
if (issues.length > 0) {
  for (const issue of issues) console.error(typeof issue === "string" ? issue : issue.message);
  process.exitCode = 1;
} else if (!checkpointId) {
  // Version 2/3 compatibility: the original one-time initial-plan checkpoint remains
  // byte-for-byte stable and cannot be overwritten.
  const digest = sha256(planData);
  await writeFile(path.join(root, "initial-plan.sha256"), `${digest}  plan.json\n`, { flag: "wx" });
  console.log(digest);
} else {
  if (!/^CKPT-[0-9]{3,}$/.test(checkpointId)) {
    throw new Error("checkpoint ID must use CKPT-000 style");
  }
  const changeEventId = argument("--change-event");
  if (changeEventId && !/^CHG-[0-9]{3,}$/.test(changeEventId)) {
    throw new Error("change event ID must use CHG-000 style");
  }
  if (checkpointId === "CKPT-050" && !changeEventId) {
    throw new Error("CKPT-050 requires --change-event <CHG-000>");
  }
  if (checkpointId !== "CKPT-050" && changeEventId) {
    throw new Error("--change-event is permitted only for CKPT-050");
  }

  const receiptsRoot = path.join(root, "receipts");
  await mkdir(receiptsRoot, { recursive: true });
  const entries = (await readdir(receiptsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{3,}-CKPT-[0-9]{3,}\.json$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sequence = entries.length;
  const previousReceiptSha256 = entries.length === 0
    ? "0".repeat(64)
    : sha256(await readFile(path.join(receiptsRoot, entries.at(-1).name)));
  const receiptName = `${String(sequence).padStart(3, "0")}-${checkpointId}.json`;
  const receiptPath = path.join(receiptsRoot, receiptName);
  await pathDoesNotExist(receiptPath, `Receipt receipts/${receiptName}`);

  const recordedCheckpointIds = entries.map((entry) => entry.name.match(/^\d{3}-(CKPT-[0-9]{3,})\.json$/)?.[1]);
  if (checkpointId === "CKPT-000" && entries.length > 0) {
    throw new Error("CKPT-000 must be the first checkpoint receipt");
  }

  const evidencePaths = [...new Set([
    "plan.json",
    ...(checkpointId === "CKPT-000" ? ["initial-plan.sha256"] : []),
    ...allArguments("--evidence"),
  ])];
  const evidence = [];
  for (const relativePath of evidencePaths) evidence.push(await readEvidence(root, relativePath));

  let outputContract;
  let artifactSnapshots = [];
  if (checkpointId !== "CKPT-000") {
    outputContract = await loadOutputContract();
    if (
      checkpointId === "CKPT-050"
      && changeEventId !== outputContract.contract.conditionalChangeResponse?.changeEventId
    ) {
      throw new Error(
        `CKPT-050 requires exact change event ${outputContract.contract.conditionalChangeResponse?.changeEventId ?? "<missing-contract-change-event>"}`,
      );
    }
    if (recordedCheckpointIds.includes(checkpointId)) {
      throw new Error(`${checkpointId} already has a checkpoint receipt`);
    }
    const requiredPriorIds = priorCheckpointIds(outputContract.contract, checkpointId);
    for (const priorId of requiredPriorIds) {
      if (!recordedCheckpointIds.includes(priorId)) {
        throw new Error(`${checkpointId} requires prior receipt ${priorId}`);
      }
    }
    const currentIndex = outputContract.contract.candidateCheckpoints.findIndex(({ id }) => id === checkpointId);
    for (const recordedId of recordedCheckpointIds) {
      const recordedIndex = outputContract.contract.candidateCheckpoints.findIndex(({ id }) => id === recordedId);
      if (recordedIndex > currentIndex) {
        throw new Error(`${checkpointId} cannot be sealed after later checkpoint ${recordedId}`);
      }
    }
    const requiredArtefactPaths = checkpointArtefactPaths(outputContract.contract, checkpointId);
    const requiredIndexedPaths = await indexedReferencePaths(
      root,
      outputContract.contract,
      requiredArtefactPaths,
    );
    const responsePaths = await changeResponsePaths(root, outputContract.contract, checkpointId);
    const pathsToSnapshot = [
      ...new Set([...requiredArtefactPaths, ...requiredIndexedPaths, ...responsePaths]),
    ].sort();
    const snapshotRoot = path.posix.join(
      "receipts",
      "snapshots",
      `${String(sequence).padStart(3, "0")}-${checkpointId}`,
    );
    const snapshotDirectory = ensureInside(root, snapshotRoot);
    if (!snapshotDirectory) throw new Error(`Unsafe snapshot directory: ${snapshotRoot}`);
    await pathDoesNotExist(snapshotDirectory, `Snapshot directory ${snapshotRoot}`);
    const sources = new Map();
    for (const sourcePath of pathsToSnapshot) {
      sources.set(
        sourcePath,
        await regularCandidateFile(root, sourcePath, "Checkpoint artefact"),
      );
    }
    for (const sourcePath of pathsToSnapshot) {
      artifactSnapshots.push(await createSnapshot(
        root,
        snapshotRoot,
        sourcePath,
        sources.get(sourcePath),
      ));
    }
    outputContract = {
      componentVersion: outputContract.contract.version,
      sha256: outputContract.sha256,
      requiredArtefactPaths,
    };
  }

  const receipt = {
    schemaVersion: "1.1",
    id: `RCP-${String(sequence).padStart(3, "0")}`,
    sequence,
    checkpointId,
    previousReceiptSha256,
    createdAt: argument("--at") || new Date().toISOString(),
    ...(changeEventId ? { changeEventId } : {}),
    evidence,
    artifactSnapshots,
    ...(outputContract ? { outputContract } : {}),
  };
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    id: receipt.id,
    sequence,
    checkpointId,
    path: `receipts/${receiptName}`,
    sha256: sha256(await readFile(receiptPath)),
    previousReceiptSha256,
    ...(changeEventId ? { changeEventId } : {}),
  }));
}
