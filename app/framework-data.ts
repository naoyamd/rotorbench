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
  status: "draft" | "submitted" | "validated" | "published" | "failed";
  submittedAt: string;
  model: { provider: string; name: string; version: string };
  summary?: string;
  artifacts: Artifact[];
  extensions: Record<string, unknown>;
  validation: ValidationReport | null;
};

const catalog = catalogJson as { schemaVersion: "1.0"; benchmarks: Benchmark[]; runs: Run[] };

export function getFrameworkCatalog() {
  return catalog;
}

export function getBenchmark(id: string) {
  return catalog.benchmarks.find((benchmark) => benchmark.id === id);
}

export function getRun(id: string) {
  return catalog.runs.find((run) => run.id === id);
}

export function publicPath(basePath: string, value: string) {
  return `${basePath}/${value}`.replace(/\/{2,}/g, "/");
}
