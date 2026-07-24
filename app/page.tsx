import type { Metadata } from "next";
import { getFrameworkCatalog } from "./framework-data";
import { SiteFooter, SiteHeader } from "./components/site-header";

export const metadata: Metadata = {
  title: "Engineering Design Benchmark Framework",
  description: "A static, task-neutral framework for publishing future engineering design benchmark evidence.",
};

export default function Home() {
  const { benchmarks, runs } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const isEmpty = benchmarks.length === 0 && runs.length === 0;
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">STATIC / TASK-NEUTRAL / INSPECTABLE</p>
          <h1 id="hero-title">Engineering Design<br /><em>Benchmark Framework</em></h1>
          <p className="lead">A common publication layer for future manufacturing design benchmarks. It defines portable evidence, validation, and review surfaces without supplying a task, design, score, or model-specific page.</p>
          <div className="count-grid" aria-label="Framework catalog counts">
            <div><strong>{benchmarks.length}</strong><span>BENCHMARKS</span></div>
            <div><strong>{runs.length}</strong><span>RUNS</span></div>
            <div><strong>6</strong><span>ARTIFACT ROLES</span></div>
          </div>
        </section>

        <section className="content-section" aria-labelledby="flow-title">
          <p className="eyebrow">HOW THE FRAMEWORK FLOWS</p><h2 id="flow-title">One neutral path from definition to evidence</h2>
          <ol className="flow">
            <li><span>01</span><div><strong>Define</strong><p>A benchmark manifest describes shared metadata. Any task-specific values remain in `extensions`.</p></div></li>
            <li><span>02</span><div><strong>Submit</strong><p>A run supplies editable CAD source, STEP, drawings, BOMs, calculations, and supporting files as applicable.</p></div></li>
            <li><span>03</span><div><strong>Process</strong><p>The common build system validates hashes and turns STEP into a deterministic viewer mesh.</p></div></li>
            <li><span>04</span><div><strong>Review</strong><p>Static pages expose neutral summaries, downloads, 3D evidence, and validation reports.</p></div></li>
          </ol>
        </section>

        <section className="empty-state" aria-labelledby="empty-title">
          <p className="eyebrow">CATALOG STATUS</p><h2 id="empty-title">{isEmpty ? "Ready for future benchmark definitions" : "Published framework catalog"}</h2>
          <p>{isEmpty ? "No benchmarks or runs are published in the new framework yet." : "Browse the published framework catalog."}</p>
          <div className="action-row"><a className="button-link" href={`${basePath}/benchmarks/`}>VIEW BENCHMARKS</a><a className="button-link secondary" href={`${basePath}/format/`}>VIEW FORMAT</a></div>
        </section>

        <section className="legacy-note" aria-labelledby="legacy-title"><p className="eyebrow">READ-ONLY LEGACY</p><h2 id="legacy-title">RotorBench RB-2.0 archive</h2><p>Existing RB-2.0 results remain available as a separate, read-only archive. They are not part of this framework’s benchmarks, runs, or comparisons.</p><a href={`${basePath}/legacy/`}>Open legacy archive information</a></section>
      </main>
      <SiteFooter />
    </>
  );
}
