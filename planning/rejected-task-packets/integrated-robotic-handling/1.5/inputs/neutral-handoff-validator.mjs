#!/usr/bin/env node
// Benchmark-owned static validator. It deliberately does not import candidate modules.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

function argument(name) { const index = process.argv.indexOf(name); const value = index < 0 ? "" : process.argv[index + 1]; if (!value) throw new Error(`Missing ${name}`); return path.resolve(value); }
function inside(root, relative) { if (typeof relative !== "string" || !relative || path.isAbsolute(relative)) return null; const target = path.resolve(root, relative); const remaining = path.relative(root, target); return remaining && !remaining.startsWith("..") && !path.isAbsolute(remaining) ? target : null; }
async function regular(root, relative) { const target = inside(root, relative); if (!target) throw new Error(`Unsafe candidate path: ${relative}`); const info = await lstat(target); if (!info.isFile() || info.isSymbolicLink()) throw new Error(`Not a regular file: ${relative}`); return readFile(target); }
const finiteVector = (value, length) => Array.isArray(value) && value.length === length && value.every(Number.isFinite);
const sameVector = (left, right, tolerance) => finiteVector(left, right.length) && left.every((value, index) => Math.abs(value - right[index]) <= tolerance);
const unique = (items, key) => { const seen = new Set(); const duplicates = []; for (const item of items) { const value = key(item); if (typeof value !== "string" || !value || seen.has(value)) duplicates.push(value || "<missing>"); seen.add(value); } return duplicates; };
const expectedSet = (left, right) => left.length === right.length && left.every((value) => right.includes(value));
const sha256 = (value) => typeof value === "string" && /^[a-f0-9]{64}$/i.test(value);
function add(checks, id, result, detail) { checks.push({ id, result, detail }); }

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
    if (!byId.has(frame?.parentFrameId) || !finiteVector(frame?.translationMm, 3) || !Array.isArray(frame?.rotationMatrix) || frame.rotationMatrix.length !== 3 || !frame.rotationMatrix.every((row) => finiteVector(row, 3))) return false;
    const visited = new Set([frame.id]); let current = frame;
    while (current.id !== "W") { current = byId.get(current.parentFrameId); if (!current || visited.has(current.id)) return false; visited.add(current.id); }
  }
  return true;
}

function coverageRecordValid(record, required, fields) {
  return record && typeof record.id === "string" && record.id && typeof record.method === "string" && record.method && sha256(record.inputDigest)
    && fields.every((field) => Array.isArray(record[field]) && unique(record[field].map((id) => ({ id })), ({ id }) => id).length === 0 && expectedSet(record[field], required));
}

