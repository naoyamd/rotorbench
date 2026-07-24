import type { Metadata } from "next";
import { getFrameworkCatalog } from "../framework-data";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { absoluteSiteUrl, sitePath } from "../site-url";
import { buildModelLaunchMessage } from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 1 launcher | Engineering Design Benchmark Framework",
  description:
    "Live-verified, self-contained engineering benchmark launch handoffs.",
};

export default function ModelTaskPage() {
  const launches = getFrameworkCatalog().launches.filter(
    ({ releaseStatus }) => releaseStatus === "live-verified",
  );
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 01 / LIVE-VERIFIED HANDOFF</p>
          <h1>Start design from a verified launch</h1>
          <p>
            A URL alone is not an instruction. Copy one complete block below
            into an isolated candidate task. Every listed launch has completed
            Stage 0 authoring, independent review, approval, deployment, and
            live verification.
          </p>
        </section>
        {launches.length > 0 ? (
          <section className="content-section" aria-labelledby="live-launches">
            <h2 id="live-launches">Live-verified launches</h2>
            {launches.map((launch) => {
              const launchUrl = absoluteSiteUrl(`launch/${launch.id}/`);
              return (
                <article className="launch-handoff" key={launch.id}>
                  <p className="eyebrow">{launch.id} / {launch.protocolVersion}</p>
                  <pre className="prompt-block"><code>{buildModelLaunchMessage(launchUrl)}</code></pre>
                  <p>
                    <a href={sitePath(`launch/${launch.id}/`)}>Inspect the executable launch</a>
                    {" · "}
                    <a href={sitePath(launch.manifestDownload ?? `framework/launches/${launch.id}/launch.json`)}>launch.json</a>
                    {" · "}
                    {launch.promptDownload
                      ? <a href={sitePath(launch.promptDownload)}>prompt.txt</a>
                      : null}
                  </p>
                </article>
              );
            })}
          </section>
        ) : (
          <section className="empty-state">
            <p className="eyebrow">0 LIVE-VERIFIED LAUNCHES</p>
            <h2>Stage 1 is intentionally closed</h2>
            <p>
              No task prompt is available until Stage 0 has completed
              independent approval and live endpoint verification.
            </p>
            <a className="button-link" href={sitePath("stage0/")}>
              OPEN STAGE 0 PREPARATION
            </a>
          </section>
        )}
      </main>
      <SiteFooter />
    </>
  );
}
