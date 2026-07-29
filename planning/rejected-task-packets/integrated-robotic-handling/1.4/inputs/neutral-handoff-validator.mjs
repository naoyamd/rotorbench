#!/usr/bin/env node
// Benchmark-owned static validator. It deliberately does not import candidate modules.
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? "" : process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name}`);
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

function isVector(value, length) {
  return Array.isArray(value) && value.length === length && value.every(Number.isFinite);
}

function equalsVector(actual, expected, tolerance) {
  return isVector(actual, expected.length) && actual.every((value, index) => Math.abs(value - expected[index]) <= tolerance);
}

function add(checks, id, result, detail) {
  checks.push({ id, result, detail });
}

export async function validateNeutralHandoff({ candidateRoot, contract }) {
  const checks = [];
  const fail = (id, detail) => add(checks, id, "fail", detail);
  let step;
  let kinematics;
  try {
    step = (await regular(candidateRoot, contract.candidateArtifacts.stepPath)).toString("latin1");
    for (const token of contract.step.requiredHeaderTokens) {
      if (!step.includes(token)) fail("STEP-ENVELOPE", `Missing STEP token ${token}`);
    }
    if (!checks.some(({ id }) => id === "STEP-ENVELOPE")) add(checks, "STEP-ENVELOPE", "pass", "Recognizable ISO 10303-21 static envelope.");
  } catch (error) {
    fail("STEP-ENVELOPE", error instanceof Error ? error.message : "Cannot read STEP");
  }
  try {
    kinematics = JSON.parse((await regular(candidateRoot, contract.candidateArtifacts.kinematicsPath)).toString("utf8"));
  } catch (error) {
    fail("KINEMATICS-JSON", error instanceof Error ? error.message : "Cannot parse kinematics JSON");
    return { status: "invalid", contractId: contract.contractId, checks, limitations: contract.execution.automaticScope };
  }
  const required = contract.kinematics.requiredTopLevelFields;
  const absent = required.filter((field) => !Object.hasOwn(kinematics, field));
  if (kinematics.contractId !== contract.contractId || absent.length) {
    fail("KINEMATICS-SHAPE", `contractId mismatch or missing fields: ${absent.join(", ")}`);
  } else add(checks, "KINEMATICS-SHAPE", "pass", "Contract id and required top-level fields present.");
  const targetById = new Map(contract.kinematics.requiredPoseTargets.map((target) => [target.id, target]));
  const results = Array.isArray(kinematics.requiredPoseResults) ? kinematics.requiredPoseResults : [];
  const resultById = new Map(results.map((item) => [item?.poseId, item]));
  for (const [id, target] of targetById) {
    const result = resultById.get(id);
    if (!result || !equalsVector(result.targetPosition, target.position, contract.kinematics.poseTolerance.position) || !equalsVector(result.targetToolAxis, target.toolAxis, contract.kinematics.poseTolerance.toolAxis)) {
      fail(`POSE-${id}`, "Missing fixed pose or target vector differs from the frozen contract.");
    }
  }
  if (!checks.some(({ id }) => id.startsWith("POSE-") && id !== "POSE-")) add(checks, "POSE-TARGETS", "pass", "All required fixed pose identities and targets are present.");
  const limits = new Map((Array.isArray(kinematics.jointLimits) ? kinematics.jointLimits : []).map((limit) => [limit?.jointId, limit]));
  const topology = Array.isArray(kinematics.jointTopology) ? kinematics.jointTopology : [];
  const movable = topology.filter(({ kind }) => kind !== "fixed").map(({ id }) => id);
  let limitsValid = true;
  for (const id of movable) {
    const limit = limits.get(id);
    if (!limit || !Number.isFinite(limit.minimum) || !Number.isFinite(limit.maximum) || limit.minimum > limit.maximum) limitsValid = false;
    for (const result of results) {
      const values = new Map((result?.jointValues ?? []).map((value) => [value?.jointId, value?.value]));
      const value = values.get(id);
      if (!Number.isFinite(value) || !limit || value < limit.minimum || value > limit.maximum) limitsValid = false;
    }
  }
  add(checks, "JOINT-LIMITS", limitsValid ? "pass" : "fail", limitsValid ? "Declared pose values lie inside declared joint limits." : "A movable joint limit or required pose value is invalid/out of range.");
  const refs = new Set((kinematics.geometryReferences ?? []).map(({ id }) => id));
  const missingRefs = contract.kinematics.requiredGeometryReferenceIds.filter((id) => !refs.has(id));
  add(checks, "GEOMETRY-REFERENCES", missingRefs.length ? "fail" : "pass", missingRefs.length ? `Missing fixed geometry references: ${missingRefs.join(", ")}` : "All required fixed geometry references are declared.");
  const trajectory = kinematics.trajectory ?? {};
  const segments = Array.isArray(trajectory.segments) ? trajectory.segments : [];
  const knownPoses = new Set(targetById.keys());
  const duration = segments.reduce((sum, segment) => sum + (Number.isFinite(segment?.durationSeconds) ? segment.durationSeconds : NaN), 0);
  const trajectoryValid = segments.length > 0 && Number.isFinite(duration) && Number.isFinite(trajectory.declaredCycleSeconds) && Math.abs(duration - trajectory.declaredCycleSeconds) <= 0.001 && segments.every((segment) => knownPoses.has(segment?.fromPoseId) && knownPoses.has(segment?.toPoseId) && Number.isFinite(segment?.durationSeconds) && segment.durationSeconds >= 0);
  add(checks, "TRAJECTORY-ARITHMETIC", trajectoryValid ? "pass" : "fail", trajectoryValid ? `Declared cycle is ${duration.toFixed(3)} s; this is arithmetic only, not a feasibility pass.` : "Trajectory fields or arithmetic are invalid.");
  const budget = kinematics.repeatabilityBudget ?? {};
  const components = Array.isArray(budget.components) ? budget.components : [];
  const rss = Math.sqrt(components.reduce((sum, component) => sum + (Number.isFinite(component?.valueMm) && component.valueMm >= 0 ? component.valueMm ** 2 : NaN), 0));
  const budgetValid = components.length > 0 && Number.isFinite(rss) && Number.isFinite(budget.rssMm) && Math.abs(rss - budget.rssMm) <= 0.0001;
  add(checks, "REPEATABILITY-ARITHMETIC", budgetValid ? "pass" : "fail", budgetValid ? "Declared RSS arithmetic is internally consistent; no physical repeatability claim is made." : "Repeatability budget fields or RSS arithmetic are invalid.");
  return { status: checks.every(({ result }) => result === "pass") ? "valid" : "invalid", contractId: contract.contractId, checks, limitations: contract.execution.automaticScope };
}

async function main() {
  const candidateRoot = argument("--candidate-root");
  const contractPath = argument("--contract");
  const contract = JSON.parse(await readFile(contractPath, "utf8"));
  const report = await validateNeutralHandoff({ candidateRoot, contract });
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = report.status === "valid" ? 0 : 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
