import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import {
  PUBLISH_LAUNCH_MESSAGE,
  PUBLISH_TASK_PROMPT,
} from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 2 cohort publishing | Engineering Design Benchmark Framework",
  description:
    "The separate Stage 2 workflow that seals candidate bundles and publishes a complete cohort together.",
};

export default function PublishTaskPage() {
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 02 / COHORT INTEGRATION &amp; PUBLICATION</p>
          <h1>Seal candidates separately, publish the cohort together</h1>
          <p>
            This operator-only task receives completed <code>candidate-output/</code>{" "}
            bundles. It never changes candidate work and is never sent to a candidate
            model.
          </p>
        </section>
        <section className="content-section">
          <h2>公開担当のCodexへ貼る全文</h2>
          <pre className="prompt-block"><code>{PUBLISH_LAUNCH_MESSAGE}</code></pre>
          <p>
            候補行は予定した全候補分を列挙します。候補が揃う前には、このStage 2を開始しません。
          </p>
        </section>
        <section className="content-section">
          <h2>Canonical handoff prompt</h2>
          <pre className="prompt-block"><code>{PUBLISH_TASK_PROMPT}</code></pre>
        </section>
        <section className="content-section">
          <h2>Fail-closed publication sequence</h2>
          <ol className="plain-list">
            <li>Define one open cohort with its launch, fairness fingerprint, and complete candidate ID list.</li>
            <li>Validate and byte-seal every candidate bundle into a cohort-bound run at <code>validated</code>.</li>
            <li>Run common validation and STEP preprocessing while derived evidence remains outside the public site.</li>
            <li>Publish the complete cohort in one rollback-protected transition after every member has a successful sealed report.</li>
            <li>Build the public catalog and verify downloads, viewer output, static links, GitHub Pages, and Sites.</li>
          </ol>
          <p>
            <a href="https://github.com/naoyamd/rotorbench/blob/main/PUBLISH_TASK.md">
              Canonical Stage 2 contract
            </a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
