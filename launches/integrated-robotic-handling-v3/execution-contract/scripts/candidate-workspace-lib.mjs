import { createHash, randomBytes } from "node:crypto";
import {
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import {
  ensureInside,
  isSafeRelativePath,
  manifestDigest,
  pathExists,
  validateLiveVerification,
} from "./framework-lib.mjs";
import {
  validateFrozenPacket,
  validateLaunchFreeze,
  validateLiveVerificationBindings,
} from "./stage0-lib.mjs";

const moduleRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const receiptPath = "candidate-workspace-receipt.json";
const candidateReceiptPath = "candidate-output/workspace-receipt.json";
const isolationPolicyPath = "isolation-policy.json";
const enforcementAssurance = "operator-harness-attested-not-cryptographic-proof";
const enforcementStatement = "This record is an operator/harness attestation of the intended access boundary. It verifies only local materialization bytes and is not cryptographic proof that an external service, browser, or network policy was enforced.";
const policyStatement = "The operator or harness must expose the exact materialized launch and framework assets plus ordinary public technical research, and must deny the listed RotorBench surfaces during the candidate session. This file records that intended boundary; it does not enforce or cryptographically prove external access control.";
const accessPrecedence = "allow-exact-rotorbench-launch-url-over-denied-prefixes";
const prohibitedSourcePrefixes = Object.freeze([
  "runs/",
  "cohorts/",
  "publications/",
  "results/",
  "submissions/",
  "evaluation/private/",
]);

const schemaFiles = Object.freeze([
  "schemas/artifact.schema.json",
  "schemas/task-packet.schema.json",
  "schemas/launch.schema.json",
  "schemas/plan.schema.json",
  "schemas/work-record.schema.json",
  "schemas/submission.schema.json",
  "schemas/stage-contract-v4.schema.json",
  "schemas/candidate-workspace-isolation-policy.schema.json",
  "schemas/candidate-workspace-receipt.schema.json",
]);
const preflightContractPath = "scripts/candidate-workspace-preflight.mjs";

const [artifactSchema, isolationSchema, receiptSchema] = await Promise.all([
  readFile(path.join(moduleRoot, "schemas", "artifact.schema.json"), "utf8").then(JSON.parse),
  readFile(path.join(moduleRoot, "schemas", "candidate-workspace-isolation-policy.schema.json"), "utf8").then(JSON.parse),
  readFile(path.join(moduleRoot, "schemas", "candidate-workspace-receipt.schema.json"), "utf8").then(JSON.parse),
]);
const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
for (const schema of [artifactSchema, isolationSchema, receiptSchema]) ajv.addSchema(schema);
const validatePolicySchema = ajv.getSchema(isolationSchema.$id);
const validateReceiptSchema = ajv.getSchema(receiptSchema.$id);
if (typeof validatePolicySchema !== "function" || typeof validateReceiptSchema !== "function") {
  throw new Error("Candidate workspace schemas could not compile");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function schemaMessages(validator, value) {
  if (validator(value)) return [];
  return (validator.errors ?? []).map((entry) => (
    `${entry.instancePath || "receipt"} ${entry.message ?? "is invalid"}`
  ));
}

function assertSafeRelative(value, label) {
  if (!isSafeRelativePath(value)) throw new Error(`${label} must be a safe relative path`);
  return value;
}

function sameStrings(left, right) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

async function safeRegularFile(root, relativePath) {
  assertSafeRelative(relativePath, "Source path");
  const candidate = ensureInside(root, relativePath);
  if (!candidate) throw new Error(`Unsafe source path: ${relativePath}`);
  const info = await lstat(candidate);
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error(`Source must be a regular non-link file: ${relativePath}`);
  }
  const [resolvedRoot, resolvedCandidate] = await Promise.all([
    realpath(root),
    realpath(candidate),
  ]);
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Source escapes its declared root: ${relativePath}`);
  }
  const bytes = await readFile(candidate);
  return { absolute: candidate, bytes, sha256: sha256(bytes) };
}

async function safeDirectory(directory, label) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`${label} must be a real directory, not a symbolic link`);
  }
  return realpath(directory);
}

function inputFileNameFromBootstrapLocation(location) {
  let url;
  try {
    url = new URL(location);
  } catch {
    throw new Error("Launch workspace bootstrap location is not a valid URL");
  }
  const name = url.pathname.split("/").at(-1);
  if (!name || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(name)) {
    throw new Error("Launch workspace bootstrap location does not name a safe JSON bundle");
  }
  return name;
}

function exactPolicy(launchId, canonicalBaseUrl) {
  return {
    schemaVersion: "1.0",
    kind: "candidate-workspace-isolation-policy",
    launchId,
    allowedAccess: [
      "The exact materialized launch and framework assets in this workspace.",
      "Ordinary public technical research available equally to every candidate.",
    ],
    accessPrecedence,
    allowedRotorBenchUrls: [`${canonicalBaseUrl}/launch/${launchId}/`],
    deniedRotorBenchPrefixes: [
      `${canonicalBaseUrl}/`,
      "https://github.com/naoyamd/rotorbench",
      "https://raw.githubusercontent.com/naoyamd/rotorbench/",
    ],
    enforcementAssurance,
    enforcementStatement: policyStatement,
  };
}

function validatePolicy(policy, launchId, canonicalBaseUrl) {
  const issues = schemaMessages(validatePolicySchema, policy);
  if (policy?.launchId !== launchId) issues.push("policy launchId does not match the receipt source");
  if (
    policy?.accessPrecedence !== accessPrecedence
    || !sameStrings(policy?.allowedRotorBenchUrls ?? [], [`${canonicalBaseUrl}/launch/${launchId}/`])
    || !sameStrings(policy?.deniedRotorBenchPrefixes ?? [], [
      `${canonicalBaseUrl}/`,
      "https://github.com/naoyamd/rotorbench",
      "https://raw.githubusercontent.com/naoyamd/rotorbench/",
    ])
  ) {
    issues.push("policy RotorBench allow/deny boundary differs from the fixed exact-launch policy");
  }
  if (
    policy?.enforcementAssurance !== enforcementAssurance
    || policy?.enforcementStatement !== policyStatement
  ) {
    issues.push("policy enforcement statement differs from the fixed non-cryptographic assurance");
  }
  return issues;
}

function strictReceiptChecks(receipt) {
  const issues = schemaMessages(validateReceiptSchema, receipt);
  const paths = new Set();
  const launchId = receipt?.source?.launchId;
  const packet = receipt?.source?.taskPacket;
  let bootstrapFileName = "";
  try {
    bootstrapFileName = inputFileNameFromBootstrapLocation(receipt?.source?.workspaceBootstrap?.location);
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "receipt workspace bootstrap location is invalid");
  }
  const expectedAllowlist = (
    typeof launchId === "string"
    && packet?.id
    && packet?.version
    && bootstrapFileName
  )
    ? expectedSourceAllowlist({
      launchId,
      packet,
      bootstrapPath: `workspace-bootstrap/${bootstrapFileName}`,
    })
    : [];
  if (!sameStrings(receipt?.isolation?.sourceAllowlist ?? [], expectedAllowlist)) {
    issues.push("receipt source allowlist does not exactly bind the launch, packet, and bootstrap sources");
  }
  let inputCount = 0;
  for (const file of receipt?.materializedFiles ?? []) {
    if (paths.has(file.path)) issues.push(`duplicate materialized path: ${file.path}`);
    paths.add(file.path);
    const sourcePath = file?.source?.path;
    const sourceKind = file?.source?.kind;
    const allowed = (() => {
      if (sourceKind === "generated-policy") {
        return file.path === isolationPolicyPath && sourcePath === "generated/isolation-policy";
      }
      if (sourceKind === "launch") return sourcePath?.startsWith(`launches/${launchId}/`);
      if (sourceKind === "packet") return sourcePath?.startsWith(`task-packets/${packet?.id}/${packet?.version}/`);
      if (sourceKind === "workspace-bootstrap") return sourcePath === `workspace-bootstrap/${bootstrapFileName}`;
      if (sourceKind === "execution-contract") return sourcePath?.startsWith(`launches/${launchId}/execution-contract/`);
      return false;
    })();
    if (!allowed) issues.push(`receipt materialized source is outside the exact source boundary: ${sourcePath}`);
    if (sourceKind === "packet" && sourcePath?.includes("/inputs/")) inputCount += 1;
  }
  if (inputCount !== 19) issues.push("receipt does not bind exactly the declared 19 task inputs");
  if (!paths.has(isolationPolicyPath)) issues.push("receipt does not bind isolation-policy.json");
  if (!sameStrings(receipt?.isolation?.prohibitedSourcePrefixes ?? [], prohibitedSourcePrefixes)) {
    issues.push("receipt prohibited source prefix list differs from the fixed boundary");
  }
  if (receipt?.isolation?.enforcementAssurance !== enforcementAssurance) {
    issues.push("receipt enforcement assurance is not the required operator/harness attestation");
  }
  if (receipt?.isolation?.enforcementStatement !== enforcementStatement) {
    issues.push("receipt enforcement statement is not the required non-cryptographic statement");
  }
  return issues;
}

function workspaceReceiptBindingIssues(
  receipt,
  { launch, profile, authorization } = {},
) {
  const issues = [...strictReceiptChecks(receipt)];
  const source = receipt?.source;
  if (
    source?.launchId !== launch?.id
    || source?.canonicalBaseUrl !== launch?.canonicalBaseUrl
    || source?.launchDigest !== launch?.launchDigest
    || source?.promptSha256 !== launch?.promptSha256
    || source?.executionContractDigest !== launch?.executionContractDigest
  ) {
    issues.push("workspace receipt does not bind the exact frozen launch");
  }
  const sourcePacket = source?.taskPacket;
  const launchPacket = launch?.taskPacket;
  if (
    sourcePacket?.id !== launchPacket?.id
    || sourcePacket?.version !== launchPacket?.version
    || sourcePacket?.digest !== launchPacket?.digest
    || sourcePacket?.bundleDigest !== launchPacket?.bundleDigest
  ) {
    issues.push("workspace receipt does not bind the exact frozen task packet");
  }
  const sourceBootstrap = source?.workspaceBootstrap;
  const launchBootstrap = launch?.workspaceBootstrap;
  if (
    sourceBootstrap?.kind !== launchBootstrap?.kind
    || sourceBootstrap?.location !== launchBootstrap?.location
    || sourceBootstrap?.sha256 !== launchBootstrap?.sha256
  ) {
    issues.push("workspace receipt does not bind the exact workspace bootstrap");
  }
  const requiredAssurance =
    profile?.extensions?.candidateWorkspaceIsolationAssurance;
  if (
    requiredAssurance
    && receipt?.isolation?.enforcementAssurance !== requiredAssurance
  ) {
    issues.push("workspace receipt does not use the execution profile's isolation assurance");
  }
  if (
    authorization
    && (
      Number.isNaN(Date.parse(receipt?.createdAt ?? ""))
      || Number.isNaN(Date.parse(authorization?.issuedAt ?? ""))
      || Date.parse(receipt.createdAt) > Date.parse(authorization.issuedAt)
    )
  ) {
    issues.push("workspace receipt must be created no later than the pre-run authorization");
  }
  return issues;
}

async function validateLiveLaunch(projectRoot, launchId) {
  const frozen = await validateLaunchFreeze(projectRoot, launchId);
  if (frozen.status !== "valid") {
    throw new Error(`Frozen launch is invalid: ${frozen.issues.map(({ message }) => message).join("; ")}`);
  }
  if (frozen.release?.status !== "live-verified") {
    throw new Error("Candidate workspace initialization requires a live-verified launch");
  }
  const verification = JSON.parse((await safeRegularFile(frozen.root, "live-verification.json")).bytes.toString("utf8"));
  const verificationIssues = [
    ...validateLiveVerification(verification).map(({ message }) => message),
    ...(await validateLiveVerificationBindings(frozen.root, frozen.launch, verification))
      .map(({ message }) => message),
  ];
  if (
    frozen.release.liveVerificationDigest !== manifestDigest(verification)
    || verification.status !== "verified"
  ) {
    verificationIssues.push("live verification digest or status is not bound by release.json");
  }
  if (verificationIssues.length > 0) {
    throw new Error(`Live verification is invalid: ${verificationIssues.join("; ")}`);
  }
  return { ...frozen, verification };
}

async function parseBootstrap(projectRoot, launch) {
  const bootstrap = launch.workspaceBootstrap;
  if (!bootstrap || bootstrap.kind !== "public-bundle") {
    throw new Error("Candidate workspace initialization requires a public workspace bootstrap bundle");
  }
  const fileName = inputFileNameFromBootstrapLocation(bootstrap.location);
  const sourcePath = `workspace-bootstrap/${fileName}`;
  const file = await safeRegularFile(projectRoot, sourcePath);
  if (file.sha256 !== bootstrap.sha256) {
    throw new Error("Workspace bootstrap bytes do not match the live launch binding");
  }
  let bundle;
  try {
    bundle = JSON.parse(file.bytes.toString("utf8"));
  } catch {
    throw new Error("Workspace bootstrap is not valid JSON");
  }
  if (bundle?.schemaVersion !== "1.0" || !Array.isArray(bundle.files) || bundle.files.length === 0) {
    throw new Error("Workspace bootstrap bundle has an invalid shape");
  }
  const paths = new Set();
  for (const entry of bundle.files) {
    if (!entry || typeof entry.content !== "string" || !isSafeRelativePath(entry.path)) {
      throw new Error("Workspace bootstrap contains an unsafe file entry");
    }
    if (paths.has(entry.path)) throw new Error(`Workspace bootstrap duplicates ${entry.path}`);
    paths.add(entry.path);
  }
  return { bundle, sourcePath, file };
}

function expectedSourceAllowlist({ launchId, packet, bootstrapPath }) {
  return [
    `launches/${launchId}/`,
    `launches/${launchId}/execution-contract/`,
    `task-packets/${packet.id}/${packet.version}/`,
    `${bootstrapPath}`,
  ];
}

function assertAllowedSource(relativePath, allowlist) {
  if (!allowlist.some((prefix) => relativePath === prefix || relativePath.startsWith(prefix))) {
    throw new Error(`Source is outside the candidate workspace allowlist: ${relativePath}`);
  }
  if (prohibitedSourcePrefixes.some((prefix) => relativePath.startsWith(prefix))) {
    throw new Error(`Prohibited source path cannot be materialized: ${relativePath}`);
  }
}

function addRecord(records, record) {
  assertSafeRelative(record.targetPath, "Workspace target path");
  assertSafeRelative(record.source.path, "Materialization source path");
  if (records.some((entry) => entry.targetPath === record.targetPath)) {
    throw new Error(`Two source records target ${record.targetPath}`);
  }
  records.push(record);
}

async function buildMaterializationRecords({ projectRoot, frozen, packet, bootstrap }) {
  const records = [];
  const allowlist = expectedSourceAllowlist({
    launchId: frozen.launch.id,
    packet: frozen.launch.taskPacket,
    bootstrapPath: bootstrap.sourcePath,
  });
  const addProjectFile = async ({ targetPath, sourcePath, kind, expectedSha256 = null }) => {
    assertAllowedSource(sourcePath, allowlist);
    const file = await safeRegularFile(projectRoot, sourcePath);
    if (expectedSha256 && file.sha256 !== expectedSha256) {
      throw new Error(`Hash mismatch for launch-bound source ${sourcePath}`);
    }
    addRecord(records, {
      targetPath,
      bytes: file.bytes,
      source: { kind, path: sourcePath },
      recheck: { absolute: file.absolute, sha256: file.sha256 },
    });
  };

  for (const entry of bootstrap.bundle.files) {
    addRecord(records, {
      targetPath: entry.path,
      bytes: Buffer.from(entry.content, "utf8"),
      source: { kind: "workspace-bootstrap", path: bootstrap.sourcePath },
      recheck: { absolute: bootstrap.file.absolute, sha256: bootstrap.file.sha256 },
    });
  }

  for (const [targetPath, fileName] of [
    ["launch/launch.json", "launch.json"],
    ["launch/prompt.txt", "prompt.txt"],
    ["launch/release.json", "release.json"],
    ["launch/live-verification.json", "live-verification.json"],
    ["launch/execution-profile.json", "execution-profile.json"],
    ["launch/execution-contract/contract.json", "execution-contract/contract.json"],
  ]) {
    await addProjectFile({
      targetPath,
      sourcePath: `launches/${frozen.launch.id}/${fileName}`,
      kind: "launch",
    });
  }

  const packetRoot = `task-packets/${frozen.launch.taskPacket.id}/${frozen.launch.taskPacket.version}`;
  for (const [targetPath, fileName] of [
    ["task/task.json", "task.json"],
    ["task/packet.json", "packet.json"],
    ["task/packet-lock.json", "packet-lock.json"],
    ["task/TASK.md", packet.packet.instructions.path],
  ]) {
    await addProjectFile({ targetPath, sourcePath: `${packetRoot}/${fileName}`, kind: "packet" });
  }
  for (const input of packet.packet.inputs) {
    await addProjectFile({
      targetPath: `task/${input.path}`,
      sourcePath: `${packetRoot}/${input.path}`,
      kind: "packet",
      expectedSha256: input.sha256,
    });
  }

  const contractFiles = new Set(frozen.contractSnapshot.contract?.files ?? []);
  const requiredContractFiles = [...schemaFiles, preflightContractPath];
  for (const contractPath of requiredContractFiles) {
    if (!contractFiles.has(contractPath)) {
      throw new Error(`Frozen execution contract does not include required candidate helper: ${contractPath}`);
    }
    const targetPath = contractPath === preflightContractPath
      ? "tools/candidate-workspace-preflight.mjs"
      : contractPath;
    await addProjectFile({
      targetPath,
      sourcePath: `launches/${frozen.launch.id}/execution-contract/${contractPath}`,
      kind: "execution-contract",
    });
  }

  const policy = exactPolicy(frozen.launch.id, frozen.launch.canonicalBaseUrl);
  const policyBytes = jsonBytes(policy);
  const policyIssues = validatePolicy(policy, frozen.launch.id, frozen.launch.canonicalBaseUrl);
  if (policyIssues.length > 0) throw new Error(`Generated isolation policy is invalid: ${policyIssues.join("; ")}`);
  addRecord(records, {
    targetPath: isolationPolicyPath,
    bytes: policyBytes,
    source: { kind: "generated-policy", path: "generated/isolation-policy" },
    recheck: null,
  });

  return { records, allowlist, policy, policyBytes };
}

async function writeRecord(stagingRoot, record) {
  const target = ensureInside(stagingRoot, record.targetPath);
  if (!target) throw new Error(`Unsafe materialization target: ${record.targetPath}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, record.bytes, { flag: "wx" });
  const written = await safeRegularFile(stagingRoot, record.targetPath);
  if (written.sha256 !== sha256(record.bytes)) {
    throw new Error(`Materialized bytes changed while writing ${record.targetPath}`);
  }
}

