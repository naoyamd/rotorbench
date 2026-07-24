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
          <p>The framework accepts evidence in well-defined roles but does not prescribe an engineering task, scoring rubric, CAD authoring method, or model output format.</p>
        </section>
        <section className="content-section">
          <h2>Manifest sequence</h2>
          <pre className="code-block"><code>{`benchmarks/<benchmark-id>/benchmark.json
runs/<run-id>/run.json
runs/<run-id>/<submitted files>`}</code></pre>
          <p>Each run pins `benchmarkVersion` and records model provider, name, and version. Each artifact carries a safe regular-file path, role, SHA-256 hash, and status. Benchmark-specific values belong in `extensions`.</p>
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
