#!/usr/bin/env node
// Benchmark-owned static validator. It deliberately does not import candidate modules.
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

function argument(name, { required = true } = {}) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? "" : process.argv[index + 1];
  if (required && !value) throw new Error(`Missing ${name}`);
  if (!value) return "";
  return path.resolve(value);
}

function inside(root, relative) {
  if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) return null;
  const target = path.resolve(root, relative);
  const remaining = path.relative(root, target);
  return remaining && !remaining.startsWith("..") && !path.isAbsolute(remaining) ? target : null;
}

async function regular(root, relative) {
  const target = inside(root, relative);
  if (!target) throw new Error(`Unsafe candidate path: ${relative}`);
  const info = await lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${relative}`);
  return readFile(target);
}

const finiteVector = (value, length) => Array.isArray(value)
  && value.length === length
  && value.every(Number.isFinite);
const sameVector = (left, right, tolerance) => finiteVector(left, right.length)
  && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
const nonEmptyString = (value) => typeof value === "string" && value.trim().length > 0;
const finiteNonNegative = (value) => Number.isFinite(value) && value >= 0;
const finitePositive = (value) => Number.isFinite(value) && value > 0;
const unique = (items, key) => {
  const seen = new Set();
  const duplicates = [];
  for (const item of items) {
    const value = key(item);
    if (typeof value !== "string" || !value || seen.has(value)) duplicates.push(value || "<missing>");
    seen.add(value);
  }
  return duplicates;
};
const exactUniqueStringSet = (actual, expected) => Array.isArray(actual)
  && actual.every(nonEmptyString)
  && new Set(actual).size === actual.length
  && actual.length === expected.length
  && actual.every((value) => expected.includes(value));

function add(checks, id, result, detail) {
  checks.push({ id, result, detail });
}

const defaultBenchmarkRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

function compareUtf8Path(left, right) {
  return Buffer.compare(Buffer.from(left, "utf8"), Buffer.from(right, "utf8"));
}

function canonicalPacketInputPath(relative) {
  return typeof relative === "string"
    && /^inputs\/[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(relative)
    && !relative.includes("\\")
    && !relative.includes("//");
}

async function regularPacketInput(benchmarkRoot, relative) {
  if (!canonicalPacketInputPath(relative)) {
    throw new Error(`Unsafe canonical packet input path: ${relative}`);
  }
  const root = path.resolve(benchmarkRoot);
  const target = inside(root, relative);
  if (!target) throw new Error(`Canonical packet input escapes benchmark root: ${relative}`);

  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) {
    throw new Error("Benchmark root must be a non-symlink directory");
  }
  let current = root;
  for (const segment of relative.split("/")) {
    current = path.join(current, segment);
    const info = await lstat(current);
    if (info.isSymbolicLink()) {
      throw new Error(`Canonical packet input may not traverse a symlink: ${relative}`);
    }
  }
  const before = await lstat(target);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`Canonical packet input is not a regular file: ${relative}`);
  }
  const [resolvedRoot, resolvedTarget] = await Promise.all([realpath(root), realpath(target)]);
  if (!resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Canonical packet input escapes resolved benchmark root: ${relative}`);
  }
  const bytes = await readFile(target);
  const after = await lstat(target);
  if (
    !after.isFile()
    || after.isSymbolicLink()
    || before.size !== after.size
    || before.mtimeMs !== after.mtimeMs
  ) {
    throw new Error(`Canonical packet input changed while being read: ${relative}`);
  }
  return bytes;
}

function rawSha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function stepEnvelopeValid(step) {
  const source = step.replace(/^\uFEFF/, "").trim();
  return /^ISO-10303-21;\s*HEADER;[\s\S]*?FILE_SCHEMA\s*\(\s*\(\s*'[^']*AP242[^']*'\s*\)\s*\)\s*;[\s\S]*?ENDSEC;\s*DATA;[\s\S]*?#\d+\s*=\s*[A-Z][A-Z0-9_]*\s*\([\s\S]*?ENDSEC;\s*END-ISO-10303-21;$/i.test(source);
}

function frameValid(frames) {
  if (!Array.isArray(frames) || unique(frames, (frame) => frame?.id).length) return false;
  const byId = new Map(frames.map((frame) => [frame.id, frame]));
  if (byId.get("W")?.parentFrameId !== null) return false;
  for (const frame of frames) {
    if (frame.id === "W") continue;
    if (
      !byId.has(frame?.parentFrameId)
      || !finiteVector(frame?.translationMm, 3)
      || !Array.isArray(frame?.rotationMatrix)
      || frame.rotationMatrix.length !== 3
      || !frame.rotationMatrix.every((row) => finiteVector(row, 3))
    ) return false;
    const visited = new Set([frame.id]);
    let current = frame;
    while (current.id !== "W") {
      current = byId.get(current.parentFrameId);
      if (!current || visited.has(current.id)) return false;
      visited.add(current.id);
    }
  }
  return true;
}

