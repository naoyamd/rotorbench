import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { createHash } from "node:crypto";

function ensureInside(root, relativePath) {
  if (
    typeof relativePath !== "string"
    || relativePath.length === 0
    || path.isAbsolute(relativePath)
    || relativePath.split(/[\\/]/).includes("..")
  ) {
    return null;
  }
  const absoluteRoot = path.resolve(root);
  const candidate = path.resolve(absoluteRoot, relativePath);
  const relative = path.relative(absoluteRoot, candidate);
  return (
    relative !== ""
    && !relative.startsWith("..")
    && !path.isAbsolute(relative)
  )
    ? candidate
    : null;
}

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

function checkpointSequence(packet, checkpointId) {
  const checkpoint = (packet?.checkpoints ?? []).find(({ id }) => id === checkpointId);
  return checkpoint?.sequence ?? null;
}

function checkpointForArtifact(packet, outputContract, artifactPath) {
  const candidates = (outputContract.candidateCheckpoints ?? [])
    .filter((checkpoint) => checkpoint.requiredArtefacts?.includes(artifactPath))
    .map((checkpoint) => ({
      id: checkpoint.id,
      sequence: checkpointSequence(packet, checkpoint.id),
    }))
    .filter(({ sequence }) => Number.isInteger(sequence))
    .sort((left, right) => left.sequence - right.sequence);
  return candidates[0] ?? null;
}

function parseCsvRows(bytes) {
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
    if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      fields.push(value.trim());
      value = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      fields.push(value.trim());
      rows.push(fields);
      fields = [];
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV has an unterminated quoted field");
  if (value.length > 0 || fields.length > 0) {
    fields.push(value.trim());
    rows.push(fields);
  }
  return rows;
}

function parseCsvHeader(bytes) {
  return parseCsvRows(bytes).at(0) ?? [];
}

function parseCsvRecords(bytes) {
  const [header, ...rows] = parseCsvRows(bytes);
  if (!header?.length) throw new Error("CSV header is missing");
  return {
    header,
    records: rows
      .filter((row) => row.some((value) => value.length > 0))
      .map((row) => Object.fromEntries(header.map((field, index) => [field, row[index] ?? ""]))),
  };
}

async function regularFile(root, relativePath) {
  const target = ensureInside(root, relativePath);
  if (!target) return { error: "unsafe path" };
  try {
    const info = await lstat(target);
    if (!info.isFile() || info.isSymbolicLink()) return { error: "not a regular file" };
    return { path: target, bytes: await readFile(target) };
  } catch {
    return { error: "missing file" };
  }
}

async function outputContractForPacket(packetRoot, packet) {
  const entry = (packet?.inputs ?? []).find(({ id }) => id === "output-contract");
  if (!entry?.path) return { status: "not-applicable" };
  const file = await regularFile(packetRoot, entry.path);
  if (file.error) {
    return {
      status: "invalid-contract",
      issues: [issue("output-contract-unavailable", `Cannot read frozen output contract: ${entry.path}`)],
    };
  }
  try {
    const contract = JSON.parse(file.bytes.toString("utf8"));
    if (!Array.isArray(contract.artefacts) || !Array.isArray(contract.candidateCheckpoints)) {
      throw new Error("artefacts and candidateCheckpoints arrays are required");
    }
    return { status: "valid", contract };
  } catch (error) {
    return {
      status: "invalid-contract",
      issues: [issue(
        "output-contract-invalid-json",
        `Frozen output contract is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`,
      )],
    };
  }
}

function highestAttainedCheckpoint(packet, submission) {
  const id = submission?.partialAttainment?.highestVerifiedCheckpointId;
  if (!id) return { id: null, sequence: -1, issues: [] };
  const sequence = checkpointSequence(packet, id);
  if (!Number.isInteger(sequence)) {
    return {
      id,
      sequence: -1,
      issues: [issue("unknown-highest-checkpoint", `Submission names an unknown highest checkpoint: ${id}`)],
    };
  }
  return { id, sequence, issues: [] };
}