async function recheckSources(records) {
  const checked = new Map();
  for (const record of records) {
    if (!record.recheck || checked.has(record.recheck.absolute)) continue;
    const info = await lstat(record.recheck.absolute);
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new Error("A source changed from a regular file while materializing the workspace");
    }
    const bytes = await readFile(record.recheck.absolute);
    if (sha256(bytes) !== record.recheck.sha256) {
      throw new Error("A launch-bound source changed while materializing the workspace");
    }
    checked.set(record.recheck.absolute, true);
  }
}

async function ensureNoLinks(root, files) {
  for (const entry of files) {
    await safeRegularFile(root, entry.targetPath);
  }
}

async function requireRealChildDirectory(root, relativePath) {
  assertSafeRelative(relativePath, "Required workspace directory");
  const candidate = ensureInside(root, relativePath);
  if (!candidate) throw new Error(`Unsafe required workspace directory: ${relativePath}`);
  const info = await lstat(candidate);
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`Required workspace directory is missing or linked: ${relativePath}`);
  }
  const [resolvedRoot, resolvedCandidate] = await Promise.all([realpath(root), realpath(candidate)]);
  if (!resolvedCandidate.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`Required workspace directory escapes the target: ${relativePath}`);
  }
}

function receiptFor({ frozen, records, allowlist, policyBytes, createdAt }) {
  const receipt = {
    schemaVersion: "1.0",
    kind: "candidate-workspace-receipt",
    createdAt,
    source: {
      launchId: frozen.launch.id,
      canonicalBaseUrl: frozen.launch.canonicalBaseUrl,
      launchDigest: frozen.launch.launchDigest,
      promptSha256: frozen.launch.promptSha256,
      executionContractDigest: frozen.launch.executionContractDigest,
      taskPacket: frozen.launch.taskPacket,
      workspaceBootstrap: frozen.launch.workspaceBootstrap,
    },
    cleanRoot: {
      assertion: "target-did-not-exist-before-atomic-materialization",
      targetExistedBeforeMaterialization: false,
      atomicInstall: true,
      symlinksRejected: true,
    },
    isolation: {
      policyPath: isolationPolicyPath,
      policySha256: sha256(policyBytes),
      enforcementAssurance,
      enforcementStatement,
      sourceAllowlist: allowlist,
      prohibitedSourcePrefixes: [...prohibitedSourcePrefixes],
    },
    materializedFiles: records
      .map((record) => ({
        path: record.targetPath,
        sha256: sha256(record.bytes),
        sizeBytes: record.bytes.length,
        source: record.source,
      }))
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
  const issues = strictReceiptChecks(receipt);
  if (issues.length > 0) throw new Error(`Generated workspace receipt is invalid: ${issues.join("; ")}`);
  return receipt;
}

function targetLocation(targetRoot) {
  const resolved = path.resolve(targetRoot);
  const parent = path.dirname(resolved);
  const name = path.basename(resolved);
  if (!name || name === "." || name === path.parse(resolved).root) {
    throw new Error("Target must name a new child directory, not a filesystem root");
  }
  return { parent, name, resolved };
}

export function assertTargetOutsideProject(projectRoot, targetRoot) {
  const project = path.resolve(projectRoot);
  const target = path.resolve(targetRoot);
  if (target === project || target.startsWith(`${project}${path.sep}`)) {
    throw new Error("Target directory must be outside the RotorBench project root");
  }
}

export async function initializeCandidateWorkspace({
  projectRoot = process.cwd(),
  launchId,
  targetRoot,
  createdAt = new Date().toISOString(),
}) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(launchId ?? "")) {
    throw new Error("launchId must use lowercase kebab-case");
  }
  if (typeof targetRoot !== "string" || targetRoot.length === 0) {
    throw new Error("targetRoot is required");
  }
  if (Number.isNaN(Date.parse(createdAt))) throw new Error("createdAt must be an ISO date-time");
  const canonicalProjectRoot = await safeDirectory(path.resolve(projectRoot), "Project root");
  const frozen = await validateLiveLaunch(canonicalProjectRoot, launchId);
  const packet = await validateFrozenPacket(path.join(
    canonicalProjectRoot,
    "task-packets",
    frozen.launch.taskPacket.id,
    frozen.launch.taskPacket.version,
  ));
  if (packet.status !== "valid") {
    throw new Error(`Launch-bound task packet is invalid: ${packet.issues.map(({ message }) => message).join("; ")}`);
  }
  if (
    packet.lock.packetDigest !== frozen.launch.taskPacket.digest
    || packet.lock.bundleDigest !== frozen.launch.taskPacket.bundleDigest
  ) {
    throw new Error("Launch-bound task packet digests differ from the frozen packet");
  }
  const bootstrap = await parseBootstrap(canonicalProjectRoot, frozen.launch);
  const { records, allowlist, policyBytes } = await buildMaterializationRecords({
    projectRoot: canonicalProjectRoot,
    frozen,
    packet,
    bootstrap,
  });
  if (packet.packet.inputs.length !== 19) {
    throw new Error("This initializer expects the declared 19 public task inputs");
  }
  const copiedInputs = records.filter((record) => record.source.kind === "packet" && record.source.path.includes("/inputs/")).length;
  if (copiedInputs !== packet.packet.inputs.length) {
    throw new Error("Not every declared public task input was materialized");
  }

  const location = targetLocation(targetRoot);
  const canonicalParent = await safeDirectory(location.parent, "Target parent");
  const target = path.join(canonicalParent, location.name);
  assertTargetOutsideProject(canonicalProjectRoot, target);
  if (await pathExists(target)) {
    throw new Error("Target directory already exists; initialization never overwrites an existing directory");
  }
  const staging = path.join(
    canonicalParent,
    `.${location.name}.candidate-workspace-${process.pid}-${randomBytes(8).toString("hex")}`,
  );
  try {
    await mkdir(staging, { recursive: false });
    for (const record of records) await writeRecord(staging, record);
    await ensureNoLinks(staging, records);
    await recheckSources(records);
    const receipt = receiptFor({ frozen, records, allowlist, policyBytes, createdAt });
    const receiptBytes = jsonBytes(receipt);
    await requireRealChildDirectory(staging, "candidate-output");
    await writeFile(path.join(staging, receiptPath), receiptBytes, { flag: "wx" });
    await writeFile(path.join(staging, candidateReceiptPath), receiptBytes, { flag: "wx" });
    const savedReceipt = JSON.parse((await safeRegularFile(staging, receiptPath)).bytes.toString("utf8"));
    const receiptIssues = strictReceiptChecks(savedReceipt);
    if (receiptIssues.length > 0) throw new Error(`Written receipt is invalid: ${receiptIssues.join("; ")}`);
    const savedCandidateReceipt = await safeRegularFile(staging, candidateReceiptPath);
    if (!savedCandidateReceipt.bytes.equals(receiptBytes)) {
      throw new Error("Candidate-output receipt does not exactly equal the root receipt");
    }
    await rename(staging, target);
    const finalReceipt = await safeRegularFile(target, receiptPath);
    const finalCandidateReceipt = await safeRegularFile(target, candidateReceiptPath);
    const finalPolicy = await safeRegularFile(target, isolationPolicyPath);
    if (!finalCandidateReceipt.bytes.equals(finalReceipt.bytes)) {
      throw new Error("Installed candidate-output receipt does not exactly equal the root receipt");
    }
    if (finalPolicy.sha256 !== savedReceipt.isolation.policySha256) {
      throw new Error("Installed isolation policy hash does not match the receipt");
    }
    return {
      launchId,
      target,
      receiptPath,
      receiptSha256: finalReceipt.sha256,
      materializedFileCount: records.length,
      taskInputCount: copiedInputs,
      enforcementAssurance,
    };
  } catch (error) {
    await rm(staging, { recursive: true, force: true });
    throw error;
  }
}

