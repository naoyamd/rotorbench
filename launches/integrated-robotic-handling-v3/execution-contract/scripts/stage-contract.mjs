import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import {
  ensureInside,
  isSafeRelativePath,
  bundleTreeHash,
  readJson,
  sha256,
  validateCheckpointReceiptRecord,
  validatePlan,
  validateSubmission,
  validateWorkRecord,
} from "./framework-lib.mjs";
import { loadFrozenContractValidators } from "./frozen-contract.mjs";

async function regularFileInside(root, relativePath) {
  const candidate = ensureInside(root, relativePath);
  if (!candidate) return { issue: `unsafe path: ${relativePath}` };
  try {
    const stats = await lstat(candidate);
    if (!stats.isFile() || stats.isSymbolicLink()) {
      return { issue: `not a regular file: ${relativePath}` };
    }
    const [resolvedRoot, resolvedFile] = await Promise.all([realpath(root), realpath(candidate)]);
    if (!resolvedFile.startsWith(`${resolvedRoot}${path.sep}`)) {
      return { issue: `path escapes candidate-output: ${relativePath}` };
    }
    const data = await readFile(candidate);
    return { data, sha256: sha256(data) };
  } catch {
    return { issue: `missing file: ${relativePath}` };
  }
}

function duplicateIds(items) {
  const seen = new Set();
  return items
    .filter((item) => {
      if (seen.has(item.id)) return true;
      seen.add(item.id);
      return false;
    })
    .map((item) => item.id);
}

function v4Issue(issues, message) {
  issues.push(`v4: ${message}`);
}

/**
 * Load the declared output-contract bytes from a frozen task packet.  The
 * caller receives the parsed component and the digest of the exact bytes that
 * were read, so admission, integration, and review can share one authority.
 */
