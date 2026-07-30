import { createHash } from "node:crypto";
import {
  cp,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import {
  canonicalJson,
  ensureInside,
  isSafeRelativePath,
  sha256,
  validateCohortDisclosure,
  validateCohortEvaluationAggregate,
  validateCohortPublicationBundle,
  validatePublicEvaluationSummary,
  validatePublicRunMetadata,
  validatePublicValidationSummary,
  validateReport,
} from "./framework-lib.mjs";

export const PUBLICATION_MANIFEST = "publication.json";
export const PUBLICATION_DIGEST = "publication.sha256";
const ID_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PROHIBITED_KEY = /(?:review(?:er|audit|package|submission)?|rater|rating|vote|rationale|private(?:path|state)?|sanitized|candidate(?:identity|model)?|modelIdentity)/i;
const PROHIBITED_TEXT = /(?:\brater-[a-f0-9]{16}\b|\breview-[a-f0-9]{16}\b|(?:^|["'\s])(?:runs|cohorts|sanitized)\/|\breview(?:er|audit|package|submission)\b|\brater\b|\brationale\b|\bvote(?:s|d)?\b|private[-_ ]?(?:path|state))/i;
const ACTIVE_MEDIA = /^(?:text\/html|application\/(?:javascript|x-javascript|ecmascript)|image\/svg\+xml)$/i;

function canonicalBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
}

function failure(label, issues) {
  const detail = issues.map((issue) => `${issue.code ?? "invalid"}: ${issue.message ?? issue}`).join("\n");
  return new Error(`${label}${detail ? `:\n${detail}` : ""}`);
}

function strictJson(bytes, label) {
  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    throw new Error(`${label} must be strict UTF-8 JSON`);
  }
}

function requireSafePath(value, label) {
  if (!isSafeRelativePath(value)) throw new Error(`${label} has an unsafe path`);
  return value;
}

function noForbiddenContent(value, label, { allowModelDisclosure = false } = {}) {
  const walk = (node, pathLabel = "") => {
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${pathLabel}[${index}]`));
      return;
    }
    if (node && typeof node === "object") {
      for (const [key, child] of Object.entries(node)) {
        const isAllowedDisclosureKey = allowModelDisclosure
          && (key === "model" || key === "provider" || key === "name" || key === "version" || key === "reasoningSetting" || key === "policy");
        // v1.10 publishes this aggregate evaluator result, not an individual
        // reviewer rating. Keep the broad rating-family rejection for every
        // other key (including `rating` and `ratings`), and only permit the
        // schema-defined field at its exact public dimension location.
        const isAllowedPublicEvaluationKey = key === "ratingStatus"
          && /^dimensions\[\d+\]$/.test(pathLabel)
          && (child === "scored" || child === "not-evaluable");
        if (!isAllowedDisclosureKey && !isAllowedPublicEvaluationKey && PROHIBITED_KEY.test(key)) {
          throw new Error(`${label} contains prohibited field ${pathLabel ? `${pathLabel}.` : ""}${key}`);
        }
        walk(child, pathLabel ? `${pathLabel}.${key}` : key);
      }
      return;
    }
    if (typeof node === "string" && PROHIBITED_TEXT.test(node)) {
      throw new Error(`${label} contains a prohibited private token`);
    }
  };
  walk(value);
}

function noForbiddenBytes(bytes, label, options = {}) {
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  if (PROHIBITED_TEXT.test(text)) {
    throw new Error(`${label} contains a prohibited private token`);
  }
  if (options.json) noForbiddenContent(strictJson(bytes, label), label, options);
}

async function trustedRegularFile(root, relative, label) {
  requireSafePath(relative, label);
  const target = ensureInside(root, relative);
  if (!target) throw new Error(`${label} is outside the publication root`);
  const [rootReal, before] = await Promise.all([realpath(root), lstat(target)]);
  if (!before.isFile() || before.isSymbolicLink()) {
    throw new Error(`${label} must be a regular non-symlink file`);
  }
  const targetReal = await realpath(target);
  if (!targetReal.startsWith(`${rootReal}${path.sep}`)) {
    throw new Error(`${label} resolves outside the publication root`);
  }
  const bytes = await readFile(target);
  const after = await lstat(target);
  if (!after.isFile() || after.isSymbolicLink() || after.size !== before.size) {
    throw new Error(`${label} changed while read`);
  }
  return { path: target, bytes, sha256: sha256(bytes) };
}

async function allRegularFiles(root, prefix = "") {
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolute = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Publication bundle cannot contain a symlink: ${relative}`);
    if (entry.isDirectory()) result.push(...await allRegularFiles(absolute, relative));
    else if (entry.isFile()) result.push(relative.replaceAll("\\", "/"));
    else throw new Error(`Publication bundle contains a non-regular entry: ${relative}`);
  }
  return result.sort();
}

function publicValidationSummary(report, sourceReportSha256) {
  const checkCounts = { pass: 0, fail: 0, warning: 0 };
  for (const check of report.checks ?? []) {
    if (Object.hasOwn(checkCounts, check.status)) checkCounts[check.status] += 1;
  }
  return {
    schemaVersion: "1.0",
    runId: report.runId,
    status: report.status,
    generatedAt: report.generatedAt,
    sourceReportSha256,
    checkCounts,
    issueCodes: [...new Set((report.issues ?? []).map(({ code }) => code))].sort(),
  };
}

function publicRunMetadata(run, { validationPath, validationSha256, evaluationPath, evaluationSha256, artifacts }) {
  return {
    schemaVersion: "1.0",
    id: run.id,
    benchmarkId: run.benchmarkId,
    benchmarkVersion: run.benchmarkVersion,
    launchId: run.launchId,
    cohortId: run.cohortId,
    taskPacketDigest: run.taskPacketDigest,
    ...(run.taskPacketBundleDigest ? { taskPacketBundleDigest: run.taskPacketBundleDigest } : {}),
    ...(run.executionContractDigest ? { executionContractDigest: run.executionContractDigest } : {}),
    ...(run.promptSha256 ? { promptSha256: run.promptSha256 } : {}),
    ...(run.launchDigest ? { launchDigest: run.launchDigest } : {}),
    fairnessFingerprint: run.fairnessFingerprint,
    status: "published",
    submittedAt: run.submittedAt,
    ...(typeof run.summary === "string" && run.summary.length ? { summary: run.summary } : {}),
    seal: { bundleSha256: run.seal.bundleSha256, algorithm: run.seal.algorithm },
    artifacts,
    validation: { path: validationPath, sha256: validationSha256 },
    evaluation: { path: evaluationPath, sha256: evaluationSha256 },
  };
}

function sourceFrameworkDigest(framework) {
  const digestEntries = (entries) => entries
    .filter((entry) => entry.manifest)
    .map((entry) => ({
      id: entry.manifest.id ?? `${entry.packetId}@${entry.packetVersion}`,
      manifest: sha256(Buffer.from(canonicalJson(entry.manifest))),
      ...(entry.release ? { release: sha256(Buffer.from(canonicalJson(entry.release))) } : {}),
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  return sha256(Buffer.from(canonicalJson({
    schemaVersion: "1.0",
    validationIssues: [],
    benchmarks: digestEntries(framework.benchmarks),
    taskPackets: digestEntries(framework.taskPackets),
    launches: digestEntries(framework.launches),
    cohorts: digestEntries(framework.cohorts),
    runs: digestEntries(framework.runs),
  })));
}

function artifactPublicationAllowed(artifact) {
  if (ACTIVE_MEDIA.test(artifact.mediaType ?? "")) return false;
  return !/\.(?:html?|m?js|cjs|css|svg)$/i.test(artifact.path ?? "");
}

async function writeBundleFile(stageRoot, files, relative, kind, bytes, sourceSha256 = undefined) {
  requireSafePath(relative, "Publication output");
  const target = ensureInside(stageRoot, relative);
  if (!target) throw new Error(`Publication output escapes staging directory: ${relative}`);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
  files.push({
    path: relative,
    kind,
    sha256: sha256(bytes),
    bytes: bytes.length,
    ...(sourceSha256 ? { sourceSha256 } : {}),
  });
}

function assertPublishedV4Cohort(framework, cohortId) {
  const cohort = framework.cohorts.find((entry) => entry.manifest?.id === cohortId);
  if (!cohort?.manifest || cohort.validationIssues.length > 0 || cohort.manifest.status !== "published" || cohort.manifest.extensions?.protocolVersion !== "4.0") {
    throw new Error("Publication export requires one valid, published v4 cohort");
  }
  return cohort;
}

/**
 * Export a portable, safe publication bundle from an evaluator-owned private
 * workspace. It is deliberately one-way: raw `runs/`, `cohorts/`, review
 * packages and review records are never copied into the bundle.
 */
export async function exportPublicCohortPublication({
  projectRoot = process.cwd(),
  cohortId,
  out,
  exportedAt = new Date().toISOString(),
  framework,
  publicEvaluationSummary,
}) {
  if (!ID_PATTERN.test(cohortId ?? "")) throw new Error("cohort ID must use lowercase kebab-case");
  if (!out) throw new Error("An outside --out directory is required");
  if (Number.isNaN(Date.parse(exportedAt))) throw new Error("exportedAt must be an ISO-8601 date-time");
  const root = path.resolve(projectRoot);
  const target = path.resolve(out);
  if (target === root || target.startsWith(`${root}${path.sep}`)) {
    throw new Error("Publication output must be outside the private evaluator workspace");
  }
  await lstat(target).then(() => { throw new Error("Publication output already exists"); }).catch((error) => {
    if (error?.code !== "ENOENT") throw error;
  });
  if (!framework || framework.issues.length > 0) {
    throw failure("Full private framework validation must pass before publication export", framework?.issues ?? []);
  }
  if (typeof publicEvaluationSummary !== "function") throw new Error("A host-generated public evaluation summary function is required");
  const cohort = assertPublishedV4Cohort(framework, cohortId);
  const postReview = cohort.manifest.extensions.postReview;
  const disclosureFile = await trustedRegularFile(cohort.root, postReview.disclosure.path, "Cohort disclosure");
  const privateAggregateFile = await trustedRegularFile(cohort.root, postReview.aggregate.path, "Cohort aggregate");
  if (disclosureFile.sha256 !== postReview.disclosure.sha256 || privateAggregateFile.sha256 !== postReview.aggregate.sha256) {
    throw new Error("Published post-review source bytes no longer match their cohort bindings");
  }
  const disclosure = strictJson(disclosureFile.bytes, "Cohort disclosure");
  const privateAggregate = strictJson(privateAggregateFile.bytes, "Cohort aggregate");
  const disclosureIssues = validateCohortDisclosure(disclosure);
  const aggregateIssues = validateCohortEvaluationAggregate(privateAggregate);
  if (disclosureIssues.length || aggregateIssues.length) {
    throw failure("Published post-review source is schema-invalid", [...disclosureIssues, ...aggregateIssues]);
  }
  if (disclosure.cohortId !== cohortId || privateAggregate.cohortId !== cohortId || disclosure.launchId !== cohort.manifest.launchId || privateAggregate.launchId !== cohort.manifest.launchId) {
    throw new Error("Post-review source does not bind the published cohort and launch");
  }
  const conditionsBytes = await trustedRegularFile(cohort.root, cohort.manifest.extensions.measurementConditions.path, "Measurement conditions");
  if (conditionsBytes.sha256 !== cohort.manifest.extensions.measurementConditions.sha256) throw new Error("Measurement conditions source hash mismatch");

  const stageRoot = `${target}.export-${process.pid}-${Date.now()}`;
  const files = [];
  try {
    await mkdir(stageRoot, { recursive: false });
    await writeBundleFile(stageRoot, files, "cohort-disclosure.json", "disclosure", disclosureFile.bytes, disclosureFile.sha256);
    const runEntries = cohort.manifest.candidateIds.map((runId) => {
      const entry = framework.runs.find((item) => item.manifest?.id === runId);
      if (!entry?.manifest || entry.validationIssues.length > 0 || entry.manifest.status !== "published") {
        throw new Error(`Published cohort member ${runId} is unavailable or invalid`);
      }
      return entry;
    });
    const publicRecords = new Map();
    for (const runEntry of runEntries) {
      const run = runEntry.manifest;
      const evaluationPath = ensureInside(runEntry.root, run.evaluation?.recordPath);
      if (!evaluationPath) throw new Error(`Run ${run.id} evaluator record path is unsafe`);
      const evaluationBytes = await readFile(evaluationPath);
      const summary = publicEvaluationSummary(strictJson(evaluationBytes, `Run ${run.id} evaluator record`), evaluationBytes);
      const evaluationIssues = validatePublicEvaluationSummary(summary);
      if (evaluationIssues.length) throw failure(`Run ${run.id} public evaluator summary is invalid`, evaluationIssues);
      noForbiddenContent(summary, `Run ${run.id} public evaluator summary`);
      const evaluationRelative = `evaluation-summaries/${run.id}.json`;
      const evaluationOutput = canonicalBytes(summary);
      await writeBundleFile(stageRoot, files, evaluationRelative, "evaluation-summary", evaluationOutput, sha256(evaluationBytes));
      publicRecords.set(run.id, { summary, relative: evaluationRelative, outputSha256: sha256(evaluationOutput), sourceSha256: sha256(evaluationBytes) });

      const reportFile = await trustedRegularFile(runEntry.root, run.publicationReport?.path, `Run ${run.id} publication report`);
      const report = strictJson(reportFile.bytes, `Run ${run.id} publication report`);
      const reportIssues = validateReport(report);
      if (reportIssues.length || report.status !== "valid" || report.runId !== run.id) {
        throw failure(`Run ${run.id} publication report is invalid`, reportIssues);
      }
      const validation = publicValidationSummary(report, reportFile.sha256);
      const validationIssues = validatePublicValidationSummary(validation);
      if (validationIssues.length) throw failure(`Run ${run.id} public validation summary is invalid`, validationIssues);
      noForbiddenContent(validation, `Run ${run.id} public validation summary`);
      const validationRelative = `validation-summaries/${run.id}.json`;
      const validationOutput = canonicalBytes(validation);
      await writeBundleFile(stageRoot, files, validationRelative, "validation-summary", validationOutput, reportFile.sha256);

      const artifacts = [];
      if (summary.status === "admitted") {
        for (const artifact of run.artifacts ?? []) {
          if (!artifactPublicationAllowed(artifact)) continue;
          const artifactFile = await trustedRegularFile(runEntry.root, artifact.path, `Run ${run.id} artifact ${artifact.id}`);
          if (artifactFile.sha256 !== artifact.sha256) throw new Error(`Run ${run.id} artifact ${artifact.id} source hash mismatch`);
          const downloadPath = `artifacts/${run.id}/${artifact.id}.download`;
          await writeBundleFile(stageRoot, files, downloadPath, "artifact", artifactFile.bytes, artifactFile.sha256);
          artifacts.push({
            id: artifact.id,
            role: artifact.role,
            sha256: artifact.sha256,
            status: artifact.status,
            ...(artifact.mediaType ? { mediaType: artifact.mediaType } : {}),
            ...(artifact.label ? { label: artifact.label } : {}),
            downloadPath,
          });
        }
      }
      const metadata = publicRunMetadata(run, {
        validationPath: validationRelative,
        validationSha256: sha256(validationOutput),
        evaluationPath: evaluationRelative,
        evaluationSha256: publicRecords.get(run.id).outputSha256,
        artifacts,
      });
      const metadataIssues = validatePublicRunMetadata(metadata);
      if (metadataIssues.length) throw failure(`Run ${run.id} public metadata is invalid`, metadataIssues);
      noForbiddenContent(metadata, `Run ${run.id} public metadata`);
      await writeBundleFile(stageRoot, files, `candidate-metadata/${run.id}.json`, "run-metadata", canonicalBytes(metadata), sha256(Buffer.from(canonicalJson(run))));
    }

    const aggregate = structuredClone(privateAggregate);
    aggregate.evaluationRecords = aggregate.evaluationRecords.map((record) => {
      const publicRecord = publicRecords.get(record.runId);
      if (!publicRecord || publicRecord.sourceSha256 !== record.sha256) {
        throw new Error(`Aggregate evaluator record binding cannot be reproduced safely for ${record.runId}`);
      }
      return {
        ...record,
        path: publicRecord.relative,
      };
    });
    const aggregateIssues = validateCohortEvaluationAggregate(aggregate);
    if (aggregateIssues.length) throw failure("Publication aggregate is invalid", aggregateIssues);
    noForbiddenContent(aggregate, "Publication aggregate");
    await writeBundleFile(stageRoot, files, "cohort-evaluation-aggregate.json", "aggregate", canonicalBytes(aggregate), privateAggregateFile.sha256);

    const source = {
      frameworkValidationDigest: sourceFrameworkDigest(framework),
      cohortManifestSha256: sha256(Buffer.from(canonicalJson(cohort.manifest))),
      measurementConditionsSha256: conditionsBytes.sha256,
      disclosureSha256: disclosureFile.sha256,
      aggregateSha256: privateAggregateFile.sha256,
    };
    const manifest = {
      schemaVersion: "1.0",
      kind: "rotorbench-public-cohort-publication",
      cohortId,
      launchId: cohort.manifest.launchId,
      fairnessFingerprint: cohort.manifest.fairnessFingerprint,
      exportedAt,
      source,
      files: files.sort((left, right) => left.path.localeCompare(right.path)),
    };
    const manifestIssues = validateCohortPublicationBundle(manifest);
    if (manifestIssues.length) throw failure("Publication manifest is invalid", manifestIssues);
    noForbiddenContent(manifest, "Publication manifest");
    const manifestBytes = canonicalBytes(manifest);
    await writeFile(path.join(stageRoot, PUBLICATION_MANIFEST), manifestBytes, { flag: "wx" });
    await writeFile(path.join(stageRoot, PUBLICATION_DIGEST), `${sha256(manifestBytes)}\n`, { flag: "wx" });
    await rename(stageRoot, target);
    return { cohortId, out: target, fileCount: files.length, manifestSha256: sha256(manifestBytes) };
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

function validatePublicationFileKind(entry, value) {
  switch (entry.kind) {
    case "disclosure": return validateCohortDisclosure(value);
    case "aggregate": return validateCohortEvaluationAggregate(value);
    case "run-metadata": return validatePublicRunMetadata(value);
    case "evaluation-summary": return validatePublicEvaluationSummary(value);
    case "validation-summary": return validatePublicValidationSummary(value);
    case "artifact": return [];
    default: return [{ code: "unknown-publication-file-kind", message: `Unsupported bundle file kind ${entry.kind}` }];
  }
}

function mapByPath(entries) {
  const result = new Map();
  for (const entry of entries) {
    if (result.has(entry.path)) throw new Error(`Publication manifest declares duplicate path ${entry.path}`);
    result.set(entry.path, entry);
  }
  return result;
}

function expectedKind(entry, pathName) {
  if (entry.kind === "disclosure") return pathName === "cohort-disclosure.json";
  if (entry.kind === "aggregate") return pathName === "cohort-evaluation-aggregate.json";
  if (entry.kind === "run-metadata") return /^candidate-metadata\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(pathName);
  if (entry.kind === "evaluation-summary") return /^evaluation-summaries\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(pathName);
  if (entry.kind === "validation-summary") return /^validation-summaries\/[a-z0-9]+(?:-[a-z0-9]+)*\.json$/.test(pathName);
  if (entry.kind === "artifact") return /^artifacts\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\.download$/.test(pathName);
  return false;
}

/** Read and fully validate a portable publication bundle without consulting private state. */
export async function validatePublicCohortPublication(bundleRoot) {
  const root = path.resolve(bundleRoot);
  const stats = await lstat(root).catch(() => null);
  if (!stats?.isDirectory() || stats.isSymbolicLink()) throw new Error("Publication bundle root must be a regular directory");
  const manifestFile = await trustedRegularFile(root, PUBLICATION_MANIFEST, "Publication manifest");
  const digestFile = await trustedRegularFile(root, PUBLICATION_DIGEST, "Publication manifest digest");
  const digestText = new TextDecoder("utf-8", { fatal: true }).decode(digestFile.bytes).trim();
  if (!/^[a-f0-9]{64}$/.test(digestText) || digestText !== manifestFile.sha256) throw new Error("Publication manifest digest does not match publication.json");
  const manifest = strictJson(manifestFile.bytes, "Publication manifest");
  const manifestIssues = validateCohortPublicationBundle(manifest);
  if (manifestIssues.length) throw failure("Publication manifest is schema-invalid", manifestIssues);
  noForbiddenContent(manifest, "Publication manifest");
  const fileEntries = mapByPath(manifest.files);
  const expectedFiles = new Set([PUBLICATION_MANIFEST, PUBLICATION_DIGEST, ...fileEntries.keys()]);
  const actualFiles = await allRegularFiles(root);
  if (canonicalJson(actualFiles) !== canonicalJson([...expectedFiles].sort())) {
    throw new Error("Publication bundle must contain exactly its manifest-listed regular files");
  }
  const parsed = new Map();
  for (const [relative, entry] of fileEntries) {
    if (!expectedKind(entry, relative)) throw new Error(`Publication file kind/path mismatch: ${relative}`);
    const file = await trustedRegularFile(root, relative, `Publication file ${relative}`);
    if (file.sha256 !== entry.sha256 || file.bytes.length !== entry.bytes) throw new Error(`Publication file hash or size mismatch: ${relative}`);
    if (entry.kind === "artifact") {
      if (PROHIBITED_TEXT.test(relative)) throw new Error(`Publication artifact path contains a prohibited private token: ${relative}`);
      noForbiddenBytes(file.bytes, `Publication artifact ${relative}`);
      continue;
    }
    const value = strictJson(file.bytes, `Publication file ${relative}`);
    noForbiddenContent(value, `Publication file ${relative}`, { allowModelDisclosure: entry.kind === "disclosure" });
    const issues = validatePublicationFileKind(entry, value);
    if (issues.length) throw failure(`Publication file ${relative} is schema-invalid`, issues);
    parsed.set(relative, value);
  }
  const disclosure = parsed.get("cohort-disclosure.json");
  const aggregate = parsed.get("cohort-evaluation-aggregate.json");
  if (!disclosure || !aggregate) throw new Error("Publication must include disclosure and aggregate files");
  if (
    disclosure.cohortId !== manifest.cohortId
    || aggregate.cohortId !== manifest.cohortId
    || disclosure.launchId !== manifest.launchId
    || aggregate.launchId !== manifest.launchId
    || aggregate.binding?.fairnessFingerprint !== manifest.fairnessFingerprint
  ) throw new Error("Publication disclosure/aggregate do not bind manifest cohort, launch, and fairness fingerprint");
  const aggregateEntry = fileEntries.get("cohort-evaluation-aggregate.json");
  const disclosureEntry = fileEntries.get("cohort-disclosure.json");
  if (
    manifest.source.disclosureSha256 !== disclosureEntry.sourceSha256
    || manifest.source.aggregateSha256 !== aggregateEntry.sourceSha256
    || aggregate.disclosureSha256 !== disclosureEntry.sha256
  ) throw new Error("Publication source/disclosure aggregate hash binding is invalid");

  const runMetadata = [...parsed.entries()]
    .filter(([relative]) => relative.startsWith("candidate-metadata/"))
    .map(([, value]) => value);
  const metadataById = new Map();
  for (const metadata of runMetadata) {
    if (metadataById.has(metadata.id)) throw new Error(`Publication has duplicate public run metadata ${metadata.id}`);
    if (metadata.cohortId !== manifest.cohortId || metadata.launchId !== manifest.launchId || metadata.fairnessFingerprint !== manifest.fairnessFingerprint) throw new Error(`Public run metadata is not bound to publication cohort: ${metadata.id}`);
    if (Object.hasOwn(metadata, "model")) throw new Error("Public run metadata may not contain submitted model identity");
    const evaluation = parsed.get(metadata.evaluation.path);
    const validation = parsed.get(metadata.validation.path);
    if (!evaluation || !validation || sha256(canonicalBytes(evaluation)) !== metadata.evaluation.sha256 || sha256(canonicalBytes(validation)) !== metadata.validation.sha256) {
      throw new Error(`Public run metadata reference hash mismatch: ${metadata.id}`);
    }
    if (evaluation.runId !== metadata.id || validation.runId !== metadata.id) throw new Error(`Public run metadata references another run: ${metadata.id}`);
    for (const artifact of metadata.artifacts) {
      const declared = fileEntries.get(artifact.downloadPath);
      if (!declared || declared.kind !== "artifact" || declared.sha256 !== artifact.sha256) throw new Error(`Public run metadata artifact binding is invalid: ${metadata.id}/${artifact.id}`);
    }
    metadataById.set(metadata.id, metadata);
  }
  const aggregateRunIds = aggregate.evaluationRecords.map(({ runId }) => runId).sort();
  if (canonicalJson(aggregateRunIds) !== canonicalJson([...metadataById.keys()].sort())) {
    throw new Error("Publication aggregate and public run metadata do not cover exactly the same runs");
  }
  for (const record of aggregate.evaluationRecords) {
    if (!record.path.startsWith("evaluation-summaries/") || record.path.includes("runs/")) throw new Error(`Publication aggregate has a private evaluation path for ${record.runId}`);
    const summary = parsed.get(record.path);
    if (!summary || summary.runId !== record.runId || summary.evaluationRecordSha256 !== record.sha256 || summary.status !== record.status) {
      throw new Error(`Publication aggregate evaluation summary binding is invalid for ${record.runId}`);
    }
  }
  const disclosureRunIds = disclosure.modelGroups.flatMap(({ runIds }) => runIds).sort();
  if (canonicalJson(disclosureRunIds) !== canonicalJson(aggregateRunIds)) throw new Error("Publication disclosure does not cover exactly the public runs");
  return { root, manifest, manifestSha256: manifestFile.sha256, disclosure, aggregate, files: fileEntries, parsed, runMetadata: metadataById };
}

async function publicationIds(projectRoot) {
  const root = path.join(projectRoot, "publications");
  const entries = await readdir(root, { withFileTypes: true }).catch((error) => error?.code === "ENOENT" ? [] : Promise.reject(error));
  return entries.filter((entry) => entry.isDirectory() && !entry.name.startsWith("_")).map((entry) => entry.name).sort();
}

/** Atomically copy a verified portable bundle into a public repository. */
export async function importPublicCohortPublication({ projectRoot = process.cwd(), bundlePath }) {
  if (!bundlePath) throw new Error("A --bundle path is required");
  const root = path.resolve(projectRoot);
  const bundle = await validatePublicCohortPublication(path.resolve(bundlePath));
  const publicationsRoot = path.join(root, "publications");
  await mkdir(publicationsRoot, { recursive: true });
  const existingIds = await publicationIds(root);
  if (existingIds.includes(bundle.manifest.cohortId)) throw new Error(`Publication cohort already exists: ${bundle.manifest.cohortId}`);
  const existingRunIds = new Set();
  for (const id of existingIds) {
    const existing = await validatePublicCohortPublication(path.join(publicationsRoot, id));
    for (const runId of existing.runMetadata.keys()) existingRunIds.add(runId);
  }
  for (const runId of bundle.runMetadata.keys()) {
    if (existingRunIds.has(runId)) throw new Error(`Publication run ID already exists: ${runId}`);
  }
  const finalRoot = path.join(publicationsRoot, bundle.manifest.cohortId);
  const stageRoot = path.join(publicationsRoot, `.${bundle.manifest.cohortId}.import-${process.pid}-${Date.now()}`);
  if (await lstat(finalRoot).then(() => true).catch(() => false)) throw new Error(`Publication destination already exists: ${bundle.manifest.cohortId}`);
  try {
    await cp(bundle.root, stageRoot, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true });
    const staged = await validatePublicCohortPublication(stageRoot);
    if (staged.manifestSha256 !== bundle.manifestSha256) throw new Error("Copied publication manifest changed during import");
    await rename(stageRoot, finalRoot);
    return { cohortId: bundle.manifest.cohortId, destination: finalRoot, runIds: [...bundle.runMetadata.keys()].sort(), manifestSha256: bundle.manifestSha256 };
  } catch (error) {
    await rm(stageRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

export async function loadPublicCohortPublications(projectRoot) {
  const root = path.join(path.resolve(projectRoot), "publications");
  const ids = await publicationIds(projectRoot);
  const values = [];
  const seenRuns = new Set();
  for (const id of ids) {
    const publication = await validatePublicCohortPublication(path.join(root, id));
    if (publication.manifest.cohortId !== id) throw new Error(`Publication directory/id mismatch: ${id}`);
    for (const runId of publication.runMetadata.keys()) {
      if (seenRuns.has(runId)) throw new Error(`Duplicate publication run ID: ${runId}`);
      seenRuns.add(runId);
    }
    values.push(publication);
  }
  return values;
}

export function publicManifestDigest(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}
