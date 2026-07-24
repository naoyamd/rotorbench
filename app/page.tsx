import type { Metadata } from "next";
import { getFrameworkCatalog } from "./framework-data";
import { SiteFooter, SiteHeader } from "./components/site-header";
import { sitePath } from "./site-url";

export const metadata: Metadata = {
  title: "Engineering Design Benchmark Framework",
  description:
    "A static, task-neutral framework for preparing, executing, and publishing engineering design benchmark evidence.",
};

export default function Home() {
  const { benchmarks, launches, runs } = getFrameworkCatalog();
  const isEmpty = benchmarks.length === 0 && runs.length === 0;
  return (
    <>
      <SiteHeader />
      <main>
        <section className="hero" aria-labelledby="hero-title">
          <p className="eyebrow">STATIC / TASK-NEUTRAL / INSPECTABLE</p>
          <h1 id="hero-title">Engineering Design<br /><em>Benchmark Framework</em></h1>
          <p className="lead">
            A governed path from task definition to candidate evidence. The
            framework publishes protocols and proofs without supplying a task,
            design answer, score, or model-specific page.
          </p>
          <div className="count-grid" aria-label="Framework catalog counts">
            <div><strong>{benchmarks.length}</strong><span>BENCHMARKS</span></div>
            <div><strong>{launches.length}</strong><span>LAUNCHES</span></div>
            <div><strong>{runs.length}</strong><span>PUBLISHED RUNS</span></div>
          </div>
        </section>

        <section className="content-section" aria-labelledby="flow-title">
          <p className="eyebrow">THREE-STAGE SYSTEM</p>
          <h2 id="flow-title">Prepare, design, then publish</h2>
          <ol className="flow flow-three">
            <li>
              <span>00</span>
              <div><strong>Prepare</strong><p>Author a versioned task, freeze exact inputs and contracts, obtain independent reviews, approve, deploy, and live-verify.</p></div>
            </li>
            <li>
              <span>01</span>
              <div><strong>Design</strong><p>Give every candidate the same live-verified launch in an isolated workspace and collect one sealed evidence bundle.</p></div>
            </li>
            <li>
              <span>02</span>
              <div><strong>Publish</strong><p>Assign opaque identity separately, validate the byte-identical bundle, and release only a complete cohort.</p></div>
            </li>
          </ol>
        </section>

        <section className="content-section handoff-section" aria-labelledby="handoff-title">
          <p className="eyebrow">SEPARATED HANDOFFS</p>
          <h2 id="handoff-title">Each stage has one authority and one boundary</h2>
          <div className="handoff-grid handoff-grid-three">
            <article>
              <span>STAGE 00</span>
              <h3>Prepare the protocol</h3>
              <p>Coordinate author, independent reviewers, release approval, and live endpoint verification without solving the engineering task.</p>
              <a className="button-link" href={sitePath("stage0/")}>STAGE 0 PREP</a>
            </article>
            <article>
              <span>STAGE 01</span>
              <h3>Run the design task</h3>
              <p>Copy a complete live-verified launch handoff into each isolated candidate task. Candidate identity remains outside this stage.</p>
              <a className="button-link" href={sitePath("model-task/")}>STAGE 1 DESIGN</a>
            </article>
            <article>
              <span>STAGE 02</span>
              <h3>Seal and publish</h3>
              <p>Integrate completed candidate bundles byte-for-byte and publish only after every member of the planned cohort passes.</p>
              <a className="button-link" href={sitePath("publish-task/")}>STAGE 2 PUBLISH</a>
            </article>
          </div>
        </section>

        <section className="empty-state" aria-labelledby="empty-title">
          <p className="eyebrow">CATALOG STATUS</p>
          <h2 id="empty-title">
            {isEmpty ? "Ready for future benchmark definitions" : "Published framework catalog"}
          </h2>
          <p>
            {isEmpty
              ? "No real benchmark task, launch, candidate, or run is published."
              : "Browse the published framework catalog."}
          </p>
          <div className="action-row">
            <a className="button-link" href={sitePath("stage0/")}>START AT STAGE 0</a>
            <a className="button-link secondary" href={sitePath("benchmarks/")}>VIEW BENCHMARKS</a>
            <a className="button-link secondary" href={sitePath("format/")}>VIEW FORMAT</a>
          </div>
        </section>

        <section className="legacy-note" aria-labelledby="legacy-title">
          <p className="eyebrow">READ-ONLY LEGACY</p>
          <h2 id="legacy-title">RotorBench RB-2.0 archive</h2>
          <p>
            Existing RB-2.0 results remain available as a separate, read-only
            archive. They are not part of this framework&apos;s benchmarks,
            launches, or comparisons.
          </p>
          <a href={sitePath("legacy/")}>Open legacy archive information</a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
