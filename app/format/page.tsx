import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";

export const metadata: Metadata = {
  title: "Format | Engineering Design Benchmark Framework",
};

const roles = [
  ["cad-source", "Editable CAD source"],
  ["step", "STEP exchange model"],
  ["drawing", "Drawing"],
  ["bom", "Bill of materials"],
  ["calculation", "Calculation"],
  ["supporting", "Supporting file"],
];

export default function FormatPage() {
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">EVIDENCE FORMAT / EDBF 4.0</p>
          <h1>Sealed engineering evidence format</h1>
          <p>The framework separates Stage 0 protocol governance, the Stage 1 candidate-owned engineering bundle, and the Stage 2-owned sanitization, assessment, and publication records. The current task and public scoring contract are frozen separately from every candidate answer.</p>
        </section>
        <section className="content-section">
          <h2>Three-stage sequence</h2>
          <pre className="code-block"><code>{`task-packets/<benchmark-id>/<version>/
  task.json
  packet.json
  packet-lock.json

launches/<launch-id>/
  launch.json
  prompt.txt
  baseline-attestation.json
  execution-profile.json
  execution-contract/
  release.json

cohorts/<cohort-id>/
  cohort.json
  measurement-conditions.json

candidate-output/
  workspace-receipt.json
  submission.json
  plan.json
  initial-plan.sha256
  work-record.json
  receipts/
  artifacts/...

runs/<opaque-run-id>/
  run.json
  evaluation-record.json
  sanitization-report.json
  publication-report.json
  submitted/   # byte-identical candidate-output
  sanitized/   # evaluator-admitted static evidence only`}</code></pre>
          <p>Stage 0 freezes the versioned task, Git baseline, workspace bootstrap, execution contract, prompt, independent reviews, scoring runtime, and release state. Stage 1 starts only from a live-verified launch and an operator-created isolated workspace; its immutable receipt is hash-bound into the pre-run authorization. The candidate preserves that receipt and the immutable initial plan, then appends checkpoint receipts as work advances. Protocol v4 carries packet, bundle, execution-contract, prompt, launch, scoring, sanitization, and fairness digests through <code>submission.json</code>. Stage 2 validates the same bindings, seals the original bytes, sanitizes without executing candidate code, finalizes independent engineering ratings, and publishes every planned cohort member together.</p>
        </section>
        <section className="content-section">
          <h2>Process evidence</h2>
          <p><code>plan.json</code> captures requirements, assumptions, steps, alternatives to evaluate, and the verification plan before design work. <code>work-record.json</code> separately captures evaluated alternatives, decisions and trade-offs, plan revisions, and requirement-linked verification claims.</p>
        </section>
        <section className="content-section">
          <h2>Artifact roles</h2>
          <dl className="role-grid">
            {roles.map(([role, label]) => <div key={role}><dt><code>{role}</code></dt><dd>{label}</dd></div>)}
          </dl>
        </section>
        <section className="content-section">
          <h2>Static evaluation boundary</h2>
          <p>STEP, indexed drawings/PMI, structured evidence, and opaque native CAD are admitted only through the launch-frozen sanitizer and artifact contract. Native CAD is retained read-only. The evaluator and browser never execute candidate scripts, macros, binaries, HTML, JavaScript, or embedded CAD code. Browser geometry uses only common derived mesh output.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
