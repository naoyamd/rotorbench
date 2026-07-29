import type { Metadata } from "next";
import { getFrameworkCatalog } from "../framework-data";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { absoluteSiteUrl, sitePath } from "../site-url";
import { buildModelLaunchMessage } from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 1 launcher | Engineering Design Benchmark Framework",
  description:
    "Activation-verified, self-contained engineering benchmark launch handoffs.",
};

function canonicalLaunchUrl(
  launch: ReturnType<typeof getFrameworkCatalog>["launches"][number],
) {
  const canonicalBase = launch.canonicalBaseUrl?.replace(/\/+$/, "");
  return canonicalBase
    ? `${canonicalBase}/launch/${launch.id}/`
    : absoluteSiteUrl(`launch/${launch.id}/`);
}

export default function ModelTaskPage() {
  const launches = getFrameworkCatalog().launches.filter(
    ({ handoffEligible }) => handoffEligible === true,
  );
  return (
    <>
      <SiteHeader />
      <main className="listing-page">
        <section className="page-intro">
          <p className="eyebrow">STAGE 01 / ACTIVATION-VERIFIED HANDOFF</p>
          <h1>Prepare one isolated run, then paste one prompt</h1>
          <p>
            候補モデルへ渡すのは、最後に表示される固定文と正規URLの
            1ブロックだけです。その前に運用者が、候補ごとに新しい隔離
            ワークスペースを生成し、そのreceiptを実行許可へ結びます。
          </p>
        </section>
        {launches.length > 0 ? (
          <>
            <section className="content-section" aria-labelledby="pre-run-freeze">
              <p className="eyebrow">OPERATOR ONLY / BEFORE THE FIRST RUN</p>
              <h2 id="pre-run-freeze">Stage A — prepare and authorize the run</h2>
              <ol className="plain-list">
                <li>
                  Download the{" "}
                  <a href={sitePath("framework/evaluation/integrated-robotic-handling-v1/measurement-conditions-template.json")}>
                    measurement-conditions template
                  </a>
                  , assign every opaque run ID, and keep the real model mapping
                  outside the candidate workspace.
                </li>
                <li>
                  Fix the same elapsed-time, token, reasoning, tool, network, and
                  zero-intervention conditions for every run. The official design
                  comparison uses three independent runs per model.
                </li>
                <li>
                  Open the cohort before any candidate starts with{" "}
                  <code>
                    pnpm stage2:open-cohort -- --cohort-id &lt;id&gt; --launch-id
                    {" "}&lt;launch-id&gt; --conditions &lt;measurement-conditions.json&gt;
                  </code>
                  . The cohort must be opened after the detached launch
                  activation; pre-activation state is not measurement-eligible.
                </li>
                <li>
                  For every run, create a new directory outside this repository
                  and materialize the exact launch-bound workspace with{" "}
                  <code>
                    pnpm stage1:prepare-workspace -- --launch-id
                    {" "}&lt;launch-id&gt; --target &lt;new-absolute-directory&gt;
                  </code>
                  . Save the returned <code>receiptSha256</code>. Its
                  <code>createdAt</code> must be at or after launch activation
                  and cohort opening.
                </li>
                <li>
                  Enforce the generated <code>isolation-policy.json</code> in
                  the candidate harness. It permits the exact launch URL and
                  common public technical research, and denies all other
                  RotorBench, repository, result, comparison, cohort, run, and
                  publication surfaces.
                </li>
                <li>
                  Before the model starts, issue its immutable operator
                  attestation with{" "}
                  <code>
                    pnpm stage1:authorize-run -- --cohort-id &lt;id&gt;
                    {" "}--run-id &lt;opaque-run-id&gt; --operator-pseudonym
                    {" "}&lt;operator-id&gt;
                    {" "}--external-run-configuration-sha256
                    {" "}&lt;receiptSha256&gt;
                  </code>
                  . Do not backfill it after the model begins.
                </li>
                <li>
                  Start a fresh model task with the generated directory as its
                  working directory. Paste only the Stage B block below.
                </li>
              </ol>
              <p>
                These operator records are not sent to the candidate. They are
                auditable attestations, not cryptographic proof of provider
                start time or external network enforcement. Stage 2 rejects a
                missing, changed, late, or differently authorized workspace
                receipt. Use only the package commands shown here; direct
                execution of a frozen runtime file is not an authorized run.
              </p>
            </section>
            <section className="content-section" aria-labelledby="live-launches">
              <p className="eyebrow">MODEL-FACING / COPY EXACTLY</p>
              <h2 id="live-launches">Stage B — paste one launch prompt</h2>
              {launches.map((launch) => {
                const launchUrl = canonicalLaunchUrl(launch);
                return (
                  <article className="launch-handoff" key={launch.id}>
                    <p className="eyebrow">{launch.id} / {launch.protocolVersion}</p>
                    <p>
                      The model receives only the complete block below. The
                      launch page is the executable task prompt; the surrounding
                      operator instructions are not part of its design brief.
                    </p>
                    <pre className="prompt-block"><code>{buildModelLaunchMessage(launchUrl)}</code></pre>
                    <p>
                      <a href={launchUrl}>Inspect the executable launch</a>
                      {" · "}
                      <a href={sitePath(launch.manifestDownload ?? `framework/launches/${launch.id}/launch.json`)}>launch.json</a>
                      {" · "}
                      {launch.promptDownload
                        ? <a href={sitePath(launch.promptDownload)}>prompt.txt</a>
                        : null}
                      {launch.protocolVersion === "4.0" ? <>
                        {" · "}
                        <span>V4: public bootstrap and checkpoint contract; private payloads remain withheld.</span>
                      </> : null}
                    </p>
                  </article>
                );
              })}
            </section>
          </>
        ) : (
          <section className="empty-state">
            <p className="eyebrow">0 ACTIVATION-VERIFIED HANDOFFS</p>
            <h2>Stage 1 is intentionally closed</h2>
            <p>
              No task prompt is available until Stage 0 has completed
              independent approval, live endpoint verification, and the
              post-activation semantic audit.
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