function matchesExpectedMetadata(expected, actual) {
  const issues = [];
  if (actual.status !== "present" && actual.status !== "processed") {
    issues.push(issue(
      "artifact-not-present",
      `${expected.path} is declared with status ${actual.status}`,
      { path: expected.path },
    ));
  }
  if (actual.role !== expected.role) {
    issues.push(issue(
      "artifact-role-mismatch",
      `${expected.path} must have role ${expected.role}`,
      { path: expected.path },
    ));
  }
  if (actual.mediaType !== expected.mediaType) {
    issues.push(issue(
      "artifact-media-type-mismatch",
      `${expected.path} must declare media type ${expected.mediaType}`,
      { path: expected.path },
    ));
  }
  if (!actual.requiredOutputRefs?.includes(expected.requiredOutputRef)) {
    issues.push(issue(
      "artifact-required-output-mismatch",
      `${expected.path} must bind ${expected.requiredOutputRef}`,
      { path: expected.path },
    ));
  }
  return issues;
}

async function inspectArtifact(candidateRoot, expected) {
  const file = await regularFile(candidateRoot, expected.path);
  if (file.error) {
    return [issue("artifact-file-missing", `${expected.path}: ${file.error}`, { path: expected.path })];
  }
  if (expected.mediaType === "application/json") {
    try {
      const data = JSON.parse(file.bytes.toString("utf8"));
      for (const field of expected.requiredFields ?? []) {
        if (!Object.hasOwn(data, field)) {
          return [issue(
            "artifact-json-required-field-missing",
            `${expected.path} is missing JSON field ${field}`,
            { path: expected.path, field },
          )];
        }
      }
    } catch {
      return [issue("artifact-json-invalid", `${expected.path} is not valid JSON`, { path: expected.path })];
    }
  }
  if (expected.mediaType === "text/csv") {
    try {
      const headers = new Set(parseCsvHeader(file.bytes));
      for (const field of expected.requiredFields ?? []) {
        if (!headers.has(field)) {
          return [issue(
            "artifact-csv-required-header-missing",
            `${expected.path} is missing CSV header ${field}`,
            { path: expected.path, field },
          )];
        }
      }
    } catch (error) {
      return [issue(
        "artifact-csv-invalid",
        `${expected.path} cannot be read as CSV: ${error instanceof Error ? error.message : "invalid CSV"}`,
        { path: expected.path },
      )];
    }
  }
  if (expected.mediaType === "model/step") {
    const text = file.bytes.toString("latin1");
    if (
      !text.startsWith("ISO-10303-21;")
      || !text.includes("HEADER;")
      || !text.includes("DATA;")
      || !text.trimEnd().endsWith("END-ISO-10303-21;")
    ) {
      return [issue(
        "artifact-step-invalid-envelope",
        `${expected.path} is not a recognizable ISO 10303-21 exchange file`,
        { path: expected.path },
      )];
    }
  }
  if (expected.mediaType === "application/pdf") {
    const prefix = file.bytes.subarray(0, 8).toString("latin1");
    const suffix = file.bytes.subarray(Math.max(0, file.bytes.length - 2048)).toString("latin1");
    if (!prefix.startsWith("%PDF-") || !suffix.includes("%%EOF")) {
      return [issue(
        "artifact-pdf-invalid-envelope",
        `${expected.path} is not a recognizable PDF file`,
        { path: expected.path },
      )];
    }
  }
  if (
    ["text/markdown", "text/plain"].includes(expected.mediaType)
    && file.bytes.toString("utf8").trim().length === 0
  ) {
    return [issue(
      "artifact-text-empty",
      `${expected.path} must not be empty`,
      { path: expected.path },
    )];
  }
  // Files are never executed or rendered at admission. Richer common STEP,
  // PDF, CAD, geometry and kinematic processing remains evaluator-owned and is
  // recorded separately from this fail-closed static envelope check.
  return [];
}

function indexedMediaType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if ([".step", ".stp"].includes(extension)) return "model/step";
  if (extension === ".json") return "application/json";
  return null;
}

function indexedMetadataIssues(actual, relativePath, mediaType) {
  const issues = [];
  if (actual.status !== "present" && actual.status !== "processed") {
    issues.push(issue("indexed-drawing-not-present", `${relativePath} is declared with status ${actual.status}`, { path: relativePath }));
  }
  if (actual.role !== "drawing") {
    issues.push(issue("indexed-drawing-role-mismatch", `${relativePath} must have drawing role`, { path: relativePath }));
  }
  if (!actual.requiredOutputRefs?.includes("OUT-006")) {
    issues.push(issue("indexed-drawing-output-mismatch", `${relativePath} must bind OUT-006`, { path: relativePath }));
  }
  if (actual.mediaType !== mediaType) {
    issues.push(issue("indexed-drawing-media-type-mismatch", `${relativePath} must declare media type ${mediaType}`, { path: relativePath }));
  }
  return issues;
}