function isUnitAxis(axis, tolerance) {
  if (!finiteVector(axis, 3) || !Number.isFinite(tolerance) || tolerance < 0) return false;
  const norm = Math.hypot(...axis);
  return norm > 0 && Math.abs(norm - 1) <= tolerance;
}

export function canonicalInputDigest(byteSet) {
  const records = byteSet?.records;
  if (!Array.isArray(records) || records.length === 0) return null;
  const normalized = [];
  for (const record of records) {
    if (!nonEmptyString(record?.path) || !/^[a-f0-9]{64}$/.test(record?.sha256 ?? "")) return null;
    normalized.push({ path: record.path, sha256: record.sha256 });
  }
  normalized.sort((left, right) => compareUtf8Path(left.path, right.path));
  if (new Set(normalized.map(({ path: value }) => value)).size !== normalized.length) return null;
  const bytes = Buffer.from(
    normalized.map(({ path: value, sha256: digest }) => `${value}\0${digest}\n`).join(""),
    "utf8",
  );
  return createHash("sha256").update(bytes).digest("hex");
}

async function commonMethod(contract, benchmarkRoot = defaultBenchmarkRoot) {
  const declared = contract?.kinematics?.commonEvidenceMethod;
  if (!declared || declared.path !== "inputs/common-evaluation-method.json") {
    throw new Error("Neutral handoff contract does not bind the common evidence method path");
  }
  const method = JSON.parse((await regularPacketInput(benchmarkRoot, declared.path)).toString("utf8"));
  const byteSet = method?.canonicalInputByteSet;
  const records = byteSet?.records;
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Hash-bound common evidence method has no canonical input-byte records");
  }
  for (const record of records) {
    if (!canonicalPacketInputPath(record?.path) || !/^[a-f0-9]{64}$/.test(record?.sha256 ?? "")) {
      throw new Error("Hash-bound common evidence method declares an unsafe canonical input-byte record");
    }
    const actualDigest = rawSha256(await regularPacketInput(benchmarkRoot, record.path));
    if (actualDigest !== record.sha256) {
      throw new Error(`Canonical packet input bytes do not match the declared digest: ${record.path}`);
    }
  }
  const digest = canonicalInputDigest(byteSet);
  if (
    method.methodId !== declared.methodId
    || byteSet?.id !== declared.canonicalInputByteSetId
    || byteSet?.algorithm !== declared.inputDigestAlgorithm
    || !digest
    || digest !== byteSet.expectedInputDigest
  ) {
    throw new Error("Hash-bound common evidence method has an invalid canonical input-byte set");
  }
  return { method, inputDigest: digest };
}

function recordFieldValid(value, kind, expectedDigest) {
  switch (kind) {
    case "non-empty-string": return nonEmptyString(value);
    case "canonical-input-digest": return value === expectedDigest;
    case "unique-non-empty-string-array": return Array.isArray(value)
      && value.length > 0
      && value.every(nonEmptyString)
      && new Set(value).size === value.length;
    case "finite-positive-number": return finitePositive(value);
    case "finite-non-negative-number": return finiteNonNegative(value);
    case "non-empty-object": return value !== null
      && typeof value === "object"
      && !Array.isArray(value)
      && Object.keys(value).length > 0;
    case "evidence-decision": return [
      "pass",
      "fail",
      "evaluator-unsupported",
      "evaluator-uncertain",
    ].includes(value);
    default: return false;
  }
}

function completeRecordValid(record, descriptor, expectedDigest) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return false;
  const required = descriptor?.requiredFields;
  const contracts = descriptor?.fieldContracts;
  if (!Array.isArray(required) || !contracts) return false;
  return required.length > 0
    && new Set(required).size === required.length
    && required.every((field) => Object.hasOwn(contracts, field)
      && Object.hasOwn(record, field)
      && recordFieldValid(record[field], contracts[field]?.kind, expectedDigest));
}