export async function validateNeutralHandoff({ candidateRoot, contract }) {
  const checks = []; const fail = (id, detail) => add(checks, id, "fail", detail);
  try { const step = (await regular(candidateRoot, contract.candidateArtifacts.stepPath)).toString("latin1"); add(checks, "STEP-ENVELOPE", stepEnvelopeValid(step) ? "pass" : "fail", stepEnvelopeValid(step) ? "Recognizable AP242 Part-21 static envelope." : "STEP must contain a bounded AP242 HEADER and DATA entity section, not just header tokens."); } catch (error) { fail("STEP-ENVELOPE", error instanceof Error ? error.message : "Cannot read STEP"); }
  let data;
  try { data = JSON.parse((await regular(candidateRoot, contract.candidateArtifacts.kinematicsPath)).toString("utf8")); } catch (error) { fail("KINEMATICS-JSON", error instanceof Error ? error.message : "Cannot parse kinematics JSON"); return { status: "invalid", contractId: contract.contractId, checks, limitations: contract.execution.automaticScope }; }
  const required = contract.kinematics.requiredTopLevelFields; const missing = required.filter((field) => !Object.hasOwn(data, field));
  add(checks, "KINEMATICS-SHAPE", data.contractId === contract.contractId && !missing.length ? "pass" : "fail", missing.length ? `Missing fields: ${missing.join(", ")}` : "Contract id and required top-level fields present.");
  const units = data.units; const unitValid = units && Object.entries(contract.kinematics.units).every(([key, value]) => units[key] === value) && Object.keys(units).length === Object.keys(contract.kinematics.units).length;
  add(checks, "UNITS", unitValid ? "pass" : "fail", unitValid ? "Declared units exactly match the frozen contract." : "Top-level units are missing, extra, or inconsistent.");
  const frames = Array.isArray(data.coordinateFrames) ? data.coordinateFrames : [];
  add(checks, "FRAME-REFERENCES", frameValid(frames) ? "pass" : "fail", frameValid(frames) ? "Coordinate-frame IDs form one finite rooted W tree." : "Coordinate frames are duplicate, disconnected, cyclic, or malformed.");
  const frameIds = new Set(frames.map((frame) => frame?.id));
  const joints = Array.isArray(data.jointTopology) ? data.jointTopology : [];
  const allowedKinds = new Set(contract.kinematics.jointKinds); const jointIds = joints.map((joint) => joint?.id); const movable = joints.filter((joint) => joint?.kind !== "fixed");
  const topologyValid = joints.length > 0 && !unique(joints, (joint) => joint?.id).length && !unique(joints, (joint) => joint?.childFrameId).length && joints.every((joint) => allowedKinds.has(joint?.kind) && joint?.unit === contract.kinematics.jointUnitByKind[joint.kind] && frameIds.has(joint?.parentFrameId) && frameIds.has(joint?.childFrameId) && joint.parentFrameId !== joint.childFrameId && (joint.kind === "fixed" || finiteVector(joint.axis, 3)));
  const tcpValid = data.tcpTransform && frameIds.has(data.tcpTransform.frameId) && finiteVector(data.tcpTransform.translationMm, 3) && Array.isArray(data.tcpTransform.rotationMatrix) && data.tcpTransform.rotationMatrix.length === 3 && data.tcpTransform.rotationMatrix.every((row) => finiteVector(row, 3));
  add(checks, "JOINT-TOPOLOGY", topologyValid && tcpValid ? "pass" : "fail", topologyValid && tcpValid ? "Joint kinds, units, unique frame links, and TCP reference are valid." : "Joint topology or TCP frame/reference is invalid.");
  const limits = Array.isArray(data.jointLimits) ? data.jointLimits : []; const limitsById = new Map(limits.map((limit) => [limit?.jointId, limit]));
  const limitValid = !unique(limits, (limit) => limit?.jointId).length && expectedSet(limits.map((limit) => limit?.jointId), movable.map((joint) => joint.id)) && movable.every((joint) => { const limit = limitsById.get(joint.id); return limit && limit.unit === joint.unit && Number.isFinite(limit.minimum) && Number.isFinite(limit.maximum) && limit.minimum <= limit.maximum; });
  const expectedStates = new Map(contract.kinematics.requiredPayloadStates.map((state) => [state.id, state.workpieceId])); const states = Array.isArray(data.payloadStates) ? data.payloadStates : [];
  const stateValid = !unique(states, (state) => state?.id).length && expectedSet(states.map((state) => state?.id), [...expectedStates.keys()]) && states.every((state) => expectedStates.get(state.id) === (state.workpieceId ?? null));
  add(checks, "LIMITS-AND-PAYLOAD-STATES", limitValid && stateValid ? "pass" : "fail", limitValid && stateValid ? "Limits and payload states are unique, complete, unit-consistent, and referenced by the frozen cases." : "Joint-limit or payload-state declaration is duplicate, incomplete, or invalid.");
  const targets = new Map(contract.kinematics.requiredPoseTargets.map((target) => [target.id, target])); const cases = new Map(contract.kinematics.requiredPayloadCases.map((item) => [item.id, item])); const results = Array.isArray(data.requiredPoseResults) ? data.requiredPoseResults : [];
  const resultKeys = results.map((result) => `${result?.poseId}::${result?.payloadCaseId}`); const expectedResultKeys = [...cases.keys()].flatMap((caseId) => [...targets.keys()].map((poseId) => `${poseId}::${caseId}`));
  const poseValid = !unique(results, (result) => result?.id).length && new Set(resultKeys).size === resultKeys.length && expectedSet(resultKeys, expectedResultKeys) && results.every((result) => { const target = targets.get(result.poseId); const payloadCase = cases.get(result.payloadCaseId); const values = Array.isArray(result.jointValues) ? result.jointValues : []; return target && payloadCase && result.payloadStateId === payloadCase.payloadStateId && sameVector(result.targetPosition, target.position, contract.kinematics.poseTolerance.position) && sameVector(result.targetToolAxis, target.toolAxis, contract.kinematics.poseTolerance.toolAxis) && !unique(values, (value) => value?.jointId).length && expectedSet(values.map((value) => value?.jointId), movable.map((joint) => joint.id)) && values.every((value) => { const limit = limitsById.get(value.jointId); return limit && value.unit === limit.unit && Number.isFinite(value.value) && value.value >= limit.minimum && value.value <= limit.maximum; }); });
  add(checks, "POSE-PAYLOAD-COVERAGE", poseValid ? "pass" : "fail", poseValid ? "Every required pose/payload case has one target-identical, limit-valid result." : "Pose results are duplicate, incomplete, mismatched, or contain invalid joint values.");
  const references = Array.isArray(data.geometryReferences) ? data.geometryReferences : []; const refIds = references.map((reference) => reference?.id); const refsValid = !unique(references, (reference) => reference?.id).length && contract.kinematics.requiredGeometryReferenceIds.every((id) => refIds.includes(id));
  add(checks, "GEOMETRY-REFERENCES", refsValid ? "pass" : "fail", refsValid ? "All required fixed geometry references are unique and declared." : "Geometry references are duplicate or incomplete.");
  const trajectory = data.trajectory ?? {}; const segments = Array.isArray(trajectory.segments) ? trajectory.segments : []; const summaries = Array.isArray(trajectory.cycleSummaries) ? trajectory.cycleSummaries : [];
  let trajectoryValid = !unique(segments, (segment) => segment?.id).length && !unique(summaries, (summary) => summary?.payloadCaseId).length && expectedSet(summaries.map((summary) => summary?.payloadCaseId), [...cases.keys()]);
  for (const [caseId, payloadCase] of cases) { const listed = segments.filter((segment) => segment?.payloadCaseId === caseId).sort((left, right) => left.sequence - right.sequence); const summary = summaries.find((item) => item?.payloadCaseId === caseId); const validSegments = listed.length > 0 && listed.every((segment, index) => Number.isInteger(segment.sequence) && segment.sequence === index + 1 && targets.has(segment.fromPoseId) && targets.has(segment.toPoseId) && segment.payloadStateId === payloadCase.payloadStateId && Number.isFinite(segment.durationSeconds) && segment.durationSeconds > 0 && (index === 0 || listed[index - 1].toPoseId === segment.fromPoseId)); const covered = new Set(listed.flatMap((segment) => [segment.fromPoseId, segment.toPoseId])); const sum = listed.reduce((total, segment) => total + segment.durationSeconds, 0); if (!validSegments || covered.size !== targets.size || [...targets.keys()].some((id) => !covered.has(id)) || !summary || !Number.isFinite(summary.declaredCycleSeconds) || Math.abs(summary.declaredCycleSeconds - sum) > 0.001) trajectoryValid = false; }
  if (segments.some((segment) => !cases.has(segment?.payloadCaseId))) trajectoryValid = false;
  add(checks, "TRAJECTORY-CONNECTION", trajectoryValid ? "pass" : "fail", trajectoryValid ? "Every payload-case trajectory is uniquely sequenced, connected, fully pose-covered, and arithmetically consistent." : "Trajectory IDs, connections, payload references, coverage, or cycle arithmetic are invalid.");
  const budget = data.repeatabilityBudget ?? {}; const components = Array.isArray(budget.components) ? budget.components : []; const rss = Math.sqrt(components.reduce((sum, component) => sum + (Number.isFinite(component?.valueMm) && component.valueMm >= 0 ? component.valueMm ** 2 : NaN), 0)); const budgetValid = components.length > 0 && !unique(components, (component) => component?.id).length && components.every((component) => component.unit === "mm") && Number.isFinite(rss) && Number.isFinite(budget.rssMm) && Math.abs(rss - budget.rssMm) <= 0.0001;
  add(checks, "REPEATABILITY-ARITHMETIC", budgetValid ? "pass" : "fail", budgetValid ? "Unique mm error-source RSS arithmetic is internally consistent; no physical repeatability claim is made." : "Repeatability components or RSS arithmetic are invalid.");
  const evidence = data.evaluationEvidence ?? {}; const methodId = "ROBOTIC-HANDLING-EVIDENCE-ONLY-V1"; const segmentIds = segments.map((segment) => segment.id); const caseIds = [...cases.keys()]; const poseIds = [...targets.keys()]; const evidenceValid = evidence.methodId === methodId && evidence.automaticPass !== true && coverageRecordValid(evidence.motion, caseIds, ["payloadCaseIds"]) && expectedSet(evidence.motion.segmentIds ?? [], segmentIds) && coverageRecordValid(evidence.collision, poseIds, ["poseIds"]) && expectedSet(evidence.collision.payloadCaseIds ?? [], caseIds) && expectedSet(evidence.collision.geometryReferenceIds ?? [], contract.kinematics.requiredGeometryReferenceIds) && coverageRecordValid(evidence.accuracy, poseIds, ["poseIds"]) && expectedSet(evidence.accuracy.payloadCaseIds ?? [], caseIds) && evidence.accuracy.foundationReference === "FND-ANCH-001" && !unique([evidence.motion, evidence.collision, evidence.accuracy], (record) => record?.id).length;
  add(checks, "COMMON-EVIDENCE-COVERAGE", evidenceValid ? "pass" : "fail", evidenceValid ? "Frozen evidence-only method has complete static motion, collision, and accuracy coverage without an automatic-pass claim." : "Common-method evidence records are duplicate, incomplete, unhashable, or claim automatic pass.");
  return { status: checks.every(({ result }) => result === "pass") ? "valid" : "invalid", contractId: contract.contractId, checks, limitations: contract.execution.automaticScope };
}

async function main() { const candidateRoot = argument("--candidate-root"); const contractPath = argument("--contract"); const contract = JSON.parse(await readFile(contractPath, "utf8")); const report = await validateNeutralHandoff({ candidateRoot, contract }); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); process.exitCode = report.status === "valid" ? 0 : 1; }
if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