function indexedCadMetadataIssues(actual, relativePath, mediaType) {
  const issues = [];
  if (actual.status !== "present" && actual.status !== "processed") issues.push(issue("indexed-cad-source-not-present", `${relativePath} is declared with status ${actual.status}`, { path: relativePath }));
  if (actual.role !== "cad-source") issues.push(issue("indexed-cad-source-role-mismatch", `${relativePath} must have cad-source role`, { path: relativePath }));
  if (!actual.requiredOutputRefs?.includes("OUT-001")) issues.push(issue("indexed-cad-source-output-mismatch", `${relativePath} must bind OUT-001`, { path: relativePath }));
  if (actual.mediaType !== mediaType) issues.push(issue("indexed-cad-source-media-type-mismatch", `${relativePath} must declare media type ${mediaType}`, { path: relativePath }));
  return issues;
}

async function inspectIndexedDrawingReferences({ candidateRoot, expected, declaredByPath }) {
  const config = expected.indexedFileReferences;
  if (!config || config.kind !== "csv-row-paths") return { issues: [], paths: [], artifacts: [] };
  const index = await regularFile(candidateRoot, expected.path);
  if (index.error) return { issues: [issue("indexed-drawing-index-unavailable", `${expected.path}: ${index.error}`, { path: expected.path })], paths: [], artifacts: [] };
  let records;
  try {
    records = parseCsvRecords(index.bytes).records;
  } catch (error) {
    return { issues: [issue("indexed-drawing-index-invalid", `${expected.path}: ${error instanceof Error ? error.message : "invalid CSV"}`, { path: expected.path })], paths: [], artifacts: [] };
  }
  if (records.length === 0) {
    return { issues: [issue("indexed-drawing-index-empty", `${expected.path} must contain at least one drawing record`, { path: expected.path })], paths: [], artifacts: [] };
  }
  const issues = [];
  const paths = [];
  const artifacts = [];
  const seen = new Set();
  for (const [rowIndex, record] of records.entries()) {
    for (const [field, rule] of Object.entries(config)) {
      if (!rule || typeof rule !== "object" || !Object.hasOwn(rule, "required")) continue;
      const relativePath = String(record[field] ?? "").trim();
      if (!relativePath) {
        if (rule.required) issues.push(issue("indexed-drawing-path-missing", `${expected.path} row ${rowIndex + 2} requires ${field}`, { path: expected.path }));
        continue;
      }
      if (!relativePath.startsWith(`${config.pathRoot}/`)) {
        issues.push(issue("indexed-drawing-path-root", `${relativePath} must be below ${config.pathRoot}`, { path: relativePath }));
        continue;
      }
      if (seen.has(relativePath)) {
        issues.push(issue("indexed-drawing-path-duplicate", `${relativePath} is indexed more than once`, { path: relativePath }));
        continue;
      }
      seen.add(relativePath);
      paths.push(relativePath);
      const mediaType = indexedMediaType(relativePath);
      if (!mediaType || !rule.allowedMediaTypes?.includes(mediaType)) {
        issues.push(issue("indexed-drawing-media-type-unsupported", `${relativePath} is not an allowed ${field} type`, { path: relativePath }));
        continue;
      }
      const declared = declaredByPath.get(relativePath) ?? [];
      if (declared.length !== 1) {
        issues.push(issue(
          declared.length === 0 ? "indexed-drawing-artifact-missing" : "indexed-drawing-artifact-duplicate",
          `${relativePath} must be declared exactly once as a drawing artifact`,
          { path: relativePath },
        ));
      } else {
        issues.push(...indexedMetadataIssues(declared[0], relativePath, mediaType));
      }
      artifacts.push({ path: relativePath, mediaType, role: "drawing", requiredOutputRef: "OUT-006" });
      const file = await regularFile(candidateRoot, relativePath);
      if (file.error) {
        issues.push(issue("indexed-drawing-file-missing", `${relativePath}: ${file.error}`, { path: relativePath }));
        continue;
      }
      if (mediaType === "application/pdf") {
        const prefix = file.bytes.subarray(0, 8).toString("latin1");
        const suffix = file.bytes.subarray(Math.max(0, file.bytes.length - 2048)).toString("latin1");
        if (!prefix.startsWith("%PDF-") || !suffix.includes("%%EOF")) issues.push(issue("indexed-drawing-pdf-invalid", `${relativePath} is not a recognizable PDF`, { path: relativePath }));
      } else if (mediaType === "model/step") {
        const text = file.bytes.toString("latin1");
        if (!text.startsWith("ISO-10303-21;") || !text.includes("HEADER;") || !text.includes("DATA;") || !text.trimEnd().endsWith("END-ISO-10303-21;")) issues.push(issue("indexed-drawing-step-invalid", `${relativePath} is not a recognizable STEP exchange file`, { path: relativePath }));
      } else {
        try {
          const pmi = JSON.parse(file.bytes.toString("utf8"));
          if (!Array.isArray(pmi.pmiRecords) || pmi.pmiRecords.length === 0) throw new Error("pmiRecords must be a non-empty array");
        } catch (error) {
          issues.push(issue("indexed-drawing-pmi-invalid", `${relativePath}: ${error instanceof Error ? error.message : "invalid PMI JSON"}`, { path: relativePath }));
        }
      }
    }
  }
  return { issues, paths, artifacts };
}

