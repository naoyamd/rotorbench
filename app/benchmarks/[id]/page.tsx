import { notFound } from "next/navigation";
import { SiteFooter, SiteHeader } from "../../components/site-header";
import { getBenchmark, getFrameworkCatalog } from "../../framework-data";

export const dynamicParams = false;
export const dynamic = "force-static";
const emptyCatalogPlaceholder = "__framework-empty__";

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
  const { runs } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const relatedRuns = runs.filter((run) => run.benchmarkId === benchmark.id);
  return <><SiteHeader /><main className="detail-page"><section className="detail-hero"><p className="eyebrow">BENCHMARK / {benchmark.id}</p><h1>{benchmark.title}</h1><p>{benchmark.summary ?? "No public summary is supplied."}</p><dl className="metadata-grid"><div><dt>Status</dt><dd>{benchmark.status}</dd></div><div><dt>Version</dt><dd>{benchmark.version ?? "Not declared"}</dd></div><div><dt>Extensions</dt><dd>{Object.keys(benchmark.extensions).length} declared</dd></div></dl></section><section className="content-section"><h2>Runs</h2>{relatedRuns.length === 0 ? <p className="empty-copy">No runs are published for this benchmark.</p> : <ul className="artifact-list">{relatedRuns.map((run) => <li key={run.id}><div><strong>{run.id}</strong><span>{run.status}</span></div><a className="button-link" href={`${basePath}/runs/${run.id}/`}>OPEN RUN</a></li>)}</ul>}</section></main><SiteFooter /></>;
}
