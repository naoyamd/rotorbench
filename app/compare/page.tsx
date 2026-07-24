import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { getFrameworkCatalog } from "../framework-data";

export const metadata: Metadata = { title: "Compare | Engineering Design Benchmark Framework" };

export default function ComparePage() {
  const { runs } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const current = groups.get(run.fairnessFingerprint) ?? [];
    current.push(run);
    groups.set(run.fairnessFingerprint, current);
  }
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">STATIC COMPARISON SURFACE</p><h1>Compare like-for-like runs</h1><p>Runs are grouped only when their task packet, baseline, workspace, environment, and execution contract share the same fairness fingerprint. This surface contains no rank, score, or winner.</p></section>{runs.length === 0 ? <section className="empty-state"><h2>0 published runs</h2><p>There are no sealed framework runs to compare.</p></section> : Array.from(groups.entries()).map(([fingerprint, group]) => <section className="content-section" key={fingerprint}><p className="eyebrow">FAIRNESS FINGERPRINT</p><h2><code>{fingerprint}</code></h2><table className="comparison"><thead><tr><th>Run</th><th>Benchmark</th><th>Version</th><th>Status</th><th>Artifacts</th></tr></thead><tbody>{group.map((run) => <tr key={run.id}><td><a href={`${basePath}/runs/${run.id}/`}>{run.id}</a></td><td>{run.benchmarkId}</td><td>{run.benchmarkVersion}</td><td>{run.status}</td><td>{run.artifacts.length}</td></tr>)}</tbody></table></section>)}</main><SiteFooter /></>;
}
