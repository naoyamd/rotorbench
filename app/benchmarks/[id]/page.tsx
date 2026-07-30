import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../components/site-header";
import {
  type Benchmark,
  getBenchmark,
  getFrameworkCatalog,
} from "../../framework-data";

export const dynamicParams = false;
export const dynamic = "force-static";
const emptyCatalogPlaceholder = "__framework-empty__";

function scoringContractPath(benchmark: Benchmark) {
  const declaration = benchmark.extensions?.scoringContract;
  if (
    declaration
    && typeof declaration === "object"
    && "publicPath" in declaration
    && typeof declaration.publicPath === "string"
    && declaration.publicPath.length > 0
  ) {
    return declaration.publicPath.replace(/^\/+/, "");
  }
  return `framework/task-packets/${benchmark.id}/${benchmark.version}/inputs/scoring-contract.json`;
}

export async function generateStaticParams() {
  const ids = getFrameworkCatalog().benchmarks.map(({ id }) => ({ id }));
  // See the matching run route: this enables static-export validation for a
  // deliberately empty catalog without introducing a benchmark definition.
  return ids.length > 0 ? ids : [{ id: emptyCatalogPlaceholder }];
}

export default async function BenchmarkDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === emptyCatalogPlaceholder) {
    return <><SiteHeader /><main className="listing-page"><section className="empty-state"><h1>No benchmarks published</h1><p>This build-validation route is removed from the public output.</p></section></main><SiteFooter /></>;
  }
  const benchmark = getBenchmark(id);
  if (!benchmark) notFound();
  const { runs, cohorts } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const relatedRuns = runs.filter((run) => run.benchmarkId === benchmark.id);
  const groupAggregates = cohorts
    .filter((cohort) => cohort.launchId === relatedRuns[0]?.launchId)
    .flatMap((cohort) => cohort.postReview?.aggregate.content.modelGroups ?? []);
  return <><SiteHeader /><main className="detail-page"><section className="detail-hero"><p className="eyebrow">BENCHMARK / {benchmark.id}</p><h1>{benchmark.title}</h1><p>{benchmark.summary ?? "No public summary is supplied."}</p><dl className="metadata-grid"><div><dt>Status</dt><dd>{benchmark.status}</dd></div><div><dt>Version</dt><dd>{benchmark.version ?? "Not declared"}</dd></div><div><dt>Protocol</dt><dd>EDBF Stage 1 v4</dd></div></dl></section>{benchmark.id === "integrated-robotic-handling" ? <section className="content-section"><p className="eyebrow">FIXED TASK AND MEASUREMENT</p><h2>Complete arm, powered gripper, engineering evidence</h2><p>The candidate designs the fixed base, manipulator, wrist, opening/closing gripper, load path, drives, brakes, critical production definition, and neutral STEP handoff as one system. Incomplete work remains visible through append-only checkpoints.</p><div className="action-row"><a className="button-link" href={`${basePath}/model-task/`}>COPY MODEL PROMPT</a><a className="button-link secondary" href={`${basePath}/${scoringContractPath(benchmark)}`}>SCORING CONTRACT</a><a className="button-link secondary" href={`${basePath}/evaluate-task/`}>EVALUATOR HANDOFF</a></div></section> : null}<section className="content-section"><h2>Published model-group aggregates</h2>{groupAggregates.length === 0 ? <p className="empty-copy">0 published model groups. Aggregates appear only after every official repeat is finalized and the operator disclosure is published.</p> : <table className="comparison"><thead><tr><th>Group</th><th>Repeats</th><th>Admission</th><th>Baseline qualification</th><th>D01–D10 medians</th></tr></thead><tbody>{groupAggregates.map((group) => <tr key={group.groupId}><td>{group.groupId}</td><td>{group.runCount}</td><td>{group.admission.count}/{group.runCount}</td><td>{group.qualification.baseline.count}/{group.runCount}</td><td>{group.dimensions.map(({ id, median }) => `${id}: ${median ?? "—"}`).join(", ")}</td></tr>)}</tbody></table>}<p>No rank, winner, or composite score is produced.</p></section><section className="content-section"><h2>Published runs</h2>{relatedRuns.length === 0 ? <p className="empty-copy">No model has been run yet. The task and measurement contracts are ready; execution begins by copying the live launch from Stage 1.</p> : <ul className="artifact-list">{relatedRuns.map((run) => <li key={run.id}><div><strong>{run.id}</strong><span>{run.status}</span></div><a className="button-link" href={`${basePath}/runs/${run.id}/`}>OPEN RUN</a></li>)}</ul>}</section></main><SiteFooter /></>;
}