async function inspectIndexedCadSourceReferences({ candidateRoot, expected, declaredByPath }) {
  const config = expected.indexedFileReferences;
  if (!config || config.kind !== "json-records") return { issues: [], paths: [], artifacts: [] };
  const manifest = await regularFile(candidateRoot, expected.path);
  if (manifest.error) return { issues: [issue("indexed-cad-source-manifest-unavailable", `${expected.path}: ${manifest.error}`, { path: expected.path })], paths: [], artifacts: [] };
  let records;
  try {
    const data = JSON.parse(manifest.bytes.toString("utf8"));
    records = data[config.recordsField];
    if (!Array.isArray(records) || records.length === 0) throw new Error(`${config.recordsField} must be a non-empty array`);
  } catch (error) {
    return { issues: [issue("indexed-cad-source-manifest-invalid", `${expected.path}: ${error instanceof Error ? error.message : "invalid JSON"}`, { path: expected.path })], paths: [], artifacts: [] };
  }
  const issues = [];
  const paths = [];
  const artifacts = [];
  const seen = new Set();
  for (const [index, record] of records.entries()) {
    const relativePath = String(record?.[config.pathField] ?? "").trim();
    const mediaType = String(record?.[config.mediaTypeField] ?? "").trim();
    const declaredHash = String(record?.[config.sha256Field] ?? "").trim().toLowerCase();
    if (!relativePath || !mediaType || !/^[a-f0-9]{64}$/.test(declaredHash)) {
      issues.push(issue("indexed-cad-source-record-invalid", `${expected.path} record ${index + 1} requires safe path, allowed mediaType, and SHA-256`, { path: expected.path }));
      continue;
    }
    if (!relativePath.startsWith(`${config.pathRoot}/`) || !ensureInside(candidateRoot, relativePath)) {
      issues.push(issue("indexed-cad-source-path-root", `${relativePath} must be below ${config.pathRoot}`, { path: relativePath }));
      continue;
    }
    if (seen.has(relativePath)) {
      issues.push(issue("indexed-cad-source-path-duplicate", `${relativePath} is listed more than once`, { path: relativePath }));
      continue;
    }
    seen.add(relativePath);
    paths.push(relativePath);
    if (!config.allowedMediaTypes?.includes(mediaType)) {
      issues.push(issue("indexed-cad-source-media-type-unsupported", `${relativePath} declares unsupported source media type ${mediaType}`, { path: relativePath }));
      continue;
    }
    const declared = declaredByPath.get(relativePath) ?? [];
    if (declared.length !== 1) {
      issues.push(issue(declared.length === 0 ? "indexed-cad-source-artifact-missing" : "indexed-cad-source-artifact-duplicate", `${relativePath} must be declared exactly once as a CAD source artifact`, { path: relativePath }));
    } else {
      issues.push(...indexedCadMetadataIssues(declared[0], relativePath, mediaType));
    }
    const file = await regularFile(candidateRoot, relativePath);
    if (file.error) {
      issues.push(issue("indexed-cad-source-file-missing", `${relativePath}: ${file.error}`, { path: relativePath }));
      continue;
    }
    const actualHash = createHash("sha256").update(file.bytes).digest("hex");
    if (actualHash !== declaredHash) issues.push(issue("indexed-cad-source-hash-mismatch", `${relativePath} does not match source-manifest SHA-256`, { path: relativePath }));
    artifacts.push({ path: relativePath, mediaType, role: "cad-source", requiredOutputRef: "OUT-001" });
  }
  return { issues, paths, artifacts };
}

