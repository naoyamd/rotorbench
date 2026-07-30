import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

const arg = (name, required = false) => {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing ${name}`);
  return value;
};

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function issue(code, message, details = {}) {
  return { code, message, ...details };
}

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
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
    ? candidate
    : null;
}

function safeRelative(value) {
  if (typeof value !== "string") return false;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value)) return false;
  return value.split("/").every((segment) => segment !== "." && segment !== "..");
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
      .map((row) => Object.fromEntries(
        header.map((field, index) => [field, row[index] ?? ""]),
      )),
  };
}

function checkpointForArtifact(contract, artifactPath) {
  const index = (contract.candidateCheckpoints ?? []).findIndex(
    (checkpoint) => checkpoint.requiredArtefacts?.includes(artifactPath),
  );
  return index === -1 ? null : { id: contract.candidateCheckpoints[index].id, index };
}

function expectedMetadataIssues(expected, actual) {
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

function stepEnvelopeValid(bytes) {
  const text = bytes.toString("latin1");
  return text.startsWith("ISO-10303-21;")
    && text.includes("HEADER;")
    && text.includes("DATA;")
    && text.trimEnd().endsWith("END-ISO-10303-21;");
}

function pdfEnvelopeValid(bytes) {
  const prefix = bytes.subarray(0, 8).toString("latin1");
  const suffix = bytes.subarray(Math.max(0, bytes.length - 2048)).toString("latin1");
  return prefix.startsWith("%PDF-") && suffix.includes("%%EOF");
}

async function inspectArtifact(root, expected) {
  const file = await regularFile(root, expected.path);
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
  if (expected.mediaType === "model/step" && !stepEnvelopeValid(file.bytes)) {
    return [issue(
      "artifact-step-invalid-envelope",
      `${expected.path} is not a recognizable ISO 10303-21 exchange file`,
      { path: expected.path },
    )];
  }
  if (expected.mediaType === "application/pdf" && !pdfEnvelopeValid(file.bytes)) {
    return [issue(
      "artifact-pdf-invalid-envelope",
      `${expected.path} is not a recognizable PDF file`,
      { path: expected.path },
    )];
  }
  if (
    ["text/markdown", "text/plain"].includes(expected.mediaType)
    && file.bytes.toString("utf8").trim().length === 0
  ) {
    return [issue("artifact-text-empty", `${expected.path} must not be empty`, { path: expected.path })];
  }
  // Candidate bytes are never imported, executed, rendered, or handed to CAD.
  return [];
}

function indexedMediaType(relativePath) {
  const extension = path.extname(relativePath).toLowerCase();
  if (extension === ".pdf") return "application/pdf";
  if ([".step", ".stp"].includes(extension)) return "model/step";
  if (extension === ".json") return "application/json";
  return null;
}

function indexedDrawingMetadataIssues(actual, relativePath, mediaType) {
  const issues = [];
  if (actual.status !== "present" && actual.status !== "processed") issues.push(issue("indexed-drawing-not-present", `${relativePath} is declared with status ${actual.status}`, { path: relativePath }));
  if (actual.role !== "drawing") issues.push(issue("indexed-drawing-role-mismatch", `${relativePath} must have drawing role`, { path: relativePath }));
  if (!actual.requiredOutputRefs?.includes("OUT-006")) issues.push(issue("indexed-drawing-output-mismatch", `${relativePath} must bind OUT-006`, { path: relativePath }));
  if (actual.mediaType !== mediaType) issues.push(issue("indexed-drawing-media-type-mismatch", `${relativePath} must declare media type ${mediaType}`, { path: relativePath }));
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

async function inspectIndexedDrawings({ root, expected, declaredByPath }) {
  const config = expected.indexedFileReferences;
  if (!config || config.kind !== "csv-row-paths") return { issues: [], paths: [], artifacts: [] };
  const index = await regularFile(root, expected.path);
  if (index.error) return { issues: [issue("indexed-drawing-index-unavailable", `${expected.path}: ${index.error}`, { path: expected.path })], paths: [], artifacts: [] };
  let records;
  try {
    records = parseCsvRecords(index.bytes).records;
  } catch (error) {
    return { issues: [issue("indexed-drawing-index-invalid", `${expected.path}: ${error instanceof Error ? error.message : "invalid CSV"}`, { path: expected.path })], paths: [], artifacts: [] };
  }
  if (records.length === 0) return { issues: [issue("indexed-drawing-index-empty", `${expected.path} must contain at least one drawing record`, { path: expected.path })], paths: [], artifacts: [] };

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
        issues.push(...indexedDrawingMetadataIssues(declared[0], relativePath, mediaType));
      }
      artifacts.push({ path: relativePath, mediaType, role: "drawing", requiredOutputRef: "OUT-006" });
      const file = await regularFile(root, relativePath);
      if (file.error) {
        issues.push(issue("indexed-drawing-file-missing", `${relativePath}: ${file.error}`, { path: relativePath }));
        continue;
      }
      if (mediaType === "application/pdf" && !pdfEnvelopeValid(file.bytes)) {
        issues.push(issue("indexed-drawing-pdf-invalid", `${relativePath} is not a recognizable PDF`, { path: relativePath }));
      } else if (mediaType === "model/step" && !stepEnvelopeValid(file.bytes)) {
        issues.push(issue("indexed-drawing-step-invalid", `${relativePath} is not a recognizable STEP exchange file`, { path: relativePath }));
      } else if (mediaType === "application/json") {
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

async function inspectIndexedCadSources({ root, expected, declaredByPath }) {
  const config = expected.indexedFileReferences;
  if (!config || config.kind !== "json-records") return { issues: [], paths: [], artifacts: [] };
  const manifest = await regularFile(root, expected.path);
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
    if (!relativePath.startsWith(`${config.pathRoot}/`) || !ensureInside(root, relativePath)) {
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
      issues.push(issue(
        declared.length === 0 ? "indexed-cad-source-artifact-missing" : "indexed-cad-source-artifact-duplicate",
        `${relativePath} must be declared exactly once as a CAD source artifact`,
        { path: relativePath },
      ));
    } else {
      issues.push(...indexedCadMetadataIssues(declared[0], relativePath, mediaType));
    }
    const file = await regularFile(root, relativePath);
    if (file.error) {
      issues.push(issue("indexed-cad-source-file-missing", `${relativePath}: ${file.error}`, { path: relativePath }));
      continue;
    }
    if (sha256(file.bytes) !== declaredHash) {
      issues.push(issue("indexed-cad-source-hash-mismatch", `${relativePath} does not match source-manifest SHA-256`, { path: relativePath }));
    }
    artifacts.push({ path: relativePath, mediaType, role: "cad-source", requiredOutputRef: "OUT-001" });
  }
  return { issues, paths, artifacts };
}

function conditionalChangeIssues(contract, highest, root, indexedPaths) {
  const policy = contract.conditionalChangeResponse;
  if (!policy || highest !== policy.triggerCheckpoint) return Promise.resolve([]);
  return (async () => {
    const impact = await regularFile(root, policy.impactArtifact);
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
  })();
}

function orderedCheckpointIds(contract) {
  return [
    "CKPT-000",
    ...(contract.candidateCheckpoints ?? []).map(({ id }) => id),
  ];
}

function sortedUnique(values) {
  return [...new Set(values)].sort();
}

function sameSortedStrings(left, right) {
  return JSON.stringify(sortedUnique(left)) === JSON.stringify(sortedUnique(right));
}

function plainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sha256Value(value) {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function hasOnlyKeys(value, keys) {
  return plainObject(value) && Object.keys(value).every((key) => keys.includes(key));
}

function dateTimeValue(value) {
  return typeof value === "string"
    && /^\d{4}-\d{2}-\d{2}[Tt]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})$/.test(value)
    && !Number.isNaN(Date.parse(value));
}

function checkpointReceiptDeclarationErrors(declaration) {
  const errors = [];
  const required = [
    "id",
    "sequence",
    "checkpointId",
    "path",
    "sha256",
    "previousReceiptSha256",
  ];
  const allowed = [...required, "changeEventId"];
  if (!plainObject(declaration)) return ["must be an object"];
  if (!hasOnlyKeys(declaration, allowed)) errors.push("has an unknown property");
  for (const field of required) {
    if (!Object.hasOwn(declaration, field)) errors.push(`is missing ${field}`);
  }
  if (!/^RCP-[0-9]{3,}$/.test(declaration.id ?? "")) errors.push("id must match RCP-<sequence>");
  if (!Number.isInteger(declaration.sequence) || declaration.sequence < 0) errors.push("sequence must be a non-negative integer");
  if (!/^CKPT-[0-9]{3,}$/.test(declaration.checkpointId ?? "")) errors.push("checkpointId must match CKPT-<sequence>");
  if (!safeRelative(declaration.path)) errors.push("path must be a safe relative path");
  if (!sha256Value(declaration.sha256)) errors.push("sha256 must be a lowercase SHA-256 digest");
  if (!sha256Value(declaration.previousReceiptSha256)) errors.push("previousReceiptSha256 must be a lowercase SHA-256 digest");
  if (declaration.checkpointId === "CKPT-050") {
    if (!Object.hasOwn(declaration, "changeEventId")) errors.push("CKPT-050 requires changeEventId");
    else if (!/^CHG-[0-9]{3,}$/.test(declaration.changeEventId ?? "")) errors.push("changeEventId must match CHG-<sequence>");
  } else if (Object.hasOwn(declaration, "changeEventId")) {
    errors.push("changeEventId is allowed only for CKPT-050");
  }
  return errors;
}

function checkpointReceiptRecordErrors(receipt) {
  const errors = [];
  const required = [
    "schemaVersion",
    "id",
    "sequence",
    "checkpointId",
    "previousReceiptSha256",
    "createdAt",
    "evidence",
    "artifactSnapshots",
  ];
  const allowed = [...required, "changeEventId", "outputContract"];
  if (!plainObject(receipt)) return ["must be an object"];
  if (!hasOnlyKeys(receipt, allowed)) errors.push("has an unknown property");
  for (const field of required) {
    if (!Object.hasOwn(receipt, field)) errors.push(`is missing ${field}`);
  }
  if (receipt.schemaVersion !== "1.1") errors.push("schemaVersion must be 1.1");
  if (!/^RCP-[0-9]{3,}$/.test(receipt.id ?? "")) errors.push("id must match RCP-<sequence>");
  if (!Number.isInteger(receipt.sequence) || receipt.sequence < 0) errors.push("sequence must be a non-negative integer");
  if (!/^CKPT-[0-9]{3,}$/.test(receipt.checkpointId ?? "")) errors.push("checkpointId must match CKPT-<sequence>");
  if (!sha256Value(receipt.previousReceiptSha256)) errors.push("previousReceiptSha256 must be a lowercase SHA-256 digest");
  if (!dateTimeValue(receipt.createdAt)) errors.push("createdAt must be an RFC 3339 date-time");
  if (receipt.checkpointId === "CKPT-050") {
    if (!Object.hasOwn(receipt, "changeEventId")) errors.push("CKPT-050 requires changeEventId");
    else if (!/^CHG-[0-9]{3,}$/.test(receipt.changeEventId ?? "")) errors.push("changeEventId must match CHG-<sequence>");
  } else if (Object.hasOwn(receipt, "changeEventId")) {
    errors.push("changeEventId is allowed only for CKPT-050");
  }
  if (receipt.checkpointId === "CKPT-000") {
    if (Object.hasOwn(receipt, "outputContract")) errors.push("CKPT-000 may not bind outputContract");
  } else if (!Object.hasOwn(receipt, "outputContract")) {
    errors.push("non-CKPT-000 receipts require outputContract");
  }
  if (!Array.isArray(receipt.evidence)) {
    errors.push("evidence must be an array");
  } else {
    for (const [index, evidence] of receipt.evidence.entries()) {
      if (!hasOnlyKeys(evidence, ["path", "sha256"]) || !Object.hasOwn(evidence, "path") || !Object.hasOwn(evidence, "sha256") || !safeRelative(evidence.path) || !sha256Value(evidence.sha256)) {
        errors.push(`evidence ${index} must contain only safe path and SHA-256`);
      }
    }
  }
  if (!Array.isArray(receipt.artifactSnapshots)) {
    errors.push("artifactSnapshots must be an array");
  } else {
    for (const [index, snapshot] of receipt.artifactSnapshots.entries()) {
      if (!hasOnlyKeys(snapshot, ["sourcePath", "snapshotPath", "sha256"]) || !Object.hasOwn(snapshot, "sourcePath") || !Object.hasOwn(snapshot, "snapshotPath") || !Object.hasOwn(snapshot, "sha256") || !safeRelative(snapshot.sourcePath) || !safeRelative(snapshot.snapshotPath) || !sha256Value(snapshot.sha256)) {
        errors.push(`artifactSnapshots ${index} must contain only safe paths and SHA-256`);
      }
    }
  }
  if (Object.hasOwn(receipt, "outputContract")) {
    const binding = receipt.outputContract;
    if (
      !hasOnlyKeys(binding, ["componentVersion", "sha256", "requiredArtefactPaths"])
      || !Object.hasOwn(binding ?? {}, "componentVersion")
      || !Object.hasOwn(binding ?? {}, "sha256")
      || !Object.hasOwn(binding ?? {}, "requiredArtefactPaths")
      || typeof binding?.componentVersion !== "string"
      || binding.componentVersion.length === 0
      || !sha256Value(binding.sha256)
      || !Array.isArray(binding.requiredArtefactPaths)
      || new Set(binding.requiredArtefactPaths ?? []).size !== (binding.requiredArtefactPaths ?? []).length
      || !(binding.requiredArtefactPaths ?? []).every(safeRelative)
    ) {
      errors.push("outputContract must contain only componentVersion, SHA-256, and unique safe requiredArtefactPaths");
    }
  }
  return errors;
}

async function receiptEvidenceIssues(root, receipt) {
  const issues = [];
  if (!Array.isArray(receipt?.evidence)) return issues;
  for (const evidence of receipt.evidence) {
    if (!plainObject(evidence) || !safeRelative(evidence.path) || !sha256Value(evidence.sha256)) continue;
    const file = await regularFile(root, evidence.path);
    if (file.error) {
      issues.push(issue("receipt-evidence-file-unavailable", `${receipt.id} ${evidence.path}: ${file.error}`, { path: evidence.path }));
    } else if (sha256(file.bytes) !== evidence.sha256) {
      issues.push(issue("receipt-evidence-hash-mismatch", `${receipt.id} evidence does not match ${evidence.path}`, { path: evidence.path }));
    }
  }
  return issues;
}

function snapshotPathFor(receipt, sourcePath) {
  return [
    "receipts",
    "snapshots",
    `${String(receipt.sequence).padStart(3, "0")}-${receipt.checkpointId}`,
    sourcePath,
  ].join("/");
}

function requiredArtefactsForCheckpoint(contract, checkpointId) {
  if (checkpointId === "CKPT-000") return [];
  const checkpoint = (contract.candidateCheckpoints ?? []).find(({ id }) => id === checkpointId);
  const knownPaths = new Set((contract.artefacts ?? []).map(({ path: artefactPath }) => artefactPath));
  if (!checkpoint || !Array.isArray(checkpoint.requiredArtefacts)) return null;
  const paths = sortedUnique(checkpoint.requiredArtefacts);
  return paths.every((artefactPath) => knownPaths.has(artefactPath)) ? paths : null;
}

async function snapshotBytes(root, snapshot) {
  const file = await regularFile(root, snapshot?.snapshotPath);
  if (file.error) return { error: file.error };
  if (sha256(file.bytes) !== snapshot.sha256) return { error: "snapshot hash mismatch" };
  return { bytes: file.bytes };
}

async function indexedReferencePathsFromSnapshots(
  root,
  contract,
  snapshots,
  artefactPaths,
) {
  const requested = new Set(artefactPaths);
  const paths = [];
  const errors = [];
  for (const artefact of contract.artefacts ?? []) {
    const config = artefact.indexedFileReferences;
    if (!requested.has(artefact.path) || !config) continue;
    const snapshot = snapshots.get(artefact.path);
    if (!snapshot) {
      errors.push(`missing snapshot for indexed artefact ${artefact.path}`);
      continue;
    }
    const file = await snapshotBytes(root, snapshot);
    if (file.error) {
      errors.push(`${artefact.path}: ${file.error}`);
      continue;
    }
    if (config.kind === "csv-row-paths") {
      try {
        for (const record of parseCsvRecords(file.bytes).records) {
          for (const [field, rule] of Object.entries(config)) {
            if (!rule || typeof rule !== "object" || !Object.hasOwn(rule, "required")) continue;
            const value = String(record[field] ?? "").trim();
            if (!value) {
              if (rule.required) errors.push(`${artefact.path} requires indexed ${field}`);
              continue;
            }
            if (!safeRelative(value) || !value.startsWith(`${config.pathRoot}/`)) {
              errors.push(`${artefact.path} contains unsafe indexed path ${value}`);
              continue;
            }
            paths.push(value);
            if (!snapshots.has(value)) {
              errors.push(`${artefact.path} referenced file is not snapshotted: ${value}`);
            }
          }
        }
      } catch (error) {
        errors.push(`${artefact.path} cannot be parsed: ${error instanceof Error ? error.message : "invalid CSV"}`);
      }
      continue;
    }
    if (config.kind === "json-records") {
      let manifest;
      try {
        manifest = JSON.parse(file.bytes.toString("utf8"));
      } catch {
        errors.push(`${artefact.path} is not valid JSON`);
        continue;
      }
      const records = manifest?.[config.recordsField];
      if (!Array.isArray(records) || records.length === 0) {
        errors.push(`${artefact.path} requires a non-empty ${config.recordsField}`);
        continue;
      }
      for (const [index, record] of records.entries()) {
        const value = String(record?.[config.pathField] ?? "").trim();
        const mediaType = String(record?.[config.mediaTypeField] ?? "").trim();
        const declaredSha256 = String(record?.[config.sha256Field] ?? "").trim().toLowerCase();
        if (!safeRelative(value) || !value.startsWith(`${config.pathRoot}/`)) {
          errors.push(`${artefact.path} record ${index + 1} contains unsafe indexed path ${value}`);
          continue;
        }
        if (!config.allowedMediaTypes?.includes(mediaType)) {
          errors.push(`${artefact.path} record ${index + 1} has unsupported media type ${mediaType}`);
        }
        if (!/^[a-f0-9]{64}$/.test(declaredSha256)) {
          errors.push(`${artefact.path} record ${index + 1} has invalid SHA-256`);
        }
        paths.push(value);
        const referenced = snapshots.get(value);
        if (!referenced) {
          errors.push(`${artefact.path} referenced file is not snapshotted: ${value}`);
        } else if (referenced.sha256 !== declaredSha256) {
          errors.push(`${artefact.path} manifest SHA-256 does not match snapshot ${value}`);
        }
      }
      continue;
    }
    errors.push(`${artefact.path} has unsupported indexed reference kind ${config.kind}`);
  }
  return { paths: sortedUnique(paths), errors };
}

async function receiptSnapshotIssues({ root, receipt, contract, contractSha256 }) {
  const issues = [];
  const requiredArtefacts = requiredArtefactsForCheckpoint(contract, receipt.checkpointId);
  if (requiredArtefacts === null) {
    return [issue("receipt-output-contract-checkpoint", `output contract does not declare valid requiredArtefacts for ${receipt.checkpointId}`)];
  }
  if (receipt.schemaVersion !== "1.1" || !Array.isArray(receipt.artifactSnapshots)) {
    return [issue("receipt-snapshot-schema", `${receipt.id} must use schema 1.1 with artifactSnapshots`)];
  }
  const sourcePaths = [];
  const snapshots = new Map();
  const snapshotPaths = new Set();
  for (const snapshot of receipt.artifactSnapshots) {
    if (
      !safeRelative(snapshot?.sourcePath)
      || snapshot.sourcePath.startsWith("receipts/")
      || !safeRelative(snapshot?.snapshotPath)
      || !/^[a-f0-9]{64}$/.test(snapshot?.sha256 ?? "")
    ) {
      issues.push(issue("receipt-snapshot-invalid", `${receipt.id} has an invalid snapshot declaration`));
      continue;
    }
    sourcePaths.push(snapshot.sourcePath);
    if (snapshots.has(snapshot.sourcePath) || snapshotPaths.has(snapshot.snapshotPath)) {
      issues.push(issue("receipt-snapshot-duplicate", `${receipt.id} duplicates a source or snapshot path`));
    }
    snapshots.set(snapshot.sourcePath, snapshot);
    snapshotPaths.add(snapshot.snapshotPath);
    if (snapshot.snapshotPath !== snapshotPathFor(receipt, snapshot.sourcePath)) {
      issues.push(issue("receipt-snapshot-path", `${receipt.id} snapshot path is not deterministic for ${snapshot.sourcePath}`));
    }
    const file = await snapshotBytes(root, snapshot);
    if (file.error) issues.push(issue("receipt-snapshot-bytes", `${receipt.id} ${snapshot.snapshotPath}: ${file.error}`));
  }
  if (receipt.checkpointId === "CKPT-000") {
    if (sourcePaths.length || receipt.outputContract) issues.push(issue("receipt-ckpt000-snapshots", "CKPT-000 must not bind engineering artefact snapshots or an output contract"));
    const evidence = new Map((Array.isArray(receipt.evidence) ? receipt.evidence : []).map((entry) => [entry.path, entry.sha256]));
    const [plan, initial] = await Promise.all([
      regularFile(root, "plan.json"),
      regularFile(root, "initial-plan.sha256"),
    ]);
    if (plan.error || evidence.get("plan.json") !== sha256(plan.bytes ?? Buffer.alloc(0))) issues.push(issue("receipt-ckpt000-plan", "CKPT-000 must bind plan.json"));
    if (initial.error || evidence.get("initial-plan.sha256") !== sha256(initial.bytes ?? Buffer.alloc(0))) issues.push(issue("receipt-ckpt000-initial", "CKPT-000 must bind initial-plan.sha256"));
    return issues;
  }
  const binding = receipt.outputContract;
  if (
    !binding
    || binding.sha256 !== contractSha256
    || binding.componentVersion !== contract.version
    || !sameSortedStrings(binding.requiredArtefactPaths ?? [], requiredArtefacts)
  ) {
    issues.push(issue("receipt-output-contract-binding", `${receipt.id} does not bind the hash, component version, and requiredArtefacts of this output contract`));
  }
  const expectedSnapshots = new Set(requiredArtefacts);
  const requiredIndexed = await indexedReferencePathsFromSnapshots(
    root,
    contract,
    snapshots,
    requiredArtefacts,
  );
  for (const error of requiredIndexed.errors) {
    issues.push(issue("receipt-indexed-snapshot", `${receipt.id} ${error}`));
  }
  for (const indexedPath of requiredIndexed.paths) expectedSnapshots.add(indexedPath);
  if (receipt.checkpointId === "CKPT-050") {
    if (
      typeof contract.conditionalChangeResponse?.changeEventId !== "string"
      || receipt.changeEventId !== contract.conditionalChangeResponse.changeEventId
    ) {
      issues.push(issue(
        "receipt-change-event-mismatch",
        "CKPT-050 must bind the exact output-contract changeEventId",
      ));
    }
    const impactPath = contract.conditionalChangeResponse?.impactArtifact;
    const impactSnapshot = snapshots.get(impactPath);
    if (!impactSnapshot) {
      issues.push(issue("receipt-change-impact-snapshot", "CKPT-050 must snapshot its change-impact artifact"));
    } else {
      const file = await snapshotBytes(root, impactSnapshot);
      let impact = null;
      try { impact = JSON.parse(file.bytes.toString("utf8")); } catch { /* reported below */ }
      if (impact?.changeEventId !== contract.conditionalChangeResponse?.changeEventId) {
        issues.push(issue(
          "receipt-change-impact-event-mismatch",
          "CKPT-050 change-impact snapshot must bind the exact output-contract changeEventId",
        ));
      }
      if (!Array.isArray(impact?.affectedOutputRefs) || !Array.isArray(impact?.revisedArtifactPaths)) {
        issues.push(issue("receipt-change-impact-invalid", "CKPT-050 change-impact snapshot requires affectedOutputRefs and revisedArtifactPaths"));
      } else {
        for (const revisedPath of impact.revisedArtifactPaths) {
          if (!safeRelative(revisedPath) || revisedPath.startsWith("receipts/")) issues.push(issue("receipt-change-reissue-path", `CKPT-050 declares unsafe revised artifact ${revisedPath}`));
          else expectedSnapshots.add(revisedPath);
        }
        for (const outputRef of contract.conditionalChangeResponse?.affectedOutputRefs ?? []) {
          if (!impact.affectedOutputRefs.includes(outputRef)) continue;
          const required = (contract.artefacts ?? [])
            .filter((artefact) => artefact.requiredOutputRef === outputRef)
            .map((artefact) => artefact.path);
          const indexed = await indexedReferencePathsFromSnapshots(
            root,
            contract,
            snapshots,
            required,
          );
          for (const error of indexed.errors) {
            issues.push(issue("receipt-change-indexed-files", error));
          }
          required.push(...indexed.paths);
          for (const requiredPath of sortedUnique(required)) {
            if (!impact.revisedArtifactPaths.includes(requiredPath)) issues.push(issue("receipt-change-reissue-missing", `${outputRef} is affected but ${requiredPath} is absent from revisedArtifactPaths`, { path: requiredPath }));
            expectedSnapshots.add(requiredPath);
          }
        }
        const revisedIndexed = await indexedReferencePathsFromSnapshots(
          root,
          contract,
          snapshots,
          impact.revisedArtifactPaths,
        );
        for (const error of revisedIndexed.errors) {
          issues.push(issue("receipt-change-indexed-files", error));
        }
        for (const indexedPath of revisedIndexed.paths) {
          if (!impact.revisedArtifactPaths.includes(indexedPath)) {
            issues.push(issue(
              "receipt-change-reissue-missing",
              `indexed reissue ${indexedPath} is absent from revisedArtifactPaths`,
              { path: indexedPath },
            ));
          }
          expectedSnapshots.add(indexedPath);
        }
      }
    }
  } else if (receipt.changeEventId !== undefined) {
    issues.push(issue(
      "receipt-change-event-unexpected",
      `${receipt.id} may not declare changeEventId outside CKPT-050`,
    ));
  }
  if (!sameSortedStrings(sourcePaths, [...expectedSnapshots])) {
    issues.push(issue("receipt-snapshot-coverage", `${receipt.id} must snapshot exactly all required and declared reissued artefact paths`));
  }
  return issues;
}

async function validateDeclaredAttainment({ root, submission, highest, contract, contractSha256 }) {
  const issues = [];
  const checkpointIds = orderedCheckpointIds(contract);
  const checkpointIndex = new Map(checkpointIds.map((id, index) => [id, index]));
  const attainment = submission?.partialAttainment ?? {};
  const completed = attainment.completedCheckpointIds;
  const receipts = submission?.checkpointReceipts;

  if (!Array.isArray(completed)) {
    return [issue(
      "submission-completed-checkpoints-invalid",
      "submission partialAttainment must declare completedCheckpointIds",
      { path: "partialAttainment.completedCheckpointIds" },
    )];
  }
  if (!Array.isArray(receipts)) {
    return [issue(
      "submission-receipts-invalid",
      "submission must declare checkpointReceipts",
      { path: "checkpointReceipts" },
    )];
  }

  const completedSet = new Set(completed);
  if (completedSet.size !== completed.length) {
    issues.push(issue(
      "submission-completed-checkpoints-duplicate",
      "submission completedCheckpointIds must not repeat a checkpoint",
      { path: "partialAttainment.completedCheckpointIds" },
    ));
  }
  for (const checkpointId of completed) {
    if (!checkpointIndex.has(checkpointId)) {
      issues.push(issue(
        "submission-completed-checkpoint-unknown",
        `submission completed checkpoint is not declared by this contract: ${checkpointId}`,
        { path: "partialAttainment.completedCheckpointIds" },
      ));
    }
  }

  const highestIndex = checkpointIndex.get(highest);
  const expectedCompleted = highestIndex === undefined
    ? []
    : checkpointIds.slice(0, highestIndex + 1);
  const completedPrefix = new Set(expectedCompleted);
  for (const checkpointId of expectedCompleted.filter((id) => id !== "CKPT-000")) {
    const checkpoint = (contract.candidateCheckpoints ?? []).find(({ id }) => id === checkpointId);
    if (!Array.isArray(checkpoint?.requiresPriorCheckpointIds)) {
      issues.push(issue(
        "output-contract-checkpoint-prerequisites-invalid",
        `output contract must declare requiresPriorCheckpointIds for ${checkpointId}`,
      ));
      continue;
    }
    for (const prerequisite of checkpoint.requiresPriorCheckpointIds) {
      if (!completedPrefix.has(prerequisite) || prerequisite === checkpointId) {
        issues.push(issue(
          "submission-receipt-prerequisite-missing",
          `${checkpointId} prerequisite ${prerequisite} is not an earlier completed checkpoint`,
        ));
      }
    }
  }
  if (JSON.stringify(completed) !== JSON.stringify(expectedCompleted)) {
    issues.push(issue(
      "submission-completed-checkpoints-mismatch",
      "--highest must exactly equal the contiguous completed checkpoint prefix declared in submission.json",
      { path: "partialAttainment.completedCheckpointIds" },
    ));
  }
  if (attainment.highestVerifiedCheckpointId !== highest) {
    issues.push(issue(
      "submission-highest-checkpoint-mismatch",
      "submission highest checkpoint must match --highest",
      { path: "partialAttainment.highestVerifiedCheckpointId" },
    ));
  }

  const receiptCheckpointIds = receipts.map((declaration) => declaration?.checkpointId);
  if (JSON.stringify(receiptCheckpointIds) !== JSON.stringify(expectedCompleted)) {
    issues.push(issue(
      "submission-receipt-checkpoints-mismatch",
      "checkpointReceipts must exactly cover the completed checkpoint prefix in receipt order",
      { path: "checkpointReceipts" },
    ));
  }
  let previousReceiptSha256 = "0".repeat(64);
  const latestCompletedSnapshotByPath = new Map();
  for (const [sequence, declaration] of receipts.entries()) {
    for (const error of checkpointReceiptDeclarationErrors(declaration)) {
      issues.push(issue(
        "submission-receipt-declaration-schema",
        `checkpointReceipts[${sequence}] ${error}`,
        { path: "checkpointReceipts" },
      ));
    }
    if (declaration?.sequence !== sequence) {
      issues.push(issue(
        "submission-receipt-sequence-mismatch",
        `receipt declaration ${sequence} must use sequence ${sequence}`,
        { path: "checkpointReceipts" },
      ));
    }
    if (declaration?.checkpointId !== expectedCompleted[sequence]) {
      issues.push(issue(
        "submission-receipt-checkpoint-mismatch",
        `receipt declaration ${sequence} must bind ${expectedCompleted[sequence] ?? "a completed checkpoint"}`,
        { path: "checkpointReceipts" },
      ));
    }
    if (!plainObject(declaration) || !safeRelative(declaration.path)) continue;
    if (declaration.id !== `RCP-${String(sequence).padStart(3, "0")}`) {
      issues.push(issue(
        "submission-receipt-id-mismatch",
        `receipt declaration ${sequence} must use id RCP-${String(sequence).padStart(3, "0")}`,
        { path: "checkpointReceipts" },
      ));
    }
    if (declaration.previousReceiptSha256 !== previousReceiptSha256) {
      issues.push(issue(
        "submission-receipt-declaration-chain-mismatch",
        `${declaration.path} declaration does not bind the prior receipt digest`,
        { path: declaration.path },
      ));
    }
    const receiptFile = await regularFile(root, declaration.path);
    if (receiptFile.error) {
      issues.push(issue(
        "submission-receipt-file-unavailable",
        `${declaration.path}: ${receiptFile.error}`,
        { path: declaration.path },
      ));
      continue;
    }
    if (sha256(receiptFile.bytes) !== declaration.sha256) {
      issues.push(issue(
        "submission-receipt-hash-mismatch",
        `${declaration.path} does not match its declared SHA-256`,
        { path: declaration.path },
      ));
    }
    const receiptDigest = sha256(receiptFile.bytes);
    try {
      const receipt = JSON.parse(receiptFile.bytes.toString("utf8"));
      for (const error of checkpointReceiptRecordErrors(receipt)) {
        issues.push(issue(
          "submission-receipt-record-schema",
          `${declaration.path} ${error}`,
          { path: declaration.path },
        ));
      }
      for (const field of [
        "id",
        "sequence",
        "checkpointId",
        "previousReceiptSha256",
        "changeEventId",
      ]) {
        if (receipt?.[field] === declaration[field]) continue;
        issues.push(issue(
          "submission-receipt-content-mismatch",
          `${declaration.path} does not match the declared checkpoint receipt ${field}`,
          { path: declaration.path },
        ));
      }
      if (receipt.previousReceiptSha256 !== previousReceiptSha256) {
        issues.push(issue(
          "submission-receipt-chain-mismatch",
          `${declaration.path} does not bind the prior receipt digest`,
          { path: declaration.path },
        ));
      }
      issues.push(...await receiptEvidenceIssues(root, receipt));
      const expectedChangeEventId = contract.conditionalChangeResponse?.changeEventId;
      if (receipt.checkpointId === "CKPT-050") {
        if (
          typeof expectedChangeEventId !== "string"
          || declaration.changeEventId !== expectedChangeEventId
          || receipt.changeEventId !== expectedChangeEventId
        ) {
          issues.push(issue(
            "submission-receipt-change-event-mismatch",
            `${declaration.path} must bind the exact CKPT-050 output-contract changeEventId`,
            { path: declaration.path },
          ));
        }
      } else if (declaration.changeEventId !== undefined || receipt.changeEventId !== undefined) {
        issues.push(issue(
          "submission-receipt-change-event-unexpected",
          `${declaration.path} may not declare changeEventId outside CKPT-050`,
          { path: declaration.path },
        ));
      }
      issues.push(...await receiptSnapshotIssues({
        root,
        receipt,
        contract,
        contractSha256,
      }));
      if (completedSet.has(receipt.checkpointId) && Array.isArray(receipt.artifactSnapshots)) {
        for (const snapshot of receipt.artifactSnapshots) {
          if (
            safeRelative(snapshot?.sourcePath)
            && !snapshot.sourcePath.startsWith("receipts/")
            && /^[a-f0-9]{64}$/.test(snapshot?.sha256 ?? "")
          ) {
            latestCompletedSnapshotByPath.set(snapshot.sourcePath, {
              sha256: snapshot.sha256,
              checkpointId: receipt.checkpointId,
              sequence,
            });
          }
        }
      }
    } catch {
      issues.push(issue(
        "submission-receipt-invalid-json",
        `${declaration.path} is not valid JSON`,
        { path: declaration.path },
      ));
    }
    previousReceiptSha256 = receiptDigest;
  }
  for (const artifact of submission.artifacts ?? []) {
    const latestSnapshot = latestCompletedSnapshotByPath.get(artifact?.path);
    if (!latestSnapshot) {
      issues.push(issue(
        "submission-artifact-snapshot-missing",
        `${artifact?.path ?? "submission artifact"} has no completed checkpoint receipt snapshot`,
        { path: artifact?.path },
      ));
      continue;
    }
    const current = await regularFile(root, artifact.path);
    if (current.error) continue;
    const currentSha256 = sha256(current.bytes);
    if (
      currentSha256 !== latestSnapshot.sha256
      || (
        typeof artifact.sha256 === "string"
        && artifact.sha256 !== latestSnapshot.sha256
      )
    ) {
      issues.push(issue(
        "submission-artifact-current-snapshot-mismatch",
        `${artifact.path} does not match its latest completed receipt snapshot`,
        {
          path: artifact.path,
          checkpointId: latestSnapshot.checkpointId,
        },
      ));
    }
  }
  return issues;
}

function lateDeclaredArtifactIssues({ contract, declaredByPath, highestIndex }) {
  const issues = [];
  for (const expected of contract.artefacts ?? []) {
    const requiredAt = checkpointForArtifact(contract, expected.path);
    if (!requiredAt || requiredAt.index <= highestIndex) continue;
    if ((declaredByPath.get(expected.path) ?? []).length > 0) {
      issues.push(issue(
        "artifact-declared-after-attainment",
        `${expected.path} belongs to later checkpoint ${requiredAt.id} and cannot be declared before it is attained`,
        { path: expected.path, requiredAtCheckpointId: requiredAt.id },
      ));
    }
  }
  return issues;
}

async function main() {
  const root = path.resolve(arg("--root", true));
  const highest = arg("--highest", true);
  const contractPath = arg("--contract");
  const contractUrl = arg("--contract-url");
  if (contractPath && contractUrl) throw new Error("Use either --contract or --contract-url, not both");
  if (!contractPath && !contractUrl) throw new Error("Use --contract <path> or --contract-url <https-url>");

  let contractBytes;
  if (contractPath) {
    contractBytes = await readFile(path.resolve(contractPath));
  } else {
    const response = await fetch(contractUrl, { redirect: "error" });
    if (!response.ok) throw new Error(`Cannot download output contract: ${response.status}`);
    contractBytes = Buffer.from(await response.arrayBuffer());
  }
  const expectedDigest = arg("--contract-sha256").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expectedDigest)) {
    throw new Error("--contract-sha256 must be the launch-bound lowercase SHA-256 digest");
  }
  if (sha256(contractBytes) !== expectedDigest) throw new Error("Output-contract SHA-256 mismatch");

  let contract;
  try {
    contract = JSON.parse(contractBytes.toString("utf8"));
    if (!Array.isArray(contract.artefacts) || !Array.isArray(contract.candidateCheckpoints)) {
      throw new Error("artefacts and candidateCheckpoints arrays are required");
    }
  } catch (error) {
    throw new Error(`Output contract is invalid: ${error instanceof Error ? error.message : "invalid JSON"}`);
  }

  const checkpointIndex = new Map(
    contract.candidateCheckpoints.map((checkpoint, index) => [checkpoint.id, index]),
  );
  const highestIndex = highest === "CKPT-000" ? -1 : checkpointIndex.get(highest);
  if (highestIndex === undefined) throw new Error(`Unknown highest checkpoint: ${highest}`);

  const admissionIssues = [];
  const submissionPath = arg("--submission") || "submission.json";
  const submissionFile = await regularFile(root, submissionPath);
  let submission = {};
  if (submissionFile.error) {
    admissionIssues.push(issue("submission-unavailable", `${submissionPath}: ${submissionFile.error}`, { path: submissionPath }));
  } else {
    try {
      submission = JSON.parse(submissionFile.bytes.toString("utf8"));
    } catch {
      admissionIssues.push(issue("submission-invalid-json", `${submissionPath} is not valid JSON`, { path: submissionPath }));
    }
  }
  if (!Array.isArray(submission.artifacts)) {
    admissionIssues.push(issue("submission-artifacts-invalid", `${submissionPath} must contain an artifacts array`, { path: submissionPath }));
    submission.artifacts = [];
  }
  admissionIssues.push(...await validateDeclaredAttainment({
    root,
    submission,
    highest,
    contract,
    contractSha256: expectedDigest,
  }));

  const declaredByPath = new Map();
  for (const artifact of submission.artifacts) {
    const entries = declaredByPath.get(artifact?.path) ?? [];
    entries.push(artifact ?? {});
    declaredByPath.set(artifact?.path, entries);
  }
  admissionIssues.push(...lateDeclaredArtifactIssues({
    contract,
    declaredByPath,
    highestIndex,
  }));

  const deferred = [];
  const inspected = [];
  const indexedPaths = [];
  const indexedArtifacts = [];
  let due = 0;
  let satisfied = 0;
  for (const expected of contract.artefacts) {
    const requiredAt = checkpointForArtifact(contract, expected.path);
    if (!requiredAt) {
      admissionIssues.push(issue("artifact-contract-checkpoint-missing", `${expected.path} is not assigned to a frozen contract checkpoint`, { path: expected.path }));
      continue;
    }
    const isDue = requiredAt.index <= highestIndex;
    const declared = declaredByPath.get(expected.path) ?? [];
    if (!isDue && declared.length === 0) {
      deferred.push({ id: expected.id, path: expected.path, requiredAtCheckpointId: requiredAt.id, reason: "not-required-before-highest-verified-checkpoint" });
      continue;
    }
    if (isDue) due += 1;
    if (declared.length === 0) {
      if (isDue) {
        admissionIssues.push(issue("artifact-required-by-attainment-missing", `${expected.path} is required by attained checkpoint ${requiredAt.id}`, { path: expected.path, requiredAtCheckpointId: requiredAt.id }));
      } else {
        deferred.push({ id: expected.id, path: expected.path, requiredAtCheckpointId: requiredAt.id, reason: "declared-later-artifact-missing" });
      }
      continue;
    }
    if (declared.length > 1) {
      admissionIssues.push(issue("artifact-contract-duplicate-path", `${expected.path} is declared more than once`, { path: expected.path }));
      continue;
    }
    const drawingIndex = await inspectIndexedDrawings({ root, expected, declaredByPath });
    const sourceIndex = await inspectIndexedCadSources({ root, expected, declaredByPath });
    indexedPaths.push(...drawingIndex.paths);
    indexedArtifacts.push(...drawingIndex.artifacts, ...sourceIndex.artifacts);
    const allIssues = [
      ...expectedMetadataIssues(expected, declared[0]),
      ...await inspectArtifact(root, expected),
      ...drawingIndex.issues,
      ...sourceIndex.issues,
    ];
    if (allIssues.length > 0) admissionIssues.push(...allIssues);
    else {
      inspected.push(expected.path);
      if (isDue) satisfied += 1;
    }
  }

  admissionIssues.push(...await conditionalChangeIssues(contract, highest, root, indexedPaths));
  const result = {
    status: admissionIssues.length === 0 ? "valid" : "invalid",
    highestVerifiedCheckpointId: highest,
    admissionIssues,
    // Retained for callers of the original bootstrap preflight interface.
    issues: admissionIssues,
    deferred,
    indexedArtifacts: [...new Map(indexedArtifacts.map((artifact) => [artifact.path, artifact])).values()]
      .sort((left, right) => left.path.localeCompare(right.path)),
    coverage: {
      highestVerifiedCheckpointId: highest,
      dueArtifactCount: due,
      satisfiedArtifactCount: satisfied,
      ratio: due === 0 ? 1 : satisfied / due,
      inspectedPaths: inspected.sort(),
      deferredArtifactCount: deferred.length,
    },
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (admissionIssues.length) process.exitCode = 1;
}

await main();
