import { execFile } from "node:child_process";
import { lstat, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { canonicalJson, sha256 } from "./framework-lib.mjs";

const execFileAsync = promisify(execFile);
const STEP_WORKER_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "review-evidence-step-worker.mjs");
const MAX_RENDER_TRIANGLES = 2_000;
const workerLimits = Object.freeze({
  timeoutMs: 60_000,
  maxOldSpaceMb: 512,
  maxParts: 256,
  maxVertices: 100_000,
  maxTriangles: 200_000,
  maxOutputBytes: 12_582_912,
});
const TOOL = Object.freeze({
  name: "rotorbench-neutral-review-evidence",
  version: "1.0",
  engine: "occt-import-js@0.0.23",
  isolation: "separate-node-worker",
});

function canonicalBytes(value) {
  return Buffer.from(`${canonicalJson(value)}\n`);
}

function withPayloadHash(value) {
  return { ...value, outputPayloadSha256: sha256(canonicalBytes(value)) };
}

function toolBinding(executionContractDigest) {
  if (!/^[a-f0-9]{64}$/.test(executionContractDigest ?? "")) {
    throw new Error("Neutral review evidence requires the frozen execution-contract digest");
  }
  return { ...TOOL, executionContractDigest };
}

function decodedUtf8(bytes) {
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, "");
}

function parseCsvRows(bytes) {
  const source = decodedUtf8(bytes);
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
  if (quoted) throw new Error("unterminated quoted field");
  if (value.length > 0 || fields.length > 0) {
    fields.push(value.trim());
    rows.push(fields);
  }
  if (rows.length === 0 || rows[0].length === 0) throw new Error("header missing");
  return rows;
}

function fixedCsv(headers, row) {
  const escape = (value) => `"${String(value).replaceAll('"', '""')}"`;
  return Buffer.from(`${headers.map(escape).join(",")}\n${row.map(escape).join(",")}\n`);
}

function contractArtefact(outputContract, pathName) {
  return (outputContract?.artefacts ?? []).find((entry) => entry.path === pathName) ?? null;
}

function findSource(artifacts, pathName) {
  return artifacts.find((entry) => entry.path === pathName) ?? null;
}

function csvStatus({ source, readArtifact, requiredHeaders }) {
  if (!source) return { status: "not-present", reason: "artifact-not-admitted", metrics: {} };
  if (source.mediaType !== "text/csv") {
    return { status: "evaluator-unsupported", reason: "allowlisted-csv-media-type-required", metrics: {} };
  }
  try {
    const [header, ...rows] = parseCsvRows(readArtifact(source));
    const headerSet = new Set(header);
    const missingHeaders = requiredHeaders.filter((field) => !headerSet.has(field));
    const records = rows.filter((row) => row.some((field) => field.length > 0));
    const completeRows = records.filter((row) => requiredHeaders.every((field) => {
      const index = header.indexOf(field);
      return index >= 0 && (row[index] ?? "").length > 0;
    }));
    return {
      status: missingHeaders.length === 0 ? "processed" : "evaluator-unsupported",
      ...(missingHeaders.length === 0 ? {} : { reason: "required-header-missing" }),
      metrics: {
        recordCount: records.length,
        completeRequiredFieldRecordCount: completeRows.length,
        missingRequiredHeaderCount: missingHeaders.length,
      },
      header,
      records,
    };
  } catch {
    return { status: "evaluator-unsupported", reason: "csv-parse-failed", metrics: {} };
  }
}

function sheetJson({ kind, source, sourceEvidenceId, status, reason, metrics, tool, extra = {} }) {
  return withPayloadHash({
    schemaVersion: "1.0",
    kind,
    status,
    ...(reason ? { reason } : {}),
    source: source
      ? { evidenceId: sourceEvidenceId, inputSha256: source.inputSha256, mediaType: source.mediaType }
      : null,
    ...metrics,
    ...extra,
    tool,
  });
}

function sourceArtifactArtifacts(reportArtifacts, evidenceIds) {
  return reportArtifacts
    .map((artifact) => {
      if (!Buffer.isBuffer(artifact?.bytes)) {
        throw new Error("Admitted review artifact does not contain verified bytes");
      }
      const inputSha256 = sha256(artifact.bytes);
      if (inputSha256 !== artifact.outputSha256) {
        throw new Error("Admitted review artifact bytes no longer match the sanitized digest");
      }
      return {
        ...artifact,
        inputSha256,
        evidenceId: evidenceIds.get(artifact.id) ?? null,
      };
    })
    .filter(({ evidenceId }) => evidenceId !== null);
}

