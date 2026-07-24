import catalogJson from "../public/framework/catalog.json";

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
  schemaVersion: "1.0";
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
    mediaType?: string;
    download: string;
  }>;
  requiredOutputs: Artifact["role"][];
  environment: { baseline: string; cad: string; stepPipeline: string };
  completionCriteria: string[];
};

export type Launch = {
  schemaVersion: "1.0";
  id: string;
  protocolVersion: "2.0";
  taskPacket: { id: string; version: string; digest: string };
  baselineCommit: string;
  workspaceDigest: string;
  outputRoot: "candidate-output";
  startAction: "checkpoint-initial-plan";
  stopConditions: string[];
  fairnessFingerprint: string;
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
