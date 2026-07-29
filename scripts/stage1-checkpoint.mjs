import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInside, sha256, validatePlan } from "./framework-lib.mjs";

function argument(name, { required = false } = {}) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (required && !value) throw new Error(`Missing required argument ${name}`);
  return value;
}

async function readEvidence(root, relativePath) {
  const target = ensureInside(root, relativePath);
  if (!target) throw new Error(`Unsafe evidence path: ${relativePath}`);
  const stats = await lstat(target);
  if (!stats.isFile() || stats.isSymbolicLink()) {
    throw new Error(`Evidence must be a regular, non-link file: ${relativePath}`);
  }
  const bytes = await readFile(target);
  return { path: relativePath, sha256: sha256(bytes) };
}

const rootValue = argument("--root");
const root = rootValue ? path.resolve(rootValue) : path.resolve("candidate-output");
const checkpointId = argument("--checkpoint");
const planPath = path.join(root, "plan.json");
const planData = await readFile(planPath);
const plan = JSON.parse(planData.toString("utf8"));
const issues = validatePlan(plan);
if (issues.length > 0) {
  for (const issue of issues) console.error(issue.message);
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
  const receiptsRoot = path.join(root, "receipts");
  await mkdir(receiptsRoot, { recursive: true });
  const entries = (await readdir(receiptsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isFile() && /^\d{3,}-CKPT-[0-9]{3,}\.json$/.test(entry.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const sequence = entries.length;
  const previousReceiptSha256 = entries.length === 0
    ? "0".repeat(64)
    : sha256(await readFile(path.join(receiptsRoot, entries.at(-1).name)));
  const evidenceArgs = [];
  for (let index = 0; index < process.argv.length; index += 1) {
    if (process.argv[index] === "--evidence" && process.argv[index + 1]) {
      evidenceArgs.push(process.argv[index + 1]);
    }
  }
  const evidencePaths = [...new Set(["plan.json", ...evidenceArgs])];
  const evidence = [];
  for (const relativePath of evidencePaths) evidence.push(await readEvidence(root, relativePath));
  const receipt = {
    schemaVersion: "1.0",
    id: `RCP-${String(sequence).padStart(3, "0")}`,
    sequence,
    checkpointId,
    previousReceiptSha256,
    createdAt: argument("--at") || new Date().toISOString(),
    ...(changeEventId ? { changeEventId } : {}),
    evidence,
  };
  const receiptName = `${String(sequence).padStart(3, "0")}-${checkpointId}.json`;
  const receiptPath = path.join(receiptsRoot, receiptName);
  await writeFile(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" });
  console.log(JSON.stringify({
    id: receipt.id,
    sequence,
    checkpointId,
    path: `receipts/${receiptName}`,
    sha256: sha256(await readFile(receiptPath)),
    previousReceiptSha256,
  }));
}