function normalizedBom(outputContract, artifacts, readArtifact, tool) {
  const definition = contractArtefact(outputContract, "artifacts/bom/bom.csv");
  const source = findSource(artifacts, definition?.path);
  const result = csvStatus({ source, readArtifact, requiredHeaders: definition?.requiredFields ?? [] });
  const metrics = { ...result.metrics };
  if (result.records && result.header) {
    const quantityIndex = result.header.indexOf("quantity");
    metrics.positiveQuantityRecordCount = quantityIndex < 0 ? 0 : result.records.filter((row) => Number(row[quantityIndex]) > 0).length;
  }
  return sheetJson({ kind: "normalized-bom", source, sourceEvidenceId: source?.evidenceId, ...result, metrics, tool });
}

function normalizedRequirementsTrace(outputContract, requirements, artifacts, readArtifact, tool) {
  const definition = contractArtefact(outputContract, "artifacts/design/requirements-trace.csv");
  const source = findSource(artifacts, definition?.path);
  const result = csvStatus({ source, readArtifact, requiredHeaders: definition?.requiredFields ?? [] });
  const requirementIds = new Set((requirements?.requirements ?? []).map(({ id }) => id).filter((id) => typeof id === "string"));
  const metrics = { ...result.metrics, publishedRequirementCount: requirementIds.size };
  if (result.records && result.header) {
    const requirementIdIndex = result.header.indexOf("requirementId");
    const evidencePathIndex = result.header.indexOf("evidencePath");
    const referenced = new Set();
    let knownRequirementReferenceCount = 0;
    let boundEvidencePathCount = 0;
    for (const row of result.records) {
      const requirementId = requirementIdIndex >= 0 ? row[requirementIdIndex] ?? "" : "";
      if (requirementIds.has(requirementId)) {
        referenced.add(requirementId);
        knownRequirementReferenceCount += 1;
      }
      const evidencePath = evidencePathIndex >= 0 ? row[evidencePathIndex] ?? "" : "";
      if (artifacts.some((artifact) => artifact.path === evidencePath)) boundEvidencePathCount += 1;
    }
    metrics.knownRequirementReferenceCount = knownRequirementReferenceCount;
    metrics.uniqueKnownRequirementCount = referenced.size;
    metrics.uncoveredPublishedRequirementCount = Math.max(0, requirementIds.size - referenced.size);
    metrics.boundEvidencePathCount = boundEvidencePathCount;
  }
  return sheetJson({ kind: "normalized-requirements-trace", source, sourceEvidenceId: source?.evidenceId, ...result, metrics, tool });
}

function normalizedDrawingIndex(outputContract, artifacts, readArtifact, tool) {
  const definition = contractArtefact(outputContract, "artifacts/drawings/critical-drawing-index.csv");
  const source = findSource(artifacts, definition?.path);
  const result = csvStatus({ source, readArtifact, requiredHeaders: definition?.requiredFields ?? [] });
  const metrics = { ...result.metrics };
  if (result.records && result.header) {
    const drawingPathIndex = result.header.indexOf("drawingPath");
    const pmiPathIndex = result.header.indexOf("pmiPath");
    const drawingIdIndex = result.header.indexOf("drawingId");
    const drawingIds = new Set();
    let boundDrawingPathCount = 0;
    let boundPmiPathCount = 0;
    for (const row of result.records) {
      if (drawingIdIndex >= 0 && (row[drawingIdIndex] ?? "").length > 0) drawingIds.add(row[drawingIdIndex]);
      const drawingPath = drawingPathIndex >= 0 ? row[drawingPathIndex] ?? "" : "";
      const pmiPath = pmiPathIndex >= 0 ? row[pmiPathIndex] ?? "" : "";
      if (artifacts.some((artifact) => artifact.path === drawingPath && artifact.role === "drawing")) boundDrawingPathCount += 1;
      if (pmiPath.length > 0 && artifacts.some((artifact) => artifact.path === pmiPath && artifact.role === "drawing")) boundPmiPathCount += 1;
    }
    metrics.uniqueDrawingIdCount = drawingIds.size;
    metrics.boundDrawingPathCount = boundDrawingPathCount;
    metrics.boundPmiPathCount = boundPmiPathCount;
  }
  return sheetJson({ kind: "normalized-drawing-index", source, sourceEvidenceId: source?.evidenceId, ...result, metrics, tool });
}