function evidenceValid({ evidence, method, inputDigest, segmentIds, caseIds, poseIds, geometryIds }) {
  const records = method?.evidenceRecords ?? {};
  if (
    evidence?.methodId !== method?.methodId
    || evidence?.automaticPass === true
    || !completeRecordValid(evidence?.motion, records.motion, inputDigest)
    || !completeRecordValid(evidence?.collision, records.collision, inputDigest)
    || !completeRecordValid(evidence?.accuracy, records.accuracy, inputDigest)
  ) return false;
  const { motion, collision, accuracy } = evidence;
  return !unique([motion, collision, accuracy], (record) => record?.id).length
    && exactUniqueStringSet(motion.segmentIds, segmentIds)
    && exactUniqueStringSet(motion.payloadCaseIds, caseIds)
    && exactUniqueStringSet(collision.poseIds, poseIds)
    && exactUniqueStringSet(collision.payloadCaseIds, caseIds)
    && exactUniqueStringSet(collision.geometryReferenceIds, geometryIds)
    && exactUniqueStringSet(accuracy.poseIds, poseIds)
    && exactUniqueStringSet(accuracy.payloadCaseIds, caseIds)
    && accuracy.foundationReference === "FND-ANCH-001";
}

export async function validateNeutralHandoff({ candidateRoot, contract, benchmarkRoot = defaultBenchmarkRoot }) {
  const checks = [];
  const fail = (id, detail) => add(checks, id, "fail", detail);
  try {
    const step = (await regular(candidateRoot, contract.candidateArtifacts.stepPath)).toString("latin1");
    add(
      checks,
      "STEP-ENVELOPE",
      stepEnvelopeValid(step) ? "pass" : "fail",
      stepEnvelopeValid(step)
        ? "Recognizable AP242 Part-21 static envelope."
        : "STEP must contain a bounded AP242 HEADER and DATA entity section, not just header tokens.",
    );
  } catch (error) {
    fail("STEP-ENVELOPE", error instanceof Error ? error.message : "Cannot read STEP");
  }

  let data;
  try {
    data = JSON.parse((await regular(candidateRoot, contract.candidateArtifacts.kinematicsPath)).toString("utf8"));
  } catch (error) {
    fail("KINEMATICS-JSON", error instanceof Error ? error.message : "Cannot parse kinematics JSON");
    return { status: "invalid", contractId: contract.contractId, checks, limitations: contract.execution.automaticScope };
  }

  const required = contract.kinematics.requiredTopLevelFields;
  const missing = required.filter((field) => !Object.hasOwn(data, field));
  add(
    checks,
    "KINEMATICS-SHAPE",
    data.contractId === contract.contractId && !missing.length ? "pass" : "fail",
    missing.length ? `Missing fields: ${missing.join(", ")}` : "Contract id and required top-level fields present.",
  );
  const units = data.units;
  const unitValid = units
    && Object.entries(contract.kinematics.units).every(([key, value]) => units[key] === value)
    && Object.keys(units).length === Object.keys(contract.kinematics.units).length;
  add(checks, "UNITS", unitValid ? "pass" : "fail", unitValid ? "Declared units exactly match the frozen contract." : "Top-level units are missing, extra, or inconsistent.");

  const frames = Array.isArray(data.coordinateFrames) ? data.coordinateFrames : [];
  const framesValid = frameValid(frames);
  add(checks, "FRAME-REFERENCES", framesValid ? "pass" : "fail", framesValid ? "Coordinate-frame IDs form one finite rooted W tree." : "Coordinate frames are duplicate, disconnected, cyclic, or malformed.");
  const frameIds = new Set(frames.map((frame) => frame?.id));
  const childFrameParents = new Map(frames.map((frame) => [frame?.id, frame?.parentFrameId]));

  const joints = Array.isArray(data.jointTopology) ? data.jointTopology : [];
  const allowedKinds = new Set(contract.kinematics.jointKinds);
  const movable = joints.filter((joint) => joint?.kind !== "fixed");
  const nonWFrameIds = [...frameIds].filter((id) => id !== "W");
  const topologyValid = joints.length > 0
    && !unique(joints, (joint) => joint?.id).length
    && !unique(joints, (joint) => joint?.childFrameId).length
    && exactUniqueStringSet(joints.map((joint) => joint?.childFrameId), nonWFrameIds)
    && joints.every((joint) => allowedKinds.has(joint?.kind)
      && joint?.unit === contract.kinematics.jointUnitByKind[joint.kind]
      && frameIds.has(joint?.parentFrameId)
      && frameIds.has(joint?.childFrameId)
      && joint.childFrameId !== "W"
      && joint.parentFrameId !== joint.childFrameId
      && childFrameParents.get(joint.childFrameId) === joint.parentFrameId
      && (joint.kind === "fixed" || isUnitAxis(joint.axis, contract.kinematics.axisUnitTolerance)));
  const tcpValid = data.tcpTransform
    && frameIds.has(data.tcpTransform.frameId)
    && finiteVector(data.tcpTransform.translationMm, 3)
    && Array.isArray(data.tcpTransform.rotationMatrix)
    && data.tcpTransform.rotationMatrix.length === 3
    && data.tcpTransform.rotationMatrix.every((row) => finiteVector(row, 3));
  add(
    checks,
    "JOINT-TOPOLOGY",
    topologyValid && tcpValid ? "pass" : "fail",
    topologyValid && tcpValid
      ? "Joint kinds, units, finite unit axes, frame-parent edges, connected child coverage, and TCP reference are valid."
      : "Joint topology, unit axis, frame-parent edge, connected child coverage, or TCP frame/reference is invalid.",
  );

  const limits = Array.isArray(data.jointLimits) ? data.jointLimits : [];
  const limitsById = new Map(limits.map((limit) => [limit?.jointId, limit]));
  const limitValid = !unique(limits, (limit) => limit?.jointId).length
    && exactUniqueStringSet(limits.map((limit) => limit?.jointId), movable.map((joint) => joint.id))
    && movable.every((joint) => {
      const limit = limitsById.get(joint.id);
      return limit
        && limit.unit === joint.unit
        && Number.isFinite(limit.minimum)
        && Number.isFinite(limit.maximum)
        && limit.minimum <= limit.maximum;
    });
  const expectedStates = new Map(contract.kinematics.requiredPayloadStates.map((state) => [state.id, state.workpieceId]));
  const states = Array.isArray(data.payloadStates) ? data.payloadStates : [];
  const stateValid = !unique(states, (state) => state?.id).length
    && exactUniqueStringSet(states.map((state) => state?.id), [...expectedStates.keys()])
    && states.every((state) => expectedStates.get(state.id) === (state.workpieceId ?? null));
  add(checks, "LIMITS-AND-PAYLOAD-STATES", limitValid && stateValid ? "pass" : "fail", limitValid && stateValid ? "Limits and payload states are unique, complete, unit-consistent, and referenced by the frozen cases." : "Joint-limit or payload-state declaration is duplicate, incomplete, or invalid.");

  const targets = new Map(contract.kinematics.requiredPoseTargets.map((target) => [target.id, target]));
  const cases = new Map(contract.kinematics.requiredPayloadCases.map((item) => [item.id, item]));
  const results = Array.isArray(data.requiredPoseResults) ? data.requiredPoseResults : [];
  const resultKeys = results.map((result) => `${result?.poseId}::${result?.payloadCaseId}`);
  const expectedResultKeys = [...cases.keys()].flatMap((caseId) => [...targets.keys()].map((poseId) => `${poseId}::${caseId}`));
  const poseValid = !unique(results, (result) => result?.id).length
    && new Set(resultKeys).size === resultKeys.length
    && exactUniqueStringSet(resultKeys, expectedResultKeys)
    && results.every((result) => {
      const target = targets.get(result.poseId);
      const payloadCase = cases.get(result.payloadCaseId);
      const values = Array.isArray(result.jointValues) ? result.jointValues : [];
      return target
        && payloadCase
        && result.payloadStateId === payloadCase.payloadStateId
        && sameVector(result.targetPosition, target.position, contract.kinematics.poseTolerance.position)
        && sameVector(result.targetToolAxis, target.toolAxis, contract.kinematics.poseTolerance.toolAxis)
        && !unique(values, (value) => value?.jointId).length
        && exactUniqueStringSet(values.map((value) => value?.jointId), movable.map((joint) => joint.id))
        && values.every((value) => {
          const limit = limitsById.get(value.jointId);
          return limit
            && value.unit === limit.unit
            && Number.isFinite(value.value)
            && value.value >= limit.minimum
            && value.value <= limit.maximum;
        });
    });
  add(checks, "POSE-PAYLOAD-COVERAGE", poseValid ? "pass" : "fail", poseValid ? "Every required pose/payload case has one target-identical, limit-valid result." : "Pose results are duplicate, incomplete, mismatched, or contain invalid joint values.");

  const references = Array.isArray(data.geometryReferences) ? data.geometryReferences : [];
  const refIds = references.map((reference) => reference?.id);
  const refsValid = !unique(references, (reference) => reference?.id).length
    && contract.kinematics.requiredGeometryReferenceIds.every((id) => refIds.includes(id));
  add(checks, "GEOMETRY-REFERENCES", refsValid ? "pass" : "fail", refsValid ? "All required fixed geometry references are unique and declared." : "Geometry references are duplicate or incomplete.");

  const trajectory = data.trajectory ?? {};
  const segments = Array.isArray(trajectory.segments) ? trajectory.segments : [];
  const summaries = Array.isArray(trajectory.cycleSummaries) ? trajectory.cycleSummaries : [];
  let trajectoryValid = !unique(segments, (segment) => segment?.id).length
    && !unique(summaries, (summary) => summary?.payloadCaseId).length
    && exactUniqueStringSet(summaries.map((summary) => summary?.payloadCaseId), [...cases.keys()]);
  for (const [caseId, payloadCase] of cases) {
    const listed = segments.filter((segment) => segment?.payloadCaseId === caseId).sort((left, right) => left.sequence - right.sequence);
    const summary = summaries.find((item) => item?.payloadCaseId === caseId);
    const validSegments = listed.length > 0 && listed.every((segment, index) => Number.isInteger(segment.sequence)
      && segment.sequence === index + 1
      && targets.has(segment.fromPoseId)
      && targets.has(segment.toPoseId)
      && segment.payloadStateId === payloadCase.payloadStateId
      && Number.isFinite(segment.durationSeconds)
      && segment.durationSeconds > 0
      && (index === 0 || listed[index - 1].toPoseId === segment.fromPoseId));
    const covered = new Set(listed.flatMap((segment) => [segment.fromPoseId, segment.toPoseId]));
    const sum = listed.reduce((total, segment) => total + segment.durationSeconds, 0);
    if (!validSegments
      || covered.size !== targets.size
      || [...targets.keys()].some((id) => !covered.has(id))
      || !summary
      || !Number.isFinite(summary.declaredCycleSeconds)
      || Math.abs(summary.declaredCycleSeconds - sum) > 0.001) trajectoryValid = false;
  }
  if (segments.some((segment) => !cases.has(segment?.payloadCaseId))) trajectoryValid = false;
  add(checks, "TRAJECTORY-CONNECTION", trajectoryValid ? "pass" : "fail", trajectoryValid ? "Every payload-case trajectory is uniquely sequenced, connected, fully pose-covered, and arithmetically consistent." : "Trajectory IDs, connections, payload references, coverage, or cycle arithmetic are invalid.");

  const budget = data.repeatabilityBudget ?? {};
  const components = Array.isArray(budget.components) ? budget.components : [];
  const rss = Math.sqrt(components.reduce((sum, component) => sum + (finiteNonNegative(component?.valueMm) ? component.valueMm ** 2 : NaN), 0));
  const budgetValid = components.length > 0
    && !unique(components, (component) => component?.id).length
    && components.every((component) => component.unit === "mm")
    && Number.isFinite(rss)
    && Number.isFinite(budget.rssMm)
    && Math.abs(rss - budget.rssMm) <= 0.0001;
  add(checks, "REPEATABILITY-ARITHMETIC", budgetValid ? "pass" : "fail", budgetValid ? "Unique mm error-source RSS arithmetic is internally consistent; no physical repeatability claim is made." : "Repeatability components or RSS arithmetic are invalid.");

  let common;
  try {
    common = await commonMethod(contract, benchmarkRoot);
  } catch (error) {
    fail("COMMON-EVIDENCE-COVERAGE", error instanceof Error ? error.message : "Cannot load common evidence method");
  }
  if (common) {
    const completeEvidence = evidenceValid({
      evidence: data.evaluationEvidence,
      method: common.method,
      inputDigest: common.inputDigest,
      segmentIds: segments.map((segment) => segment.id),
      caseIds: [...cases.keys()],
      poseIds: [...targets.keys()],
      geometryIds: contract.kinematics.requiredGeometryReferenceIds,
    });
    add(
      checks,
      "COMMON-EVIDENCE-COVERAGE",
      completeEvidence ? "pass" : "fail",
      completeEvidence
        ? "Frozen evidence-only method has complete typed static coverage and exact canonical input-byte digests without an automatic-pass claim."
        : "Common-method evidence records are duplicate, incomplete, have an invalid field domain, lack exact coverage, use an unbound digest, or claim automatic pass.",
    );
  }

  return {
    status: checks.every(({ result }) => result === "pass") ? "valid" : "invalid",
    contractId: contract.contractId,
    checks,
    limitations: contract.execution.automaticScope,
  };
}

async function main() {
  const candidateRoot = argument("--candidate-root");
  const contractPath = argument("--contract");
  const benchmarkRoot = argument("--benchmark-root", { required: false }) || defaultBenchmarkRoot;
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const report = await validateNeutralHandoff({ candidateRoot, contract, benchmarkRoot });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "valid" ? 0 : 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 2;
  });
}
