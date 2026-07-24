import type { Metadata } from "next";
import { getFrameworkCatalog } from "./framework-data";
import { SiteFooter, SiteHeader } from "./components/site-header";

export const metadata: Metadata = {
  title: "Engineering Design Benchmark Framework",
  description: "A static, task-neutral framework for publishing future engineering design benchmark evidence.",
};

export default function Home() {
  const { benchmarks, launches, runs } = getFrameworkCatalog();
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
            <div><strong>{launches.length}</strong><span>LAUNCHES</span></div>
            <div><strong>{runs.length}</strong><span>PUBLISHED RUNS</span></div>
          </div>
        </section>

        <section className="content-section" aria-labelledby="flow-title">
          <p className="eyebrow">HOW THE FRAMEWORK FLOWS</p><h2 id="flow-title">One neutral path from definition to evidence</h2>
          <ol className="flow">
            <li><span>01</span><div><strong>Packet</strong><p>Freeze the real task, inputs, hashes, environment, deliverables, and completion criteria.</p></div></li>
            <li><span>02</span><div><strong>Launch</strong><p>Every candidate receives the same self-contained launch URL in an isolated engineering workspace.</p></div></li>
            <li><span>03</span><div><strong>Evidence</strong><p>The candidate hands off an initial plan, decisions, verification, and engineering artifacts in one bundle.</p></div></li>
            <li><span>04</span><div><strong>Seal</strong><p>A separate publisher assigns identity, preserves the bundle byte-for-byte, validates STEP, and publishes.</p></div></li>
          </ol>
        </section>

        <section className="content-section handoff-section" aria-labelledby="handoff-title">
          <p className="eyebrow">TWO-STAGE HANDOFF</p>
          <h2 id="handoff-title">設計実行と公開を、成果bundleで分離する</h2>
          <div className="handoff-grid">
            <article>
              <span>STAGE 01</span>
              <h3>候補モデルが設計を実行</h3>
              <p>固定ランチャー文と同一launch URLだけを渡します。候補IDやRotorBenchの操作は要求しません。</p>
              <a className="button-link" href={`${basePath}/model-task/`}>STAGE 1 HANDOFF</a>
            </article>
            <article>
              <span>STAGE 02</span>
              <h3>別タスクが成果を公開</h3>
              <p>完成bundleと候補IDを別タスクへ渡し、改変せず封印して共通結果ページへ公開します。</p>
              <a className="button-link secondary" href={`${basePath}/publish-task/`}>STAGE 2 HANDOFF</a>
            </article>
          </div>
          <p className="handoff-rule">候補モデルにはStage 1のlaunch URLだけを渡します。Stage 2、既存結果、公開リポジトリは候補の作業環境から分離します。</p>
        </section>

        <section className="empty-state" aria-labelledby="empty-title">
          <p className="eyebrow">CATALOG STATUS</p><h2 id="empty-title">{isEmpty ? "Ready for future benchmark definitions" : "Published framework catalog"}</h2>
          <p>{isEmpty ? "No benchmarks or runs are published in the new framework yet." : "Browse the published framework catalog."}</p>
          <div className="action-row"><a className="button-link" href={`${basePath}/model-task/`}>OPEN STAGE 1 GUIDE</a><a className="button-link secondary" href={`${basePath}/benchmarks/`}>VIEW BENCHMARKS</a><a className="button-link secondary" href={`${basePath}/format/`}>VIEW FORMAT</a></div>
        </section>

        <section className="legacy-note" aria-labelledby="legacy-title"><p className="eyebrow">READ-ONLY LEGACY</p><h2 id="legacy-title">RotorBench RB-2.0 archive</h2><p>Existing RB-2.0 results remain available as a separate, read-only archive. They are not part of this framework’s benchmarks, runs, or comparisons.</p><a href={`${basePath}/legacy/`}>Open legacy archive information</a></section>
      </main>
      <SiteFooter />
    </>
  );
}