function project(bounds, point, direction) {
  const axes = direction === "x" ? [1, 2] : direction === "y" ? [0, 2] : [0, 1];
  const mins = [bounds.min.x, bounds.min.y, bounds.min.z];
  const maxs = [bounds.max.x, bounds.max.y, bounds.max.z];
  const span = Math.max(maxs[axes[0]] - mins[axes[0]], maxs[axes[1]] - mins[axes[1]], 1e-9);
  const x = 30 + ((point[axes[0]] - mins[axes[0]]) / span) * 740;
  const y = 770 - ((point[axes[1]] - mins[axes[1]]) / span) * 740;
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}

function neutralSvg(geometry, direction) {
  const triangles = [];
  for (const part of geometry.parts) {
    for (let index = 0; index < part.indices.length; index += 3) {
      triangles.push([
        part.indices[index] * 3,
        part.indices[index + 1] * 3,
        part.indices[index + 2] * 3,
      ].map((offset) => part.positions.slice(offset, offset + 3)));
    }
  }
  const stride = Math.max(1, Math.ceil(triangles.length / MAX_RENDER_TRIANGLES));
  const polygons = triangles
    .filter((_, index) => index % stride === 0)
    .map((triangle) => `<polygon points="${triangle.map((point) => project(geometry.bounds, point, direction)).join(" ")}"/>`)
    .join("");
  return Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="800" height="800" viewBox="0 0 800 800"><rect width="800" height="800" fill="#ffffff"/><g fill="#d9e2e7" fill-opacity="0.62" stroke="#1d303b" stroke-width="0.35">${polygons}</g></svg>\n`);
}

function hasFiniteBounds(bounds) {
  return bounds
    && typeof bounds === "object"
    && ["min", "max"].every((limit) => (
      bounds[limit]
      && typeof bounds[limit] === "object"
      && ["x", "y", "z"].every((axis) => Number.isFinite(bounds[limit][axis]))
    ));
}

/**
 * Parse only a resource-bounded mesh emitted by the isolated STEP worker.
 * The byte check must occur before UTF-8 decoding or JSON.parse because the
 * worker output is an untrusted inter-process boundary.
 */
export function parseBoundedStepWorkerOutput(bytes, expectedInputSha256 = null) {
  if (!bytes || bytes.length > workerLimits.maxOutputBytes) {
    throw new Error(`STEP worker output exceeds limit of ${workerLimits.maxOutputBytes} bytes`);
  }
  const mesh = JSON.parse(decodedUtf8(bytes));
  const geometry = mesh?.geometry;
  if (
    expectedInputSha256 !== null
    && (
      !/^[a-f0-9]{64}$/.test(expectedInputSha256)
      || mesh?.inputSha256 !== expectedInputSha256
    )
  ) {
    throw new Error("STEP worker did not confirm the evaluator-owned input SHA-256");
  }
  if (
    mesh?.schemaVersion !== "1.0"
    || !geometry
    || !Array.isArray(geometry.parts)
    || geometry.parts.length === 0
    || geometry.parts.length > workerLimits.maxParts
    || !Number.isSafeInteger(geometry.partCount)
    || geometry.partCount !== geometry.parts.length
    || !hasFiniteBounds(geometry.bounds)
  ) {
    throw new Error("STEP worker returned invalid geometry metadata");
  }
  let vertexCount = 0;
  let triangleCount = 0;
  for (const part of geometry.parts) {
    if (
      !part
      || typeof part !== "object"
      || !Array.isArray(part.positions)
      || !Array.isArray(part.indices)
      || part.positions.length < 3
      || part.positions.length % 3 !== 0
      || part.indices.length < 3
      || part.indices.length % 3 !== 0
      || !hasFiniteBounds(part.bounds)
    ) {
      throw new Error("STEP worker returned an invalid mesh part");
    }
    const partVertexCount = part.positions.length / 3;
    const partTriangleCount = part.indices.length / 3;
    if (
      vertexCount + partVertexCount > workerLimits.maxVertices
      || triangleCount + partTriangleCount > workerLimits.maxTriangles
      || !Number.isSafeInteger(part.triangleCount)
      || part.triangleCount !== partTriangleCount
      || part.positions.some((entry) => !Number.isFinite(entry))
      || part.indices.some((entry) => !Number.isSafeInteger(entry) || entry < 0 || entry >= partVertexCount)
    ) {
      throw new Error("STEP worker exceeded a mesh resource limit or returned invalid geometry");
    }
    vertexCount += partVertexCount;
    triangleCount += partTriangleCount;
  }
  if (!Number.isSafeInteger(geometry.triangleCount) || geometry.triangleCount !== triangleCount) {
    throw new Error("STEP worker returned an inconsistent triangle count");
  }
  return mesh;
}

async function meshStepIsolated(sourceBytes, expectedInputSha256) {
  if (!Buffer.isBuffer(sourceBytes) || sha256(sourceBytes) !== expectedInputSha256) {
    throw new Error("STEP bytes no longer match the sealed sanitized artifact hash");
  }
  const scratch = await mkdtemp(path.join(os.tmpdir(), "rotorbench-review-step-"));
  const input = path.join(scratch, "input.step");
  const output = path.join(scratch, "mesh.json");
  try {
    // The worker receives an evaluator-owned, exclusive copy of the bytes
    // already checked against the sanitization report. It never reopens the
    // candidate-controlled sanitized path after that check.
    await writeFile(input, sourceBytes, { flag: "wx", mode: 0o600 });
    await execFileAsync(process.execPath, [
      `--max-old-space-size=${workerLimits.maxOldSpaceMb}`,
      STEP_WORKER_PATH,
      "--input", input,
      "--output", output,
      "--expected-sha256", expectedInputSha256,
    ], {
      timeout: workerLimits.timeoutMs,
      windowsHide: true,
      maxBuffer: 1_048_576,
      killSignal: "SIGKILL",
      env: {
        PATH: process.env.PATH ?? "",
        SYSTEMROOT: process.env.SYSTEMROOT ?? "",
        WINDIR: process.env.WINDIR ?? "",
        TEMP: process.env.TEMP ?? "",
        TMP: process.env.TMP ?? "",
        NO_PROXY: "*",
        HTTP_PROXY: "http://127.0.0.1:9",
        HTTPS_PROXY: "http://127.0.0.1:9",
      },
    });
    const outputInfo = await lstat(output);
    if (!outputInfo.isFile() || outputInfo.isSymbolicLink() || outputInfo.size > workerLimits.maxOutputBytes) {
      throw new Error(`STEP worker output exceeds limit of ${workerLimits.maxOutputBytes} bytes`);
    }
    const outputBytes = await readFile(output);
    const outputAfterRead = await lstat(output);
    if (
      outputAfterRead.isSymbolicLink()
      || !outputAfterRead.isFile()
      || outputAfterRead.size !== outputInfo.size
      || outputBytes.length !== outputInfo.size
    ) {
      throw new Error("STEP worker output changed while being read");
    }
    return parseBoundedStepWorkerOutput(outputBytes, expectedInputSha256);
  } finally {
    // mkdtemp gives each conversion a fresh evaluator-owned directory. The
    // finally cleanup covers worker errors, timeouts, and parser failures.
    await rm(scratch, { recursive: true, force: true });
  }
}

function safeUnsupportedStepEvidence(source, reason, tool) {
  return withPayloadHash({
    schemaVersion: "1.0",
    kind: "neutral-step-geometry",
    status: "evaluator-unsupported",
    reason,
    input: { evidenceId: source.evidenceId, sha256: source.inputSha256, mediaType: source.mediaType },
    tool,
  });
}

/**
 * Generate evaluator-owned, identity-neutral geometry and structural evidence.
 * Candidate code is never executed. Allowlisted static STEP is imported only
 * by the separate OCCT worker; allowlisted BOM, requirements-trace, and
 * drawing-index CSV is parsed and normalized in this evaluator process, using
 * frozen output-contract and requirements JSON. Every other candidate artifact
 * remains opaque static evidence.
 */
export async function deriveNeutralReviewEvidence({
  packetRoot,
  packet,
  reportArtifacts,
  artifactEvidenceIds,
  executionContractDigest,
  renderStepView = neutralSvg,
}) {
  const outputContractPath = (packet.inputs ?? []).find(({ id }) => id === "output-contract")?.path;
  const requirementsPath = (packet.inputs ?? []).find(({ id }) => id === "requirements")?.path;
  const tool = toolBinding(executionContractDigest);
  let outputContract;
  let requirements;
  let normalizationInputStatus = null;
  try {
    if (!outputContractPath || !requirementsPath) throw new Error("normalization inputs are not declared");
    outputContract = JSON.parse(decodedUtf8(await readFile(path.join(packetRoot, ...outputContractPath.split("/")))));
    requirements = JSON.parse(decodedUtf8(await readFile(path.join(packetRoot, ...requirementsPath.split("/")))));
  } catch {
    normalizationInputStatus = "frozen-normalization-input-unavailable";
  }
  const artifacts = sourceArtifactArtifacts(reportArtifacts, artifactEvidenceIds);
  const readArtifact = (artifact) => artifact.bytes;
  const sheets = normalizationInputStatus
    ? ["normalized-bom", "normalized-requirements-trace", "normalized-drawing-index"].map((kind) => (
      sheetJson({ kind, source: null, sourceEvidenceId: null, status: "evaluator-unsupported", reason: normalizationInputStatus, metrics: {}, tool })
    ))
    : [
      normalizedBom(outputContract, artifacts, readArtifact, tool),
      normalizedRequirementsTrace(outputContract, requirements, artifacts, readArtifact, tool),
      normalizedDrawingIndex(outputContract, artifacts, readArtifact, tool),
    ];
  const derived = [];
  for (const sheet of sheets) {
    const json = canonicalBytes(sheet);
    const csv = fixedCsv(
      ["kind", "status", "source_evidence_id", "input_sha256", "record_count", "complete_required_field_record_count"],
      [sheet.kind, sheet.status, sheet.source?.evidenceId ?? "", sheet.source?.inputSha256 ?? "", sheet.recordCount ?? 0, sheet.completeRequiredFieldRecordCount ?? 0],
    );
    derived.push({ kind: "normalized-sheet", role: sheet.kind, mediaType: "application/json", bytes: json, sourceEvidenceIds: sheet.source ? [sheet.source.evidenceId] : [], derivationStatus: sheet.status });
    derived.push({ kind: "normalized-sheet", role: `${sheet.kind}-csv`, mediaType: "text/csv", bytes: csv, sourceEvidenceIds: sheet.source ? [sheet.source.evidenceId] : [], derivationStatus: sheet.status });
  }
  for (const source of artifacts.filter(({ role, mediaType }) => role === "step" && mediaType === "model/step")) {
    try {
      const mesh = await meshStepIsolated(source.bytes, source.inputSha256);
      // Do not expose a processed geometry record until all three views are
      // built. A renderer failure must leave precisely one unsupported record,
      // never a geometry/SVG subset for the same input.
      const stepEvidence = [];
      const geometryJson = canonicalBytes(withPayloadHash({
        schemaVersion: "1.0",
        kind: "neutral-step-geometry",
        status: "processed",
        input: { evidenceId: source.evidenceId, sha256: source.inputSha256, mediaType: source.mediaType },
        tool,
        geometry: {
          partCount: mesh.geometry.partCount,
          triangleCount: mesh.geometry.triangleCount,
          bounds: mesh.geometry.bounds,
          parts: mesh.geometry.parts.map(({ id, triangleCount, bounds }) => ({ id, triangleCount, bounds })),
        },
      }));
      stepEvidence.push({ kind: "neutral-step-geometry", role: "step-geometry", mediaType: "application/json", bytes: geometryJson, sourceEvidenceIds: [source.evidenceId], derivationStatus: "processed", tool });
      for (const direction of ["x", "y", "z"]) {
        const view = renderStepView(mesh.geometry, direction);
        if (!Buffer.isBuffer(view)) throw new Error("STEP view renderer did not return bytes");
        stepEvidence.push({ kind: "neutral-step-view", role: `step-view-${direction}`, mediaType: "image/svg+xml", bytes: view, sourceEvidenceIds: [source.evidenceId], derivationStatus: "processed", tool });
      }
      derived.push(...stepEvidence);
    } catch (error) {
      const errorText = error instanceof Error
        ? `${error.message} ${String(error.stderr ?? "")}`
        : "";
      const reason = /(limit|resource)/i.test(errorText)
        ? "step-resource-limit"
        : "step-import-failed";
      derived.push({
        kind: "neutral-step-geometry",
        role: "step-geometry",
        mediaType: "application/json",
        bytes: canonicalBytes(safeUnsupportedStepEvidence(source, reason, tool)),
        sourceEvidenceIds: [source.evidenceId],
        derivationStatus: "evaluator-unsupported",
        tool,
      });
    }
  }
  return derived.map((item) => ({ ...item, tool }));
}
