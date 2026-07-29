// Deliberately self-contained: this exact file is copied into the candidate
// workspace from the frozen execution contract and must not resolve host or
// repository modules.
import { createHash } from "node:crypto";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";

const receiptPath = "candidate-workspace-receipt.json";
const candidateReceiptPath = "candidate-output/workspace-receipt.json";
const policyPath = "isolation-policy.json";
const assurance = "operator-harness-attested-not-cryptographic-proof";
const prohibitedPrefixes = [
  "runs/",
  "cohorts/",
  "publications/",
  "results/",
  "submissions/",
  "evaluation/private/",
];

function argument(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

function safeRelative(value) {
  return typeof value === "string"
    && /^[A-Za-z0-9][A-Za-z0-9._-]*(?:\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/.test(value);
}

function exactKeys(value, expected) {
  return value
    && typeof value === "object"
    && !Array.isArray(value)
    && Object.keys(value).sort().join("\u0000") === [...expected].sort().join("\u0000");
}

async function directory(root) {
  const info = await lstat(root);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("workspace root must be a real directory");
  return realpath(root);
}

async function regularFile(root, relativePath) {
  if (!safeRelative(relativePath)) throw new Error(`unsafe path: ${relativePath}`);
  const absolute = path.resolve(root, relativePath);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`unsafe path: ${relativePath}`);
  const info = await lstat(absolute);
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`not a regular file: ${relativePath}`);
  const resolved = await realpath(absolute);
  if (!resolved.startsWith(`${root}${path.sep}`)) throw new Error(`path escapes workspace: ${relativePath}`);
  return readFile(absolute);
}