export async function loadAuthoritativeOutputContract(packetRoot, packet) {
  const declaration = (packet?.inputs ?? []).find(({ id }) => id === "output-contract");
  if (!declaration || !isSafeRelativePath(declaration.path)) {
    throw new Error("Frozen packet has no safe output-contract declaration");
  }
  if (!/^[a-f0-9]{64}$/.test(declaration.sha256 ?? "")) {
    throw new Error("Frozen packet output-contract declaration has no SHA-256 commitment");
  }
  const file = await regularFileInside(packetRoot, declaration.path);
  if (file.issue) throw new Error(`Frozen output contract is unavailable: ${file.issue}`);
  if (file.sha256 !== declaration.sha256) {
    throw new Error("Frozen output-contract bytes do not match the packet SHA-256 commitment");
  }
  let outputContract;
  try {
    outputContract = JSON.parse(file.data.toString("utf8"));
  } catch {
    throw new Error("Frozen output contract is not valid JSON");
  }
  if (
    !outputContract
    || typeof outputContract.version !== "string"
    || !Array.isArray(outputContract.artefacts)
    || !Array.isArray(outputContract.candidateCheckpoints)
  ) {
    throw new Error("Frozen output contract lacks version, artefacts, or candidateCheckpoints");
  }
  return {
    declaration,
    outputContract,
    outputContractSha256: file.sha256,
  };
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameSortedStrings(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function snapshotPathFor(receipt, sourcePath) {
  return [
    "receipts",
    "snapshots",
    `${String(receipt.sequence).padStart(3, "0")}-${receipt.checkpointId}`,
    sourcePath,
  ].join("/");
}

function isV110ReceiptSnapshotSubmission(submission, options) {
  if (typeof options.requireReceiptSnapshots === "boolean") {
    return options.requireReceiptSnapshots;
  }
  return (
    submission?.taskPacket?.id === "integrated-robotic-handling"
    && submission?.taskPacket?.version === "1.10"
  );
}

function candidateCheckpointArtefacts(contract, checkpointId) {
  const checkpoint = contract?.candidateCheckpoints?.find(({ id }) => id === checkpointId);
  if (!checkpoint || !Array.isArray(checkpoint.requiredArtefacts)) return null;
  const knownPaths = new Set((contract.artefacts ?? []).map(({ path: artefactPath }) => artefactPath));
  const paths = sortedUnique(checkpoint.requiredArtefacts);
  if (paths.some((artefactPath) => !knownPaths.has(artefactPath))) return null;
  return paths;
}

function candidateCheckpointPrerequisites(contract, checkpointId) {
  if (checkpointId === "CKPT-000") return [];
  const checkpoint = contract?.candidateCheckpoints?.find(({ id }) => id === checkpointId);
  if (!checkpoint || !Array.isArray(checkpoint.requiresPriorCheckpointIds)) return null;
  const knownIds = new Set(["CKPT-000", ...(contract.candidateCheckpoints ?? []).map(({ id }) => id)]);
  const prerequisites = sortedUnique(checkpoint.requiresPriorCheckpointIds);
  return prerequisites.every((checkpointIdValue) => knownIds.has(checkpointIdValue))
    ? prerequisites
    : null;
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
  if (quoted) throw new Error("unterminated CSV quote");
  if (value.length || fields.length) {
    fields.push(value.trim());
    rows.push(fields);
  }
  const [header = [], ...data] = rows;
  return data
    .filter((row) => row.some((cell) => cell.length))
    .map((row) => Object.fromEntries(header.map((field, index) => [field, row[index] ?? ""])));
}

async function receiptSnapshotBytes(root, snapshot) {
  const file = await regularFileInside(root, snapshot?.snapshotPath);
  if (file.issue) return { issue: file.issue };
  if (file.sha256 !== snapshot.sha256) {
    return { issue: `snapshot hash does not match ${snapshot.snapshotPath}` };
  }
  return { bytes: file.data };
}

async function indexedReferencePathsFromSnapshots(
  root,
  contract,
  snapshots,
  artefactPaths,
) {
  const requested = new Set(artefactPaths);
  const paths = [];
  const issues = [];
  for (const artefact of contract.artefacts ?? []) {
    const config = artefact.indexedFileReferences;
    if (!requested.has(artefact.path) || !config) continue;
    const binding = snapshots.get(artefact.path);
    if (!binding) {
      issues.push(`missing snapshot for indexed artefact ${artefact.path}`);
      continue;
    }
    const file = await receiptSnapshotBytes(root, binding);
    if (file.issue) {
      issues.push(`${artefact.path}: ${file.issue}`);
      continue;
    }
    if (config.kind === "csv-row-paths") {
      let records;
      try {
        records = parseCsvRecords(file.bytes);
      } catch (error) {
        issues.push(`${artefact.path} cannot be parsed: ${error instanceof Error ? error.message : "invalid CSV"}`);
        continue;
      }
      for (const record of records) {
        for (const [field, rule] of Object.entries(config)) {
          if (!rule || typeof rule !== "object" || !Object.hasOwn(rule, "required")) continue;
          const value = String(record[field] ?? "").trim();
          if (!value) {
            if (rule.required) issues.push(`${artefact.path} requires indexed ${field}`);
            continue;
          }
          if (!isSafeRelativePath(value) || !value.startsWith(`${config.pathRoot}/`)) {
            issues.push(`${artefact.path} contains unsafe indexed path ${value}`);
            continue;
          }
          paths.push(value);
          if (!snapshots.has(value)) issues.push(`${artefact.path} referenced file is not snapshotted: ${value}`);
        }
      }
      continue;
    }
    if (config.kind === "json-records") {
      let manifest;
      try {
        manifest = JSON.parse(file.bytes.toString("utf8"));
      } catch {
        issues.push(`${artefact.path} is not valid JSON`);
        continue;
      }
      const records = manifest?.[config.recordsField];
      if (!Array.isArray(records) || records.length === 0) {
        issues.push(`${artefact.path} requires a non-empty ${config.recordsField}`);
        continue;
      }
      for (const [index, record] of records.entries()) {
        const value = String(record?.[config.pathField] ?? "").trim();
        const mediaType = String(record?.[config.mediaTypeField] ?? "").trim();
        const declaredSha256 = String(record?.[config.sha256Field] ?? "").trim().toLowerCase();
        if (!isSafeRelativePath(value) || !value.startsWith(`${config.pathRoot}/`)) {
          issues.push(`${artefact.path} record ${index + 1} contains unsafe indexed path ${value}`);
          continue;
        }
        if (!config.allowedMediaTypes?.includes(mediaType)) {
          issues.push(`${artefact.path} record ${index + 1} has unsupported media type ${mediaType}`);
        }
        if (!/^[a-f0-9]{64}$/.test(declaredSha256)) {
          issues.push(`${artefact.path} record ${index + 1} has invalid SHA-256`);
        }
        paths.push(value);
        const referenced = snapshots.get(value);
        if (!referenced) {
          issues.push(`${artefact.path} referenced file is not snapshotted: ${value}`);
        } else if (referenced.sha256 !== declaredSha256) {
          issues.push(`${artefact.path} manifest SHA-256 does not match snapshot ${value}`);
        }
      }
      continue;
    }
    issues.push(`${artefact.path} has unsupported indexed reference kind ${config.kind}`);
  }
  return { paths: sortedUnique(paths), issues };
}

async function validateReceiptSnapshots({ root, receipt, record, contract, contractSha256, issues }) {
  const requiredArtefacts = receipt.checkpointId === "CKPT-000"
    ? []
    : candidateCheckpointArtefacts(contract, receipt.checkpointId);
  if (requiredArtefacts === null) {
    v4Issue(issues, `output contract does not declare a valid requiredArtefacts set for ${receipt.checkpointId}`);
    return;
  }
  if (record.schemaVersion !== "1.1") {
    v4Issue(issues, `receipt ${receipt.id} must use snapshot receipt schema 1.1`);
  }
  if (!Array.isArray(record.artifactSnapshots)) {
    v4Issue(issues, `receipt ${receipt.id} has no artifactSnapshots`);
    return;
  }
  const sourcePaths = [];
  const snapshotPaths = new Set();
  const snapshots = new Map();
  for (const snapshot of record.artifactSnapshots) {
    if (
      !isSafeRelativePath(snapshot?.sourcePath)
      || snapshot.sourcePath.startsWith("receipts/")
      || !isSafeRelativePath(snapshot?.snapshotPath)
      || !/^[a-f0-9]{64}$/.test(snapshot?.sha256 ?? "")
    ) {
      v4Issue(issues, `receipt ${receipt.id} contains an invalid artifact snapshot declaration`);
      continue;
    }
    sourcePaths.push(snapshot.sourcePath);
    if (snapshots.has(snapshot.sourcePath)) {
      v4Issue(issues, `receipt ${receipt.id} snapshots ${snapshot.sourcePath} more than once`);
    }
    if (snapshotPaths.has(snapshot.snapshotPath)) {
      v4Issue(issues, `receipt ${receipt.id} reuses snapshot path ${snapshot.snapshotPath}`);
    }
    snapshotPaths.add(snapshot.snapshotPath);
    snapshots.set(snapshot.sourcePath, snapshot);
    if (snapshot.snapshotPath !== snapshotPathFor(receipt, snapshot.sourcePath)) {
      v4Issue(issues, `receipt ${receipt.id} uses a non-deterministic snapshot path for ${snapshot.sourcePath}`);
    }
    const saved = await receiptSnapshotBytes(root, snapshot);
    if (saved.issue) v4Issue(issues, `receipt ${receipt.id} ${saved.issue}`);
  }

  if (receipt.checkpointId === "CKPT-000") {
    if (sourcePaths.length > 0) v4Issue(issues, "CKPT-000 may not contain engineering artefact snapshots");
    if (record.outputContract) v4Issue(issues, "CKPT-000 must not bind an output contract");
    return;
  }

  const binding = record.outputContract;
  if (!binding || binding.sha256 !== contractSha256 || binding.componentVersion !== contract.version) {
    v4Issue(issues, `receipt ${receipt.id} does not bind the authoritative output-contract component bytes and version`);
  }
  if (!sameSortedStrings(binding?.requiredArtefactPaths ?? [], requiredArtefacts)) {
    v4Issue(issues, `receipt ${receipt.id} omits or changes ${receipt.checkpointId} requiredArtefacts`);
  }

  const expectedSnapshots = new Set(requiredArtefacts);
  const requiredIndexed = await indexedReferencePathsFromSnapshots(
    root,
    contract,
    snapshots,
    requiredArtefacts,
  );
  for (const indexedIssue of requiredIndexed.issues) {
    v4Issue(issues, `receipt ${receipt.id} ${indexedIssue}`);
  }
  for (const indexedPath of requiredIndexed.paths) expectedSnapshots.add(indexedPath);
  if (receipt.checkpointId === "CKPT-050") {
    const impactBinding = snapshots.get(contract.conditionalChangeResponse?.impactArtifact);
    if (!impactBinding) {
      v4Issue(issues, "CKPT-050 must snapshot its change-impact artifact");
    } else {
      const impactFile = await receiptSnapshotBytes(root, impactBinding);
      if (impactFile.issue) {
        v4Issue(issues, `CKPT-050 ${impactFile.issue}`);
      } else {
        let impact;
        try {
          impact = JSON.parse(impactFile.bytes.toString("utf8"));
        } catch {
          v4Issue(issues, "CKPT-050 change-impact snapshot is not valid JSON");
        }
        if (
          typeof contract.conditionalChangeResponse?.changeEventId !== "string"
          || impact?.changeEventId !== contract.conditionalChangeResponse.changeEventId
        ) {
          v4Issue(
            issues,
            "CKPT-050 change-impact snapshot must bind the exact output-contract changeEventId",
          );
        }
        if (!Array.isArray(impact?.affectedOutputRefs) || !Array.isArray(impact?.revisedArtifactPaths)) {
          v4Issue(issues, "CKPT-050 change-impact snapshot requires affectedOutputRefs and revisedArtifactPaths");
        } else {
          for (const revisedPath of impact.revisedArtifactPaths) {
            if (!isSafeRelativePath(revisedPath) || revisedPath.startsWith("receipts/")) {
              v4Issue(issues, `CKPT-050 declares unsafe revised artifact ${revisedPath}`);
            } else {
              expectedSnapshots.add(revisedPath);
            }
          }
          for (const outputRef of contract.conditionalChangeResponse?.affectedOutputRefs ?? []) {
            if (!impact.affectedOutputRefs.includes(outputRef)) continue;
            const reissuePaths = (contract.artefacts ?? [])
              .filter((artefact) => artefact.requiredOutputRef === outputRef)
              .map((artefact) => artefact.path);
            const indexed = await indexedReferencePathsFromSnapshots(
              root,
              contract,
              snapshots,
              reissuePaths,
            );
            for (const indexedIssue of indexed.issues) {
              v4Issue(issues, `receipt ${receipt.id} ${indexedIssue}`);
            }
            reissuePaths.push(...indexed.paths);
            for (const reissuePath of sortedUnique(reissuePaths)) {
              if (!impact.revisedArtifactPaths.includes(reissuePath)) {
                v4Issue(issues, `${outputRef} is affected but ${reissuePath} is absent from revisedArtifactPaths`);
              }
              expectedSnapshots.add(reissuePath);
            }
          }
          const revisedIndexed = await indexedReferencePathsFromSnapshots(
            root,
            contract,
            snapshots,
            impact.revisedArtifactPaths,
          );
          for (const indexedIssue of revisedIndexed.issues) {
            v4Issue(issues, `receipt ${receipt.id} ${indexedIssue}`);
          }
          for (const indexedPath of revisedIndexed.paths) {
            if (!impact.revisedArtifactPaths.includes(indexedPath)) {
              v4Issue(issues, `indexed reissue ${indexedPath} is absent from revisedArtifactPaths`);
            }
            expectedSnapshots.add(indexedPath);
          }
        }
      }
    }
  }
  if (!sameSortedStrings(sourcePaths, [...expectedSnapshots])) {
    v4Issue(issues, `receipt ${receipt.id} does not snapshot exactly its required and declared reissued artefact paths`);
  }
}

async function validateV4ReceiptChain(
  root,
  submission,
  planFile,
  checkpointFile,
  issues,
  options,
) {
  const receipts = submission.checkpointReceipts ?? [];
  const ids = new Set();
  const checkpointIds = new Set();
  const checkpointPositions = new Map();
  let previousDigest = "0".repeat(64);
  let lastSequence = -1;
  const completed = new Set(submission.partialAttainment?.completedCheckpointIds ?? []);
  const attempted = new Set(submission.partialAttainment?.attemptedCheckpointIds ?? []);
  const requireSnapshots = isV110ReceiptSnapshotSubmission(submission, options);
  const outputContract = options.outputContract;
  const outputContractSha256 = options.outputContractSha256;
  const latestCompletedSnapshotByPath = new Map();
  if (requireSnapshots && (
    !outputContract
    || !Array.isArray(outputContract.candidateCheckpoints)
    || !Array.isArray(outputContract.artefacts)
    || typeof outputContract.version !== "string"
    || !/^[a-f0-9]{64}$/.test(outputContractSha256 ?? "")
  )) {
    v4Issue(issues, "snapshot receipt validation requires authoritative outputContract and outputContractSha256");
  }
  for (const [receiptIndex, receipt] of receipts.entries()) {
    if (ids.has(receipt.id)) v4Issue(issues, `duplicate receipt id ${receipt.id}`);
    ids.add(receipt.id);
    if (checkpointIds.has(receipt.checkpointId)) {
      v4Issue(issues, `checkpoint ${receipt.checkpointId} has more than one receipt`);
    }
    checkpointIds.add(receipt.checkpointId);
    checkpointPositions.set(receipt.checkpointId, receiptIndex);
    if (requireSnapshots && receipt.sequence !== receiptIndex) {
      v4Issue(issues, `snapshot receipt ${receipt.id} must use contiguous sequence ${receiptIndex}`);
    }
    if (receipt.sequence <= lastSequence) v4Issue(issues, "receipt sequences must be strictly increasing");
    lastSequence = receipt.sequence;
    if (receipt.previousReceiptSha256 !== previousDigest) {
      v4Issue(issues, `receipt ${receipt.id} does not bind the prior receipt digest`);
    }
    const file = await regularFileInside(root, receipt.path);
    if (file.issue) {
      v4Issue(issues, file.issue);
      continue;
    }
    if (file.sha256 !== receipt.sha256) {
      v4Issue(issues, `receipt ${receipt.id} SHA-256 does not match submission.json`);
    }
    previousDigest = file.sha256;
    let record;
    try {
      record = JSON.parse(file.data.toString("utf8"));
    } catch {
      v4Issue(issues, `receipt ${receipt.id} is not valid JSON`);
      continue;
    }
    const receiptSchemaIssues = (
      options.contractValidators?.validateCheckpointReceiptRecord
      ?? validateCheckpointReceiptRecord
    )(record);
    for (const schemaIssue of receiptSchemaIssues) {
      v4Issue(issues, `receipt ${receipt.id} ${schemaIssue.message}`);
    }
    const expectedKeys = [
      "id",
      "sequence",
      "checkpointId",
      "previousReceiptSha256",
      "changeEventId",
    ];
    for (const key of expectedKeys) {
      if (record?.[key] !== receipt[key]) {
        v4Issue(issues, `receipt ${receipt.id} content does not match ${key}`);
      }
    }
    if (!Array.isArray(record?.evidence)) {
      v4Issue(issues, `receipt ${receipt.id} has no evidence declarations`);
    } else {
      for (const evidence of record.evidence) {
        const evidenceFile = await regularFileInside(root, evidence.path);
        if (evidenceFile.issue) v4Issue(issues, evidenceFile.issue);
        else if (evidenceFile.sha256 !== evidence.sha256) {
          v4Issue(issues, `receipt ${receipt.id} evidence hash does not match ${evidence.path}`);
        }
      }
    }
    if (requireSnapshots && outputContract && outputContractSha256) {
      const expectedChangeEventId = outputContract.conditionalChangeResponse?.changeEventId;
      if (receipt.checkpointId === "CKPT-050") {
        if (
          typeof expectedChangeEventId !== "string"
          || receipt.changeEventId !== expectedChangeEventId
          || record?.changeEventId !== expectedChangeEventId
        ) {
          v4Issue(
            issues,
            `receipt ${receipt.id} must bind the exact CKPT-050 output-contract changeEventId`,
          );
        }
      } else if (receipt.changeEventId !== undefined || record?.changeEventId !== undefined) {
        v4Issue(issues, `receipt ${receipt.id} may not declare changeEventId outside CKPT-050`);
      }
      await validateReceiptSnapshots({
        root,
        receipt,
        record,
        contract: outputContract,
        contractSha256: outputContractSha256,
        issues,
      });
      if (completed.has(receipt.checkpointId) && Array.isArray(record?.artifactSnapshots)) {
        for (const snapshot of record.artifactSnapshots) {
          if (
            isSafeRelativePath(snapshot?.sourcePath)
            && !snapshot.sourcePath.startsWith("receipts/")
            && /^[a-f0-9]{64}$/.test(snapshot?.sha256 ?? "")
          ) {
            latestCompletedSnapshotByPath.set(snapshot.sourcePath, {
              sha256: snapshot.sha256,
              checkpointId: receipt.checkpointId,
              sequence: receipt.sequence,
            });
          }
        }
      }
    }
  }
  if (requireSnapshots && outputContract) {
    for (const receipt of receipts) {
      const prerequisites = candidateCheckpointPrerequisites(outputContract, receipt.checkpointId);
      if (prerequisites === null) {
        v4Issue(issues, `output contract does not declare valid prerequisites for ${receipt.checkpointId}`);
        continue;
      }
      for (const prerequisite of prerequisites) {
        const prerequisitePosition = checkpointPositions.get(prerequisite);
        const receiptPosition = checkpointPositions.get(receipt.checkpointId);
        if (prerequisitePosition === undefined) {
          v4Issue(issues, `receipt ${receipt.id} is missing prerequisite ${prerequisite}`);
        } else if (prerequisitePosition >= receiptPosition) {
          v4Issue(issues, `receipt ${receipt.id} records prerequisite ${prerequisite} out of order`);
        }
      }
    }
  }
  if (submission.status === "complete" && submission.partialAttainment?.stoppedReason !== "completed") {
    v4Issue(issues, "complete submissions must record stoppedReason completed");
  }
  if (submission.status === "partial" && submission.partialAttainment?.stoppedReason === "completed") {
    v4Issue(issues, "partial submissions cannot record stoppedReason completed");
  }
  for (const checkpointId of completed) {
    if (!checkpointIds.has(checkpointId)) v4Issue(issues, `completed checkpoint ${checkpointId} has no receipt`);
  }
  for (const checkpointId of checkpointIds) {
    if (!attempted.has(checkpointId)) v4Issue(issues, `receipt checkpoint ${checkpointId} is not listed as attempted`);
  }
  if (!checkpointIds.has(submission.partialAttainment?.highestVerifiedCheckpointId)) {
    v4Issue(issues, "highestVerifiedCheckpointId has no receipt");
  }
  const initialReceipt = receipts[0];
  if (
    initialReceipt?.sequence !== 0
    || initialReceipt?.checkpointId !== "CKPT-000"
  ) {
    v4Issue(
      issues,
      "first receipt must be sequence 0 for CKPT-000",
    );
  }
  if (initialReceipt && planFile.sha256 && checkpointFile.sha256) {
    const initialFile = await regularFileInside(root, initialReceipt.path);
    try {
      const initialRecord = JSON.parse(initialFile.data.toString("utf8"));
      const planBound = initialRecord.evidence?.some((evidence) => (
        evidence.path === "plan.json" && evidence.sha256 === planFile.sha256
      ));
      const checkpointBound = initialRecord.evidence?.some((evidence) => (
        evidence.path === "initial-plan.sha256"
        && evidence.sha256 === checkpointFile.sha256
      ));
      if (!planBound) v4Issue(issues, "first receipt must bind plan.json");
      if (!checkpointBound) {
        v4Issue(issues, "first receipt must bind initial-plan.sha256");
      }
    } catch {
      // Other receipt diagnostics already provide the actionable error.
    }
  }
  return { latestCompletedSnapshotByPath, requireSnapshots };
}

export async function readCandidateSubmissionIdentity(root) {
  if (path.basename(path.resolve(root)) !== "candidate-output") {
    throw new Error("Stage 1 bundle root must be named candidate-output");
  }
  const file = await regularFileInside(root, "submission.json");
  if (file.issue) throw new Error(file.issue);
  let submission;
  try {
    submission = JSON.parse(file.data.toString("utf8"));
  } catch {
    throw new Error("missing or invalid submission.json");
  }
  if (
    typeof submission.launchId !== "string"
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(submission.launchId)
    || !["2.0", "3.0", "4.0"].includes(submission.protocolVersion)
  ) {
    throw new Error("submission.json does not declare a safe launch identity");
  }
  return {
    launchId: submission.launchId,
    protocolVersion: submission.protocolVersion,
  };
}

export async function validateCandidateBundle(root, options = {}) {
  const issues = [];
  const expectedRootName = options.expectedRootName ?? "candidate-output";
  const contractValidators = options.contractValidators ?? {
    validatePlan,
    validateSubmission,
    validateWorkRecord,
  };
  if (path.basename(path.resolve(root)) !== expectedRootName) {
    issues.push(`Stage 1 bundle root must be named ${expectedRootName}`);
  }
  let submission;
  try {
    submission = await readJson(path.join(root, "submission.json"));
  } catch {
    return { status: "invalid", issues: ["missing or invalid submission.json"] };
  }
  issues.push(...contractValidators.validateSubmission(submission).map((issue) => issue.message));
  if (issues.length > 0) return { status: "invalid", issues };

  const planFile = await regularFileInside(root, submission.initialPlan.path);
  const checkpointFile = await regularFileInside(
    root,
    submission.initialPlanCheckpoint.path,
  );
  const recordFile = await regularFileInside(root, submission.workRecord.path);
  if (planFile.issue) issues.push(planFile.issue);
  if (checkpointFile.issue) issues.push(checkpointFile.issue);
  if (recordFile.issue) issues.push(recordFile.issue);
  if (planFile.sha256 && planFile.sha256 !== submission.initialPlan.sha256) {
    issues.push("initial plan SHA-256 does not match submission.json");
  }
  if (recordFile.sha256 && recordFile.sha256 !== submission.workRecord.sha256) {
    issues.push("work record SHA-256 does not match submission.json");
  }
  if (
    checkpointFile.sha256
    && checkpointFile.sha256 !== submission.initialPlanCheckpoint.sha256
  ) {
    issues.push("initial plan checkpoint SHA-256 does not match submission.json");
  }
  if (
    planFile.sha256
    && checkpointFile.data
    && checkpointFile.data.toString("utf8").trim() !== `${planFile.sha256}  plan.json`
  ) {
    issues.push("initial-plan.sha256 does not checkpoint the submitted initial plan");
  }

  let plan;
  let workRecord;
  try {
    if (planFile.data) plan = JSON.parse(planFile.data.toString("utf8"));
    if (recordFile.data) workRecord = JSON.parse(recordFile.data.toString("utf8"));
  } catch {
    issues.push("plan.json or work-record.json is not valid JSON");
  }
  if (plan) issues.push(...contractValidators.validatePlan(plan).map((issue) => issue.message));
  if (workRecord) {
    issues.push(...contractValidators.validateWorkRecord(workRecord).map((issue) => issue.message));
  }

  let receiptState = {
    latestCompletedSnapshotByPath: new Map(),
    requireSnapshots: false,
  };
  if (submission.protocolVersion === "4.0") {
    receiptState = await validateV4ReceiptChain(
      root,
      submission,
      planFile,
      checkpointFile,
      issues,
      options,
    );
    if (!submission.sanitizationRequest?.profileDigest) {
      v4Issue(issues, "sanitizationRequest must bind the frozen evaluator profile");
    }
  }

  for (const duplicate of duplicateIds(plan?.requirements ?? [])) {
    issues.push(`duplicate requirement id: ${duplicate}`);
  }
  for (const collection of [
    plan?.steps ?? [],
    plan?.alternativesToEvaluate ?? [],
    plan?.verificationPlan ?? [],
    workRecord?.alternatives ?? [],
    workRecord?.decisions ?? [],
    workRecord?.planRevisions ?? [],
    workRecord?.verificationClaims ?? [],
    submission.artifacts,
  ]) {
    for (const duplicate of duplicateIds(collection)) issues.push(`duplicate id: ${duplicate}`);
  }

  const requirementIds = new Set((plan?.requirements ?? []).map(({ id }) => id));
  const stepIds = new Set((plan?.steps ?? []).map(({ id }) => id));
  const alternativeIds = new Set([
    ...(plan?.alternativesToEvaluate ?? []).map(({ id }) => id),
    ...(workRecord?.alternatives ?? []).map(({ id }) => id),
  ]);
  const artifactIds = new Set(submission.artifacts.map(({ id }) => id));
  const requireRefs = (items, key, known, label) => {
    for (const item of items ?? []) {
      for (const ref of item[key] ?? []) {
        if (!known.has(ref)) issues.push(`${label} ${item.id} has dangling reference ${ref}`);
      }
    }
  };
  requireRefs(plan?.steps, "requirementRefs", requirementIds, "plan step");
  requireRefs(plan?.alternativesToEvaluate, "requirementRefs", requirementIds, "planned alternative");
  requireRefs(plan?.verificationPlan, "requirementRefs", requirementIds, "verification plan");
  requireRefs(workRecord?.decisions, "requirementRefs", requirementIds, "decision");
  requireRefs(workRecord?.decisions, "alternativeRefs", alternativeIds, "decision");
  requireRefs(workRecord?.planRevisions, "affectedStepRefs", stepIds, "plan revision");
  requireRefs(workRecord?.verificationClaims, "requirementRefs", requirementIds, "verification claim");
  requireRefs(workRecord?.verificationClaims, "evidenceArtifactRefs", artifactIds, "verification claim");

  for (const artifact of submission.artifacts) {
    const file = await regularFileInside(root, artifact.path);
    if (file.issue) issues.push(file.issue);
    else if (file.sha256 !== artifact.sha256) {
      issues.push(`artifact ${artifact.id} SHA-256 does not match submission.json`);
    }
    if (receiptState.requireSnapshots) {
      const latestSnapshot = receiptState.latestCompletedSnapshotByPath.get(artifact.path);
      if (!latestSnapshot) {
        v4Issue(
          issues,
          `submission artifact ${artifact.path} has no completed checkpoint receipt snapshot`,
        );
      } else if (
        file.sha256
        && (
          file.sha256 !== latestSnapshot.sha256
          || artifact.sha256 !== latestSnapshot.sha256
        )
      ) {
        v4Issue(
          issues,
          `submission artifact ${artifact.path} does not match its latest completed receipt snapshot`,
        );
      }
    }
  }

  try {
    await bundleTreeHash(root);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "bundle tree cannot be hashed");
  }

  return { status: issues.length === 0 ? "valid" : "invalid", issues, submission, plan, workRecord };
}

export { bundleTreeHash };
export { loadFrozenContractValidators };
