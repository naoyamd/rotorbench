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
  schemaVersion: "1.0" | "3.0" | "4.0";
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
  v4Contract?: V4Contract;
  checkpoints?: V4Checkpoint[];
  changeEvents?: V4ChangeEvent[];
  manifestDownload: string;
  taskDefinitionDownload?: string;
  lockDownload?: string;
};

export type V4VisibilityClass =
  | "candidate-public"
  | "run-private-instance"
  | "evaluator-hidden-robustness"
  | "event-private-change"
  | "evaluator-secret";

export type V4AssetCommitment = {
  id: string;
  visibilityClass: V4VisibilityClass;
  disclosedAt: "before-run" | "run-start" | "after-prior-receipt" | "evaluator-only";
  requirementRefs: string[];
  digest: string;
};

export type V4Checkpoint = {
  id: string;
  sequence: number;
  title: string;
  phase: "initial-plan" | "concept" | "embodiment" | "verification" | "submission" | "change-response";
  requiredOutputRefs: string[];
  requiresPriorCheckpointIds: string[];
  requiredForBaseline?: boolean;
};

export type V4ChangeEvent = {
  id: string;
  visibilityClass: "event-private-change";
  triggerAfterCheckpointId: string;
  responseCheckpointId: string;
  requirementRefs: string[];
  digest: string;
};

export type V4Contract = {
  scoringVersion: string;
  instanceBankManifest: V4AssetCommitment;
  visibilityPolicy: V4AssetCommitment;
  checkpointContract: V4AssetCommitment;
  changeEventContract: V4AssetCommitment;
  evaluationContract: V4AssetCommitment;
  sanitizationProfile: V4AssetCommitment;
  sealedAssetCommitments: V4AssetCommitment[];
  disclosureSchedule: V4AssetCommitment[];
};

export type Launch = {
  schemaVersion: "1.0";
  id: string;
  protocolVersion: "2.0" | "3.0" | "4.0";
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
  v4Contract?: V4Contract;
  workspaceBootstrap?: {
    kind: "public-bundle" | "public-repository-commit";
    location: string;
    sha256: string;
  };
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
  postReview?: {
    disclosure: {
      path: string;
      sha256: string;
      download: string;
      content: CohortDisclosure;
    };
    aggregate: {
      path: string;
      sha256: string;
      download: string;
      content: CohortEvaluationAggregate;
    };
  };
};

export type CohortDisclosure = {
  schemaVersion: "1.0";
  cohortId: string;
  launchId: string;
  measurementConditionsSha256: string;
  disclosedAt: string;
  modelGroups: Array<{
    groupId: string;
    runIds: string[];
    model: { provider: string; name: string; version: string; reasoningSetting: string; policy: string };
  }>;
};

export type CohortEvaluationAggregate = {
  schemaVersion: "1.0";
  cohortId: string;
  launchId: string;
  measurementConditionsSha256: string;
  disclosureSha256: string;
  generatedAt: string;
  binding: { fairnessFingerprint: string; evaluationContractDigest: string; scoringVersion: string; scoringContractSha256: string; panel: string };
  evaluationRecords: Array<{ runId: string; path: string; sha256: string; status: "admitted" | "artifact-invalid" }>;
  modelGroups: Array<{
    groupId: string;
    runIds: string[];
    runCount: number;
    admission: { count: number; rate: number };
    qualification: { baseline: { count: number; rate: number }; change: { count: number; rate: number } };
    dimensions: Array<{ id: string; label: string; runCount: number; evaluableCount: number; median: number | null; observedInterval: [number, number] | null; failureCauses: Record<string, number> }>;
    gates: Array<{ id: string; runCount: number; passCount: number; passRate: number | null; resultCounts: Record<string, number> }>;
    attainment: { highestCheckpointCounts: Record<string, number> };
    rawMetrics: { separateFromDesignQuality: true; records: Array<{ runId: string; values: unknown }> };
    efficiency: { separateFromDesignQuality: true; records: Array<{ runId: string; values: unknown }> };
    compositeScore: null;
    compositeScorePublished: false;
  }>;
  compositeScore: null;
  compositeScorePublished: false;
};

export type PublicEvaluationSummary = {
  schemaVersion: "1.0";
  runId: string;
  status: "admitted" | "artifact-invalid";
  evaluationRecordSha256: string;
  finalization: Record<string, unknown> | null;
  qualification?: { baselineQualified?: boolean | null; changeQualified?: boolean | null };
  gates?: Array<{ id: string; label?: string; result: string }>;
  dimensions?: Array<{ id: string; label?: string; score: number | null; scoreInterval?: [number, number] | null; evaluable: boolean }>;
  attainment?: { highestVerifiedCheckpoint?: string | null };
  rawMetrics?: unknown[];
  efficiency?: { separateFromDesignQuality?: boolean; values?: Record<string, unknown> };
  compositeScore?: null;
  compositeScorePublished?: false;
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
  model?: { provider: string; name: string; version: string };
  summary?: string;
  seal: {
    sealed: true;
    bundlePath: "submitted";
    bundleSha256: string;
    algorithm: "sha256-tree-v1";
  };
  publicationReport?: { path: "publication-report.json"; sha256: string };
  processEvidence: {
    initialPlan: { path: string; sha256: string; download: string; downloadName: string };
    workRecord: { path: string; sha256: string; download: string; downloadName: string };
  } | null;
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
  evaluation?: {
    summary: PublicEvaluationSummary;
    download?: string;
  } | null;
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
