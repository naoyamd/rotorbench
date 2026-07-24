import type { Artifact, Run } from "../framework-data";
import { publicPath } from "../framework-data";
import { StepViewer } from "./step-viewer";

const roleLabels: Record<Artifact["role"], string> = {
  "cad-source": "Editable CAD source",
  step: "STEP exchange model",
  drawing: "Drawing",
  bom: "Bill of materials",
  calculation: "Calculation",
  supporting: "Supporting file",
};

function ArtifactList({ artifacts, basePath }: { artifacts: Artifact[]; basePath: string }) {
  if (artifacts.length === 0) return <p className="empty-copy">No files have been submitted for this run.</p>;
  return (
    <ul className="artifact-list">
      {artifacts.map((artifact) => (
        <li key={artifact.id}>
          <div>
            <strong>{artifact.label ?? artifact.id}</strong>
            <span>{roleLabels[artifact.role]} · {artifact.path}</span>
            <code>SHA-256 {artifact.sha256}</code>
          </div>
          <a className="button-link" href={publicPath(basePath, artifact.download)} download>DOWNLOAD</a>
        </li>
      ))}
    </ul>
  );
}

export function RunDetail({ run, basePath }: { run: Run; basePath: string }) {
  const stepArtifacts = run.artifacts.filter((artifact) => artifact.role === "step");
  const byRole = (role: Artifact["role"]) => run.artifacts.filter((artifact) => artifact.role === role);
  const validation = run.validation;
  return (
    <main className="detail-page">
      <section className="detail-hero">
        <p className="eyebrow">RUN / {run.id}</p>
        <h1>{run.id}</h1>
        <p>{run.summary ?? "A submitted engineering design benchmark run."}</p>
        <dl className="metadata-grid">
          <div><dt>Benchmark</dt><dd><a href={`${basePath}/benchmarks/${run.benchmarkId}/`}>{run.benchmarkId} / {run.benchmarkVersion}</a></dd></div>
          <div><dt>Run status</dt><dd>{run.status}</dd></div>
          <div><dt>Submitted</dt><dd>{new Date(run.submittedAt).toISOString()}</dd></div>
          <div><dt>Model</dt><dd>{[run.model.provider, run.model.name, run.model.version].join(" / ")}</dd></div>
        </dl>
      </section>

      <nav className="section-nav" aria-label="Run sections">
        <a href="#overview">OVERVIEW</a><a href="#model">3D</a><a href="#drawing">DRAWING</a><a href="#bom">BOM</a><a href="#calculation">CALCULATION</a><a href="#files">FILES</a><a href="#validation">VALIDATION</a>
      </nav>

      <section id="overview" className="content-section"><h2>Overview</h2><p>This neutral shell exposes the submitted evidence without embedding model-supplied HTML, scripts, or styling.</p></section>
      <section id="model" className="content-section"><h2>3D</h2>
        {stepArtifacts.length === 0 ? <p className="empty-copy">No STEP artifact was submitted.</p> : stepArtifacts.map((artifact) => artifact.viewer?.status === "ready" ? (
          <StepViewer key={artifact.id} label={artifact.label ?? artifact.id} meshUrl={publicPath(basePath, artifact.viewer.mesh)} />
        ) : <div className="notice" key={artifact.id}><strong>3D display unavailable</strong><p>{artifact.viewer?.message ?? "STEP preprocessing did not produce a viewer asset."}</p><a href={publicPath(basePath, artifact.download)} download>Download original STEP</a></div>)}
      </section>
      <section id="drawing" className="content-section"><h2>Drawing</h2><ArtifactList artifacts={byRole("drawing")} basePath={basePath} /></section>
      <section id="bom" className="content-section"><h2>Bill of materials</h2><ArtifactList artifacts={byRole("bom")} basePath={basePath} /></section>
      <section id="calculation" className="content-section"><h2>Calculation</h2><ArtifactList artifacts={byRole("calculation")} basePath={basePath} /></section>
      <section id="files" className="content-section"><h2>Files</h2><ArtifactList artifacts={run.artifacts} basePath={basePath} /></section>
      <section id="validation" className="content-section"><h2>Validation</h2>
        {!validation ? <p className="empty-copy">No validation report is available yet.</p> : <>
          <p className={`status status-${validation.status}`}>{validation.status.toUpperCase()}</p>
          <ul className="check-list">{validation.checks.map((item, index) => <li key={`${item.name}-${index}`}><strong className={`check-${item.status}`}>{item.status.toUpperCase()}</strong><span>{item.name}{item.detail ? ` — ${item.detail}` : ""}</span></li>)}</ul>
          {validation.issues.length > 0 ? <ul className="issue-list">{validation.issues.map((item) => <li key={`${item.code}-${item.path ?? ""}`}><code>{item.code}</code> {item.message}</li>)}</ul> : <p className="empty-copy">No validation issues were reported.</p>}
        </>}
      </section>
    </main>
  );
}