function receiptShapeIssues(receipt) {
  const issues = [];
  const source = receipt?.source ?? {};
  const taskPacket = source.taskPacket ?? {};
  if (!exactKeys(receipt, ["schemaVersion", "kind", "createdAt", "source", "cleanRoot", "isolation", "materializedFiles"])) {
    issues.push("receipt has an unexpected shape");
    return issues;
  }
  if (receipt.schemaVersion !== "1.0" || receipt.kind !== "candidate-workspace-receipt") issues.push("receipt identity is invalid");
  if (!Number.isFinite(Date.parse(receipt.createdAt ?? ""))) issues.push("receipt createdAt is invalid");
  if (!exactKeys(receipt.source, ["launchId", "canonicalBaseUrl", "launchDigest", "promptSha256", "executionContractDigest", "taskPacket", "workspaceBootstrap"])) issues.push("receipt source binding is invalid");
  const hash = (value) => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(source.launchId ?? "") || !/^https:\/\/[^/?#]+(?:\/[A-Za-z0-9._~-]+)*$/.test(source.canonicalBaseUrl ?? "") || ![source.launchDigest, source.promptSha256, source.executionContractDigest].every(hash)) issues.push("receipt launch digest or canonical base URL is invalid");
  if (!exactKeys(taskPacket, ["id", "version", "digest", "bundleDigest"]) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(taskPacket.id ?? "") || !safeRelative(taskPacket.version ?? "") || ![taskPacket.digest, taskPacket.bundleDigest].every(hash)) issues.push("receipt task packet binding is invalid");
  if (!exactKeys(source.workspaceBootstrap, ["kind", "location", "sha256"]) || source.workspaceBootstrap?.kind !== "public-bundle" || !hash(source.workspaceBootstrap?.sha256)) issues.push("receipt workspace bootstrap binding is invalid");
  let bootstrapFile = "";
  try {
    const location = new URL(source.workspaceBootstrap?.location);
    bootstrapFile = location.pathname.split("/").at(-1);
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]*\.json$/.test(bootstrapFile)) throw new Error("unsafe bootstrap file");
  } catch {
    issues.push("receipt workspace bootstrap location is invalid");
  }
  if (!exactKeys(receipt.cleanRoot, ["assertion", "targetExistedBeforeMaterialization", "atomicInstall", "symlinksRejected"])) issues.push("receipt clean-root assertion is invalid");
  if (receipt.cleanRoot?.assertion !== "target-did-not-exist-before-atomic-materialization" || receipt.cleanRoot?.targetExistedBeforeMaterialization !== false || receipt.cleanRoot?.atomicInstall !== true || receipt.cleanRoot?.symlinksRejected !== true) issues.push("receipt clean-root values are invalid");
  if (!exactKeys(receipt.isolation, ["policyPath", "policySha256", "enforcementAssurance", "enforcementStatement", "sourceAllowlist", "prohibitedSourcePrefixes"])) issues.push("receipt isolation binding is invalid");
  if (receipt.isolation?.policyPath !== policyPath || receipt.isolation?.enforcementAssurance !== assurance) issues.push("receipt isolation policy binding is invalid");
  if (JSON.stringify(receipt.isolation?.prohibitedSourcePrefixes) !== JSON.stringify(prohibitedPrefixes)) issues.push("receipt prohibited-source policy is invalid");
  const expectedAllowlist = bootstrapFile
    ? [
      `launches/${source.launchId}/`,
      `launches/${source.launchId}/execution-contract/`,
      `task-packets/${taskPacket.id}/${taskPacket.version}/`,
      `workspace-bootstrap/${bootstrapFile}`,
    ]
    : [];
  if (JSON.stringify(receipt.isolation?.sourceAllowlist) !== JSON.stringify(expectedAllowlist)) issues.push("receipt source allowlist is invalid");
  if (!Array.isArray(receipt.materializedFiles) || receipt.materializedFiles.length === 0) issues.push("receipt has no materialized file declarations");
  const paths = new Set();
  let inputCount = 0;
  for (const file of receipt.materializedFiles ?? []) {
    if (!exactKeys(file, ["path", "sha256", "sizeBytes", "source"]) || !safeRelative(file.path) || !hash(file.sha256) || !Number.isInteger(file.sizeBytes) || file.sizeBytes < 0 || !exactKeys(file.source, ["kind", "path"]) || !safeRelative(file.source?.path)) {
      issues.push("receipt materialized file declaration is invalid");
      continue;
    }
    if (paths.has(file.path)) issues.push(`duplicate materialized file declaration: ${file.path}`);
    paths.add(file.path);
    const sourcePath = file.source.path;
    const sourceAllowed = (
      (file.source.kind === "launch" && sourcePath.startsWith(`launches/${source.launchId}/`))
      || (file.source.kind === "execution-contract" && sourcePath.startsWith(`launches/${source.launchId}/execution-contract/`))
      || (file.source.kind === "packet" && sourcePath.startsWith(`task-packets/${taskPacket.id}/${taskPacket.version}/`))
      || (file.source.kind === "workspace-bootstrap" && sourcePath === `workspace-bootstrap/${bootstrapFile}`)
      || (file.source.kind === "generated-policy" && sourcePath === "generated/isolation-policy" && file.path === policyPath)
    );
    if (!sourceAllowed) issues.push(`receipt materialized source is outside the exact source boundary: ${sourcePath}`);
    if (file.source.kind === "packet" && sourcePath.includes("/inputs/")) inputCount += 1;
  }
  if (inputCount !== 19) issues.push("receipt does not bind exactly the declared 19 task inputs");
  if (!paths.has(policyPath)) issues.push("receipt does not bind isolation-policy.json");
  return issues;
}

