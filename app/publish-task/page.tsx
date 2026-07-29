import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { sitePath } from "../site-url";

export const metadata: Metadata = {
  title: "Stage 2 handoff moved | Engineering Design Benchmark",
  description:
    "Compatibility entry for the current sealed evaluation and cohort publication workflow.",
};

export default function PublishTaskPage() {
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 02 / CURRENT PROTOCOL V4</p>
          <h1>Evaluation and publication now share one handoff</h1>
          <p>
            The former publish-only procedure is obsolete. Version 4 freezes the
            cohort and equal run conditions before Stage 1, then evaluates each
            sealed result before the complete cohort can be published.
          </p>
          <a className="button-link" href={sitePath("evaluate-task/")}>
            OPEN CURRENT STAGE 2 HANDOFF
          </a>
        </section>
        <section className="content-section">
          <h2>Why this page remains</h2>
          <p>
            Existing links continue to resolve, but no old command or prompt is
            executable here. The current procedure is maintained only at the Stage
            2 evaluation URL and in{" "}
            <a href="https://github.com/naoyamd/rotorbench/blob/main/EVALUATE_TASK.md">
              EVALUATE_TASK.md
            </a>
            .
          </p>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
