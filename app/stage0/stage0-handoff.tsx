import { SiteFooter, SiteHeader } from "../components/site-header";

type Stage0HandoffProps = {
  eyebrow: string;
  title: string;
  lead: string;
  prompt: string;
  boundaryTitle: string;
  boundaries: string[];
};

export function Stage0Handoff({
  eyebrow,
  title,
  lead,
  prompt,
  boundaryTitle,
  boundaries,
}: Stage0HandoffProps) {
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">{eyebrow}</p>
          <h1>{title}</h1>
          <p>{lead}</p>
        </section>
        <section className="content-section">
          <h2>Paste this entire block into a separate Codex task</h2>
          <p>
            Keep the fixed instruction, page URL, and every required placeholder
            together. The URL by itself does not authorize work.
          </p>
          <pre className="prompt-block"><code>{prompt}</code></pre>
        </section>
        <section className="content-section">
          <h2>{boundaryTitle}</h2>
          <ol className="plain-list">
            {boundaries.map((boundary) => <li key={boundary}>{boundary}</li>)}
          </ol>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
