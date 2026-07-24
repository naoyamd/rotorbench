import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { getFrameworkCatalog } from "../framework-data";

export const metadata: Metadata = { title: "Compare | Engineering Design Benchmark Framework" };

export default function ComparePage() {
  const { runs } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">STATIC COMPARISON SURFACE</p><h1>Compare runs</h1><p>This page deliberately contains no ranking or task-specific evaluation. It can statically present like-for-like metadata when future runs exist.</p></section>{runs.length === 0 ? <section className="empty-state"><h2>0 runs</h2><p>There are no framework runs to compare.</p></section> : <table className="comparison"><thead><tr><th>Run</th><th>Benchmark</th><th>Version</th><th>Status</th><th>Artifacts</th></tr></thead><tbody>{runs.map((run) => <tr key={run.id}><td><a href={`${basePath}/runs/${run.id}/`}>{run.id}</a></td><td>{run.benchmarkId}</td><td>{run.benchmarkVersion}</td><td>{run.status}</td><td>{run.artifacts.length}</td></tr>)}</tbody></table>}</main><SiteFooter /></>;
}