async function validateNeutralHandoff({ packetRoot, packet, candidateRoot, attained }) {
  const contractInput = (packet.inputs ?? []).find(({ id }) => id === "neutral-handoff-contract");
  const validatorInput = (packet.inputs ?? []).find(({ id }) => id === "neutral-handoff-validator");
  if (!contractInput && !validatorInput) return { issues: [], report: null };
  if (!contractInput || !validatorInput) {
    return { issues: [issue("neutral-handoff-input-missing", "Neutral handoff contract and validator inputs must be declared together")], report: null };
  }
  const contractFile = await regularFile(packetRoot, contractInput.path);
  const validatorFile = await regularFile(packetRoot, validatorInput.path);
  if (contractFile.error || validatorFile.error) {
    return { issues: [issue("neutral-handoff-input-unavailable", "Frozen neutral handoff contract or validator is unavailable")], report: null };
  }
  let contract;
  try {
    contract = JSON.parse(contractFile.bytes.toString("utf8"));
  } catch {
    return { issues: [issue("neutral-handoff-contract-invalid", "Frozen neutral handoff contract is not valid JSON")], report: null };
  }
  const due = checkpointSequence(packet, contract.candidateArtifacts?.requiredAtCheckpoint);
  if (!Number.isInteger(due) || attained.sequence < due) return { issues: [], report: null };
  try {
    const validatorModule = await import(pathToFileURL(validatorFile.path).href);
    if (typeof validatorModule.validateNeutralHandoff !== "function") throw new Error("missing validateNeutralHandoff export");
    const report = await validatorModule.validateNeutralHandoff({ candidateRoot, contract });
    const issues = (report?.checks ?? [])
      .filter(({ result }) => result !== "pass")
      .map(({ id, detail }) => issue("neutral-handoff-validation-failed", `${id}: ${detail}`));
    return { issues, report };
  } catch (error) {
    return { issues: [issue("neutral-handoff-validator-error", error instanceof Error ? error.message : "Neutral handoff validator failed")], report: null };
  }
}

async function validateConditionalChangeResponse({ candidateRoot, contract, attained, indexedPaths }) {
  const policy = contract.conditionalChangeResponse;
  if (!policy || attained.id !== policy.triggerCheckpoint) return [];
  const impact = await regularFile(candidateRoot, policy.impactArtifact);
  if (impact.error) return [issue("change-impact-unavailable", `${policy.impactArtifact}: ${impact.error}`, { path: policy.impactArtifact })];
  let record;
  try {
    record = JSON.parse(impact.bytes.toString("utf8"));
  } catch {
    return [issue("change-impact-invalid", `${policy.impactArtifact} is not valid JSON`, { path: policy.impactArtifact })];
  }
  if (!Array.isArray(record.affectedOutputRefs) || !Array.isArray(record.revisedArtifactPaths)) {
    return [issue("change-impact-fields-invalid", `${policy.impactArtifact} must contain affectedOutputRefs and revisedArtifactPaths arrays`, { path: policy.impactArtifact })];
  }
  const affected = new Set(record.affectedOutputRefs);
  const revised = new Set(record.revisedArtifactPaths);
  const issues = [];
  for (const outputRef of policy.affectedOutputRefs ?? []) {
    if (!affected.has(outputRef)) continue;
    const required = (contract.artefacts ?? [])
      .filter((artifact) => artifact.requiredOutputRef === outputRef)
      .map((artifact) => artifact.path);
    if (outputRef === "OUT-006") required.push(...indexedPaths);
    for (const artifactPath of new Set(required)) {
      if (!revised.has(artifactPath)) {
        issues.push(issue("change-affected-artifact-not-reissued", `${outputRef} is affected but ${artifactPath} is absent from revisedArtifactPaths`, { path: artifactPath }));
      }
    }
  }
  return issues;
}

/**
 * Validate the task-owned artifact contract against a candidate bundle.
 *
 * Missing artifacts after the highest verified checkpoint are returned as
 * deferred obligations, not admission failures. Anything required at or before
 * that checkpoint must be declared and minimally inspectable.
 */
