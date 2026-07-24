import catalogJson from "../public/framework/catalog.json";
import stage0ReportJson from "../public/framework/stage0-report.json";

export type Viewer =
  | { status: "ready"; mesh: string; triangleCount: number }
  | { status: "failed"; message: string }
  | null;

export type Artifact = {
  id: string;
  role: "cad-source" | "step" | "drawing" | "bom" | "calculation" | "supporting";
  path: string;
  sha256: string;
  status: "present" | "processed" | "failed";
  mediaType?: string;
  label?: string;
  download: string;
  downloadName: string;
  viewer: Viewer;
};

export type Benchmark = {
  schemaVersion: "1.0";
  id: string;
  title: string;
  summary?: string;
  status: "draft" | "active" | "archived";
  version: string;
  extensions: Record<string, unknown>;
};

export type TaskPacket = {
  schemaVersion: "1.0" | "3.0";
  id: string;
  version: string;
  title: string;
  summary?: string;
  instructions: { path: string; sha256: string };
  instructionsText: string;
  inputs: Array<{
    id: string;
    label?: string;
    path: string;
    sha256: string;
    sizeBytes?: number;
    mediaType?: string;
    provenance?: string;
    license?: string;
    downloadName: string;
    download: string;
  }>;
  requiredOutputs: Array<
    Artifact["role"]
    | { id: string; role: Artifact["role"]; description: string }
  >;
  environment: { baseline: string; cad: string; stepPipeline: string };
  completionCriteria: Array<
    string
    | {
      id: string;
      statement: string;
      requiredOutputRefs: string[];
      evidenceRoles: Artifact["role"][];
    }
  >;
  taskDefinitionDigest?: string;
  authorId?: string;
  manifestDownload: string;
  taskDefinitionDownload?: string;
  lockDownload?: string;
};

export type Launch = {
  schemaVersion: "1.0";
  id: string;
  protocolVersion: "2.0" | "3.0";
  taskPacket: { id: string; version: string; digest: string; bundleDigest?: string };
  baselineCommit: string;
  workspaceDigest: string;
  canonicalBaseUrl?: string;
  outputRoot: "candidate-output";
  startAction: "checkpoint-initial-plan";
  stopConditions: string[];
  fairnessFingerprint: string;
  executionProfile?: { id: string; version: string; digest: string };
  baselineAttestationDigest?: string;
  executionContractDigest?: string;
  promptSha256?: string;
  launchDigest?: string;
  manifestDownload?: string;
  promptDownload?: string;
  promptText?: string;
  executionContractRoot?: string;
  releaseStatus?: "release-ready" | "live-verified";
};

export type Cohort = {
  schemaVersion: "1.0";
  id: string;
  launchId: string;
  fairnessFingerprint: string;
  status: "published";
  candidateIds: string[];
  extensions: Record<string, unknown>;
};

export type ValidationReport = {
  status: "valid" | "invalid" | "warning" | "processing";
  checks: Array<{ name: string; status: "pass" | "fail" | "warning"; detail?: string; artifactId?: string; inputSha256?: string; derivedSha256?: string }>;
  issues: Array<{ code: string; message: string; path?: string }>;
};

export type Run = {
  schemaVersion: "1.0";
  id: string;
  benchmarkId: string;
  benchmarkVersion: string;
  launchId: string;
  cohortId: string;
  taskPacketDigest: string;
  taskPacketBundleDigest?: string;
  executionContractDigest?: string;
  promptSha256?: string;
  launchDigest?: string;
  fairnessFingerprint: string;
  status: "draft" | "submitted" | "validated" | "published" | "failed";
  submittedAt: string;
  model: { provider: string; name: string; version: string };
  summary?: string;
  seal: {
    sealed: true;
    bundlePath: "submitted";
    bundleSha256: string;
    algorithm: "sha256-tree-v1";
  };
  publicationReport: { path: "publication-report.json"; sha256: string };
  processEvidence: {
    initialPlan: { path: string; sha256: string; download: string; downloadName: string };
    workRecord: { path: string; sha256: string; download: string; downloadName: string };
  };
  process: {
    plan: {
      requirements: Array<{ id: string; source: string; statement: string }>;
      assumptions: Array<{ id: string; statement: string; rationale: string; risk: string }>;
      steps: Array<{ id: string; statement: string; requirementRefs: string[] }>;
      alternativesToEvaluate: Array<{ id: string; question: string; requirementRefs: string[] }>;
      verificationPlan: Array<{ id: string; requirementRefs: string[]; method: string; expectedEvidence: string }>;
    };
    workRecord: {
      alternatives: Array<{ id: string; description: string; disposition: string }>;
      decisions: Array<{ id: string; requirementRefs: string[]; alternativeRefs: string[]; choice: string; rationale: string; tradeoffs: string }>;
      planRevisions: Array<{ id: string; reason: string; affectedStepRefs: string[] }>;
      verificationClaims: Array<{ id: string; requirementRefs: string[]; method: string; result: "pass" | "fail" | "not-run"; evidenceArtifactRefs: string[] }>;
    };
  } | null;
  artifacts: Artifact[];
  extensions: Record<string, unknown>;
  validation: ValidationReport | null;
};

const catalog = catalogJson as {
  schemaVersion: "1.0";
  benchmarks: Benchmark[];
  taskPackets: TaskPacket[];
  launches: Launch[];
  cohorts: Cohort[];
  runs: Run[];
};

export function getFrameworkCatalog() {
  return catalog;
}

const stage0Report = stage0ReportJson as {
  schemaVersion: "1.0";
  counts: {
    draftOrHeldRecords: number;
    recordsWithBlockers: number;
    liveVerifiedLaunches: number;
  };
};

export function getStage0Report() {
  return stage0Report;
}

export function getBenchmark(id: string) {
  return catalog.benchmarks.find((benchmark) => benchmark.id === id);
}

export function getRun(id: string) {
  return catalog.runs.find((run) => run.id === id);
}

export function getLaunch(id: string) {
  const launch = catalog.launches.find((entry) => entry.id === id);
  if (!launch) return undefined;
  const packet = catalog.taskPackets.find((entry) =>
    entry.id === launch.taskPacket.id && entry.version === launch.taskPacket.version
  );
  return packet ? { launch, packet } : undefined;
}

export function publicPath(basePath: string, value: string) {
  return `${basePath}/${value}`.replace(/\/{2,}/g, "/");
}
