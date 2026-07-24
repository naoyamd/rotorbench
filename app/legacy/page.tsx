import type { Metadata } from "next";
import legacyCatalog from "../../public/results/catalog.json";
import { SiteFooter, SiteHeader } from "../components/site-header";

export const metadata: Metadata = { title: "Legacy RB-2.0 | Engineering Design Benchmark Framework" };

type LegacyEntry = { id: string; title: string; provider: string; model: string; runDate: string };

export default function LegacyPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const entries = (legacyCatalog.results ?? []) as LegacyEntry[];
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">READ-ONLY / OUT OF FRAMEWORK</p><h1>RotorBench RB-2.0 archive</h1><p>These pre-existing result pages retain their original static URLs. They are isolated from the new framework catalog, benchmark detail pages, and comparison surface.</p></section>{entries.length === 0 ? <section className="empty-state"><p>The legacy catalog is available only when legacy pages are included in the static build.</p></section> : <ul className="card-list">{entries.map((entry) => <li key={entry.id}><a href={`${basePath}/results/${entry.id}/`}><p className="eyebrow">RB-2.0 / {entry.runDate}</p><h2>{entry.title}</h2><p>{entry.provider} · {entry.model}</p><span>OPEN PRESERVED RESULT</span></a></li>)}</ul>}</main><SiteFooter /></>;
}
