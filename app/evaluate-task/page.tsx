import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { EVALUATE_LAUNCH_MESSAGE } from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 2 evaluation | Engineering Design Benchmark",
  description:
    "Operator handoff for byte-sealed validation, independent engineering review, multidimensional scoring, and cohort publication.",
};

export default function EvaluateTaskPage() {
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 02 / EVALUATE AFTER THE CANDIDATE STOPS</p>
          <h1>Measure the design without rewriting it</h1>
          <p>
            This URL is for a separate evaluator task after Stage 1. It seals the
            candidate&apos;s bytes, runs common checks, obtains independent engineering
            ratings, and records a ten-dimensional capability vector. Never give this
            page to the candidate model.
          </p>
        </section>
        <section className="content-section">
          <p className="eyebrow">COPY THIS COMPLETE BLOCK</p>
          <h2>評価担当へ渡すプロンプト</h2>
          <pre className="prompt-block"><code>{EVALUATE_LAUNCH_MESSAGE}</code></pre>
        </section>
        <section className="content-section">
          <p className="eyebrow">SEALED SEQUENCE</p>
          <h2>Integrate, sanitize, review, finalize</h2>
          <ol className="plain-list">
            <li>
              Confirm the operator-recorded <code>frozenAt &lt;= openedAt</code>
              freeze for the cohort, opaque run assignments, equal measurement
              conditions, and the run&apos;s immutable
              <code> operator-attested-pre-run</code> record. Confirm that it
              binds the unchanged{" "}
              <code>candidate-output/workspace-receipt.json</code> created by
              the operator before the model began. These are auditable pre-run
              controls, not cryptographic proof of candidate start time or
              external network enforcement.
            </li>
            <li>
              Integrate and byte-seal the finished bundle without changing
              candidate-owned files.
            </li>
            <li>
              Run the frozen static sanitizer, then build the opaque review
              package. Give primary reviewers only that package; candidate code
              is never executed.
            </li>
            <li>
              Give each reviewer the neutral template outside the repository,
              then seal its completed input into an evaluator-owned opaque
              record. Bind package and record hashes into the assessment;
              primary and secondary reviews are required, with an adjudicator
              on material disagreement.
            </li>
            <li>
              Score from the public deterministic rubric and the sealed review
              records, then re-read their hashes while finalizing the
              evaluator record. After every predeclared
              cohort run is finalized, publish with the exact operator-owned
              disclosure: <code>pnpm stage2:publish-cohort -- --cohort-id
              &lt;id&gt; --disclosure &lt;cohort-disclosure.json&gt;</code>.
            </li>
            <li>
              In the private evaluator workspace, use the launch-frozen
              <code> stage2:export-publication</code> command to write one
              manifest-bound bundle outside that workspace. In a clean public
              clone, use <code>publication:import</code> to add only that
              bundle. Never commit raw <code>runs/</code>, <code>cohorts/</code>,
              review packages, or evaluator records.
            </li>
          </ol>
        </section>
        <section className="content-section">
          <h2>What becomes measurable</h2>
          <ol className="plain-list">
            <li>A0 admission and independent B0–B6 engineering gates.</li>
            <li>The highest append-only checkpoint reached, even when the assembly is incomplete.</li>
            <li>Ten ordinal engineering dimensions with reviewer intervals and evidence coverage.</li>
            <li>Raw geometry, grasp, load, tolerance, manufacturing, safety, cost, mass, and energy metrics.</li>
            <li>Baseline and change qualification as separate results.</li>
            <li>Execution time and cost on a separate, non-ranking record.</li>
          </ol>
        </section>
        <section className="content-section">
          <h2>Fail-closed boundaries</h2>
          <p>
            Missing work is partial attainment, not an invalid artifact. Evaluator
            limitations remain visible as <code>evaluator-unsupported</code> or{" "}
            <code>evaluator-uncertain</code>. No uncalibrated composite score is
            emitted.
          </p>
          <p>
            <a href="https://github.com/naoyamd/rotorbench/blob/main/EVALUATE_TASK.md">
              Canonical evaluation handoff
            </a>
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
