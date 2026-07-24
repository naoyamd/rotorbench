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
  if (!entry || !entry.launch.promptText) notFound();
  return (
    <main className="prompt-page launch-page" lang="ja">
      <section
        aria-labelledby="launch-title"
        data-stage1-launch-id={entry.launch.id}
        data-launch-digest={entry.launch.launchDigest}
        data-prompt-sha256={entry.launch.promptSha256}
      >
        <p className="eyebrow">EXECUTABLE STAGE 01 / {entry.launch.protocolVersion}</p>
        <h1 id="launch-title">{entry.packet.title}</h1>
        <p className="prompt-lead">
          このページは候補モデル向けの自己完結した実行プロンプトです。
          候補ID、公開処理、他候補の情報は含みません。
        </p>
        <dl className="launch-facts">
          <div><dt>Task packet</dt><dd>{entry.packet.id}@{entry.packet.version}</dd></div>
          <div><dt>Output</dt><dd>{entry.launch.outputRoot}/</dd></div>
          <div><dt>Fingerprint</dt><dd><code>{entry.launch.fairnessFingerprint}</code></dd></div>
        </dl>
        <pre className="prompt-block"><code>{entry.launch.promptText}</code></pre>
        <p className="prompt-source">
          Machine sources:{" "}
          <a href={sitePath(entry.launch.manifestDownload ?? `framework/launches/${id}/launch.json`)}>launch.json</a>
          {" · "}
          <a href={sitePath(entry.launch.promptDownload ?? `framework/launches/${id}/prompt.txt`)}>prompt.txt</a>
          {" · "}
          <a href={sitePath(`${entry.launch.executionContractRoot}/contract.json`)}>execution contract</a>
        </p>
      </section>
    </main>
  );
}