export async function preflightCandidateWorkspace(root, { requirePlan = false } = {}) {
  const canonicalRoot = await safeDirectory(path.resolve(root), "Candidate workspace root");
  const receiptFile = await safeRegularFile(canonicalRoot, receiptPath);
  let candidateReceiptFile;
  try {
    candidateReceiptFile = await safeRegularFile(canonicalRoot, candidateReceiptPath);
  } catch (error) {
    return { status: "invalid", issues: [error instanceof Error ? error.message : "candidate-output receipt cannot be read"] };
  }
  let receipt;
  try {
    receipt = JSON.parse(receiptFile.bytes.toString("utf8"));
  } catch {
    return { status: "invalid", issues: ["candidate workspace receipt is not valid JSON"] };
  }
  const issues = strictReceiptChecks(receipt);
  if (!candidateReceiptFile.bytes.equals(receiptFile.bytes)) {
    issues.push("candidate-output/workspace-receipt.json must exactly equal candidate-workspace-receipt.json");
  }
  let policy;
  try {
    const policyFile = await safeRegularFile(canonicalRoot, receipt.isolation?.policyPath ?? "");
    if (policyFile.sha256 !== receipt.isolation?.policySha256) {
      issues.push("isolation policy SHA-256 differs from the receipt");
    }
    policy = JSON.parse(policyFile.bytes.toString("utf8"));
    issues.push(...validatePolicy(policy, receipt.source?.launchId, receipt.source?.canonicalBaseUrl ?? ""));
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "isolation policy cannot be verified");
  }
  const materialized = receipt.materializedFiles ?? [];
  for (const file of materialized) {
    try {
      const actual = await safeRegularFile(canonicalRoot, file.path);
      if (actual.sha256 !== file.sha256 || actual.bytes.length !== file.sizeBytes) {
        issues.push(`materialized file hash or size differs: ${file.path}`);
      }
      if (prohibitedSourcePrefixes.some((prefix) => file.source?.path?.startsWith(prefix))) {
        issues.push(`receipt declares a prohibited source: ${file.source.path}`);
      }
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `cannot verify ${file.path}`);
    }
  }
  if (requirePlan) {
    try {
      const plan = await safeRegularFile(canonicalRoot, "candidate-output/plan.json");
      JSON.parse(plan.bytes.toString("utf8"));
    } catch {
      issues.push("candidate-output/plan.json must exist and be valid JSON before the initial-plan checkpoint");
    }
  }
  return {
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    receiptSha256: receiptFile.sha256,
    materializedFileCount: materialized.length,
    planRequired: requirePlan,
    externalAccessAssertion: "not-verified; policy enforcement remains operator/harness-attested and is not cryptographic proof",
    ...(policy ? { enforcementAssurance: policy.enforcementAssurance } : {}),
  };
}

export {
  enforcementAssurance,
  candidateReceiptPath,
  isolationPolicyPath,
  receiptPath,
  strictReceiptChecks,
  validatePolicy,
  workspaceReceiptBindingIssues,
};