async function main() {
  const root = await directory(path.resolve(argument("--root") || process.cwd()));
  const requirePlan = process.argv.includes("--require-plan");
  const issues = [];
  let receiptBytes;
  let receipt;
  try {
    receiptBytes = await regularFile(root, receiptPath);
    const copiedReceiptBytes = await regularFile(root, candidateReceiptPath);
    if (!copiedReceiptBytes.equals(receiptBytes)) issues.push("candidate-output/workspace-receipt.json must exactly equal candidate-workspace-receipt.json");
    receipt = JSON.parse(receiptBytes.toString("utf8"));
    issues.push(...receiptShapeIssues(receipt));
  } catch (error) {
    issues.push(error instanceof Error ? error.message : "receipt cannot be read");
  }
  let policy;
  if (receipt?.isolation?.policyPath === policyPath) {
    try {
      const policyBytes = await regularFile(root, policyPath);
      if (sha256(policyBytes) !== receipt.isolation.policySha256) issues.push("isolation policy SHA-256 differs from the receipt");
      policy = JSON.parse(policyBytes.toString("utf8"));
      if (!exactKeys(policy, ["schemaVersion", "kind", "launchId", "allowedAccess", "accessPrecedence", "allowedRotorBenchUrls", "deniedRotorBenchPrefixes", "enforcementAssurance", "enforcementStatement"])) issues.push("isolation policy has an unexpected shape");
      if (policy?.schemaVersion !== "1.0" || policy?.kind !== "candidate-workspace-isolation-policy" || policy?.launchId !== receipt.source?.launchId) issues.push("isolation policy does not bind the receipt launch");
      const allowedLaunchUrl = `${receipt.source?.canonicalBaseUrl}/launch/${receipt.source?.launchId}/`;
      const denied = [
        `${receipt.source?.canonicalBaseUrl}/`,
        "https://github.com/naoyamd/rotorbench",
        "https://raw.githubusercontent.com/naoyamd/rotorbench/",
      ];
      if (policy?.enforcementAssurance !== assurance || policy?.accessPrecedence !== "allow-exact-rotorbench-launch-url-over-denied-prefixes" || JSON.stringify(policy?.allowedRotorBenchUrls) !== JSON.stringify([allowedLaunchUrl]) || JSON.stringify(policy?.deniedRotorBenchPrefixes) !== JSON.stringify(denied)) issues.push("isolation policy is incomplete");
    } catch (error) {
      issues.push(error instanceof Error ? error.message : "isolation policy cannot be read");
    }
  }
  const seen = new Set();
  for (const file of receipt?.materializedFiles ?? []) {
    if (!exactKeys(file, ["path", "sha256", "sizeBytes", "source"]) || !safeRelative(file.path) || !exactKeys(file.source, ["kind", "path"]) || !safeRelative(file.source?.path)) {
      issues.push("receipt materialized file declaration is invalid");
      continue;
    }
    if (seen.has(file.path)) {
      issues.push(`duplicate materialized file declaration: ${file.path}`);
      continue;
    }
    seen.add(file.path);
    try {
      const bytes = await regularFile(root, file.path);
      if (sha256(bytes) !== file.sha256 || bytes.length !== file.sizeBytes) issues.push(`materialized file hash or size differs: ${file.path}`);
    } catch (error) {
      issues.push(error instanceof Error ? error.message : `cannot read ${file.path}`);
    }
    if (prohibitedPrefixes.some((prefix) => file.source.path.startsWith(prefix))) issues.push(`prohibited source declared: ${file.source.path}`);
  }
  if (requirePlan) {
    try {
      JSON.parse((await regularFile(root, "candidate-output/plan.json")).toString("utf8"));
    } catch {
      issues.push("candidate-output/plan.json must exist and be valid JSON before the initial-plan checkpoint");
    }
  }
  const result = {
    status: issues.length === 0 ? "valid" : "invalid",
    issues,
    ...(receiptBytes ? { receiptSha256: sha256(receiptBytes) } : {}),
    materializedFileCount: receipt?.materializedFiles?.length ?? 0,
    planRequired: requirePlan,
    externalAccessAssertion: "not-verified; policy enforcement remains operator/harness-attested and is not cryptographic proof",
    ...(policy ? { enforcementAssurance: policy.enforcementAssurance } : {}),
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.status !== "valid") process.exitCode = 1;
}

await main();
