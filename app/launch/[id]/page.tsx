import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFrameworkCatalog, getLaunch } from "../../framework-data";
import { sitePath } from "../../site-url";

export const dynamicParams = false;
export const dynamic = "force-static";
const emptyCatalogPlaceholder = "__framework-empty__";

export const metadata: Metadata = {
  title: "Executable Stage 1 launch | Engineering Design Benchmark",
  description: "A self-contained, immutable engineering benchmark execution prompt.",
};

export async function generateStaticParams() {
  const ids = getFrameworkCatalog().launches
    .map(({ id }) => ({ id }));
  return ids.length > 0 ? ids : [{ id: emptyCatalogPlaceholder }];
}

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === emptyCatalogPlaceholder) {
    return <main className="prompt-page"><section><h1>No launches published</h1></section></main>;
  }
  const entry = getLaunch(id);
  if (!entry) notFound();
  const executable = (
    entry.launch.releaseStatus === "live-verified"
    && typeof entry.launch.promptText === "string"
  );
  return (
    <main className="prompt-page launch-page" lang="ja">
      <section
        aria-labelledby="launch-title"
        data-stage1-launch-id={entry.launch.id}
        data-launch-digest={entry.launch.launchDigest}
        data-prompt-sha256={entry.launch.promptSha256}
      >
        <p className="eyebrow">
          {executable ? "EXECUTABLE STAGE 01" : "RELEASE VERIFICATION PENDING"}
          {" / "}{entry.launch.protocolVersion}
        </p>
        <h1 id="launch-title">{entry.packet.title}</h1>
        <p className="prompt-lead">
          {executable
            ? "このページは候補モデル向けの自己完結した実行プロンプトです。候補ID、公開処理、他候補の情報は含みません。"
            : "このlaunchは公開バイト列の検証中です。まだ候補モデルへ渡したり、設計作業を開始したりしないでください。"}
        </p>
        <dl className="launch-facts">
          <div><dt>Task packet</dt><dd>{entry.packet.id}@{entry.packet.version}</dd></div>
          <div><dt>Output</dt><dd>{entry.launch.outputRoot}/</dd></div>
          <div><dt>Fingerprint</dt><dd><code>{entry.launch.fairnessFingerprint}</code></dd></div>
        </dl>
        {entry.launch.protocolVersion === "4.0" ? (
          <section className="launch-v4-facts" aria-labelledby="v4-contract-title">
            <h2 id="v4-contract-title">Version 4 execution boundary</h2>
            <p>
              This launch binds a public bootstrap, checkpoint chain, partial-attainment
              record, and evaluator-run sanitization request. Private instances and
              private change payloads are not published here.
            </p>
            {entry.launch.workspaceBootstrap ? (
              <dl className="launch-facts">
                <div><dt>Bootstrap</dt><dd>{entry.launch.workspaceBootstrap.kind}</dd></div>
                <div><dt>Bootstrap SHA-256</dt><dd><code>{entry.launch.workspaceBootstrap.sha256}</code></dd></div>
              </dl>
            ) : null}
            {entry.packet.checkpoints && entry.packet.checkpoints.length > 0 ? (
              <ul>
                {entry.packet.checkpoints.map((checkpoint) => (
                  <li key={checkpoint.id}>
                    <code>{checkpoint.id}</code> — {checkpoint.title}
                    {checkpoint.requiredForBaseline === false
                      ? " (optional evaluator-controlled panel)"
                      : ""}
                  </li>
                ))}
              </ul>
            ) : null}
            {entry.packet.changeEvents && entry.packet.changeEvents.length > 0 ? (
              <ul aria-label="Sealed change-event commitments">
                {entry.packet.changeEvents.map((event) => (
                  <li key={event.id}>
                    <code>{event.id}</code> — trigger {event.triggerAfterCheckpointId};
                    commitment <code>{event.digest}</code>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ) : null}
        {executable ? (
          <pre className="prompt-block"><code>{entry.launch.promptText}</code></pre>
        ) : (
          <div className="final-note">
            Stage 1 is fail-closed until the canonical page, launch manifest,
            and prompt bytes have been live-verified and the verified state has
            been redeployed.
          </div>
        )}
        <p className="prompt-source">
          Machine sources:{" "}
          <a href={sitePath(entry.launch.manifestDownload ?? `framework/launches/${id}/launch.json`)}>launch.json</a>
          {executable && entry.launch.promptDownload ? <>
            {" · "}
            <a href={sitePath(entry.launch.promptDownload)}>prompt.txt</a>
          </> : null}
          {executable && entry.launch.executionContractRoot ? <>
            {" · "}
            <a href={sitePath(`${entry.launch.executionContractRoot}/contract.json`)}>execution contract</a>
          </> : null}
          {entry.packet.taskDefinitionDownload ? <>
            {" · "}
            <a href={sitePath(entry.packet.taskDefinitionDownload)}>task.json</a>
          </> : null}
          {entry.packet.lockDownload ? <>
            {" · "}
            <a href={sitePath(entry.packet.lockDownload)}>packet-lock.json</a>
          </> : null}
        </p>
      </section>
    </main>
  );
}
