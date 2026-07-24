import type { Metadata } from "next";
import { getStage0Report } from "../framework-data";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { absoluteSiteUrl, sitePath } from "../site-url";
import {
  STAGE0_COORDINATOR_HANDOFF,
  materializeHandoffValues,
} from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 0 preparation | Engineering Design Benchmark Framework",
  description:
    "Author, independently review, approve, release, and live-verify an immutable benchmark launch.",
};

export default function Stage0Page() {
  const report = getStage0Report();
  const prompt = materializeHandoffValues(STAGE0_COORDINATOR_HANDOFF, {
    "<stage0-url>": absoluteSiteUrl("stage0/"),
    "<stage0-author-url>": absoluteSiteUrl("stage0/author/"),
    "<stage0-review-url>": absoluteSiteUrl("stage0/review/"),
    "<stage0-release-url>": absoluteSiteUrl("stage0/release/"),
  });
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 00 / PREPARE &amp; GOVERN</p>
          <h1>Freeze the protocol before design begins</h1>
          <p>
            Stage 0 separates authorship, independent review, release approval,
            and live verification. It produces no design answer and gives no
            candidate identity.
          </p>
        </section>
        <section className="content-section" aria-labelledby="stage0-status">
          <p className="eyebrow">PUBLIC STATUS</p>
          <h2 id="stage0-status">Fail-closed by default</h2>
          <dl className="launch-facts">
            <div><dt>Draft or held records</dt><dd>{report.counts.draftOrHeldRecords}</dd></div>
            <div><dt>Records with blockers</dt><dd>{report.counts.recordsWithBlockers}</dd></div>
            <div><dt>Live-verified launches</dt><dd>{report.counts.liveVerifiedLaunches}</dd></div>
          </dl>
          <p>
            Draft, unapproved, and retired launches never appear in the Stage 1
            handoff. This page exposes aggregate state only—not unpublished
            task text or prompts.
          </p>
        </section>
        <section className="content-section">
          <h2>Paste this entire block into a Stage 0 coordinator task</h2>
          <pre className="prompt-block"><code>{prompt}</code></pre>
        </section>
        <section className="content-section">
          <h2>Three separated responsibilities</h2>
          <div className="handoff-grid handoff-grid-three">
            <article>
              <span>AUTHOR</span>
              <h3>Define without solving</h3>
              <p>Prepare a versioned draft with declared inputs, evidence relationships, and no guessed engineering values.</p>
              <a className="button-link secondary" href={sitePath("stage0/author/")}>AUTHOR HANDOFF</a>
            </article>
            <article>
              <span>REVIEW</span>
              <h3>Review frozen bytes</h3>
              <p>Use different non-author reviewers for engineering and protocol approval. Reviewers do not edit the subject.</p>
              <a className="button-link secondary" href={sitePath("stage0/review/")}>REVIEW HANDOFF</a>
            </article>
            <article>
              <span>RELEASE</span>
              <h3>Transition bound state</h3>
              <p>Require the exact launch digest and explicit approval, then verify the deployed machine endpoints.</p>
              <a className="button-link secondary" href={sitePath("stage0/release/")}>RELEASE HANDOFF</a>
            </article>
          </div>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
