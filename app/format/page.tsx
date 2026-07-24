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
          <p className="eyebrow">PUBLICATION FORMAT / 1.0</p>
          <h1>Common submission format</h1>
          <p>The framework separates the immutable task packet, candidate-owned evidence bundle, and Stage 2-owned publication record. It does not supply an engineering task, score, or reference answer.</p>
        </section>
        <section className="content-section">
          <h2>Two-stage sequence</h2>
          <pre className="code-block"><code>{`task-packets/<benchmark-id>/packet.json
launches/<launch-id>/launch.json
cohorts/<cohort-id>/cohort.json

candidate-output/
  submission.json
  plan.json
  initial-plan.sha256
  work-record.json
  artifacts/...

runs/<candidate-id>/
  run.json
  publication-report.json
  submitted/  # byte-identical candidate-output bundle`}</code></pre>
          <p>Stage 1 writes <code>initial-plan.sha256</code> as the single line <code>&lt;64hex&gt;  plan.json</code>, records its path and file hash as <code>submission.initialPlanCheckpoint</code>, and then preserves both it and <code>plan.json</code>. Stage 1 never assigns candidate identity or edits this repository. Stage 2 binds every run to an open cohort, validates and seals the complete bundle, fixes a successful publication report by hash, and publishes every planned cohort member together.</p>
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
          <h2>STEP display boundary</h2>
          <p>STEP files are checked and triangulated with the common Node/OpenCascade preprocessing step. The browser displays only the generated mesh JSON; it never parses the submitted STEP source. A failed STEP conversion becomes a visible validation report and download fallback, rather than breaking the run page.</p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
