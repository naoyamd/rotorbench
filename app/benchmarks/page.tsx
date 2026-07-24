import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { getFrameworkCatalog } from "../framework-data";

export const metadata: Metadata = { title: "Benchmarks | Engineering Design Benchmark Framework" };

export default function BenchmarksPage() {
  const { benchmarks, runs } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">BENCHMARK CATALOG</p><h1>Benchmarks</h1><p>Shared definitions only. Task-specific inputs and evaluation methods, when a future benchmark needs them, are constrained to the manifest’s extensions.</p></section>
    {benchmarks.length === 0 ? <section className="empty-state"><h2>0 benchmarks</h2><p>No benchmark definitions are published.</p><a className="button-link" href={`${basePath}/format/`}>REVIEW THE FORMAT</a></section> : <ul className="card-list">{benchmarks.map((benchmark) => <li key={benchmark.id}><a href={`${basePath}/benchmarks/${benchmark.id}/`}><p className="eyebrow">{benchmark.status}</p><h2>{benchmark.title}</h2><p>{benchmark.summary ?? "No summary supplied."}</p><span>{runs.filter((run) => run.benchmarkId === benchmark.id).length} runs</span></a></li>)}</ul>}
  </main><SiteFooter /></>;
}