export async function validateArtifactContract({ candidateRoot, packetRoot, packet, submission }) {
  if (!packetRoot) {
    return {
      status: "not-applicable",
      admissionIssues: [],
      deferred: [],
      coverage: null,
    };
  }
  const loaded = await outputContractForPacket(packetRoot, packet);
  if (loaded.status !== "valid") {
    return {
      status: loaded.status,
      admissionIssues: loaded.issues ?? [],
      deferred: [],
      coverage: null,
    };
  }

  const attained = highestAttainedCheckpoint(packet, submission);
  const admissionIssues = [...attained.issues];
  const declaredByPath = new Map();
  for (const artifact of submission?.artifacts ?? []) {
    const existing = declaredByPath.get(artifact.path) ?? [];
    existing.push(artifact);
    declaredByPath.set(artifact.path, existing);
  }

  const deferred = [];
  const inspected = [];
  const indexedPaths = [];
  const indexedArtifacts = [];
  let due = 0;
  let satisfied = 0;
  for (const expected of loaded.contract.artefacts) {
    const requiredAt = checkpointForArtifact(packet, loaded.contract, expected.path);
    if (!requiredAt) {
      admissionIssues.push(issue(
        "artifact-contract-checkpoint-missing",
        `${expected.path} is not assigned to a frozen packet checkpoint`,
        { path: expected.path },
      ));
      continue;
    }
    const isDue = requiredAt.sequence <= attained.sequence;
    const declared = declaredByPath.get(expected.path) ?? [];
    if (!isDue && declared.length === 0) {
      deferred.push({
        id: expected.id,
        path: expected.path,
        requiredAtCheckpointId: requiredAt.id,
        reason: "not-required-before-highest-verified-checkpoint",
      });
      continue;
    }
    if (isDue) due += 1;
    if (declared.length === 0) {
      const target = isDue ? admissionIssues : deferred;
      target.push(isDue
        ? issue(
          "artifact-required-by-attainment-missing",
          `${expected.path} is required by attained checkpoint ${requiredAt.id}`,
          { path: expected.path, requiredAtCheckpointId: requiredAt.id },
        )
        : {
          id: expected.id,
          path: expected.path,
          requiredAtCheckpointId: requiredAt.id,
          reason: "declared-later-artifact-missing",
        });
      continue;
    }
    if (declared.length > 1) {
      admissionIssues.push(issue(
        "artifact-contract-duplicate-path",
        `${expected.path} is declared more than once`,
        { path: expected.path },
      ));
      continue;
    }
    const metadataIssues = matchesExpectedMetadata(expected, declared[0]);
    const inspectionIssues = await inspectArtifact(candidateRoot, expected);
    const drawingIndex = await inspectIndexedDrawingReferences({
      candidateRoot,
      expected,
      declaredByPath,
    });
    const sourceIndex = await inspectIndexedCadSourceReferences({
      candidateRoot,
      expected,
      declaredByPath,
    });
    indexedPaths.push(...drawingIndex.paths);
    indexedArtifacts.push(...drawingIndex.artifacts, ...sourceIndex.artifacts);
    const allIssues = [
      ...metadataIssues,
      ...inspectionIssues,
      ...drawingIndex.issues,
      ...sourceIndex.issues,
    ];
    if (allIssues.length > 0) admissionIssues.push(...allIssues);
    else {
      inspected.push(expected.path);
      if (isDue) satisfied += 1;
    }
  }

  const neutralHandoff = await validateNeutralHandoff({
    packetRoot,
    packet,
    candidateRoot,
    attained,
  });
  admissionIssues.push(...neutralHandoff.issues);
  admissionIssues.push(...await validateConditionalChangeResponse({
    candidateRoot,
    contract: loaded.contract,
    attained,
    packet,
    indexedPaths,
  }));

  return {
    status: admissionIssues.length === 0 ? "valid" : "invalid",
    admissionIssues,
    deferred,
    indexedArtifacts: [...new Map(indexedArtifacts.map((artifact) => [artifact.path, artifact])).values()].sort((left, right) => left.path.localeCompare(right.path)),
    ...(neutralHandoff.report ? { neutralHandoff: neutralHandoff.report } : {}),
    coverage: {
      highestVerifiedCheckpointId: attained.id,
      dueArtifactCount: due,
      satisfiedArtifactCount: satisfied,
      ratio: due === 0 ? 1 : satisfied / due,
      inspectedPaths: inspected.sort(),
      deferredArtifactCount: deferred.length,
    },
  };
}
