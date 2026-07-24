import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getFrameworkCatalog, getLaunch } from "../../framework-data";
import { buildLaunchPrompt } from "../../../shared/prompts.mjs";

export const dynamicParams = false;
export const dynamic = "force-static";
const emptyCatalogPlaceholder = "__framework-empty__";

export const metadata: Metadata = {
  title: "Executable Stage 1 launch | Engineering Design Benchmark",
  description: "A self-contained, immutable engineering benchmark execution prompt.",
};

export async function generateStaticParams() {
  const ids = getFrameworkCatalog().launches.map(({ id }) => ({ id }));
  return ids.length > 0 ? ids : [{ id: emptyCatalogPlaceholder }];
}

export default async function LaunchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === emptyCatalogPlaceholder) {
    return <main className="prompt-page"><section><h1>No launches published</h1></section></main>;
  }
  const entry = getLaunch(id);
  if (!entry) notFound();
  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL ?? "https://rotorbench-lab.naoyamd.chatgpt.site";
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const packet = {
    ...entry.packet,
    inputs: entry.packet.inputs.map((input) => ({
      ...input,
      sourceUrl: `${siteUrl}${basePath}/${input.download}`.replace(/([^:]\/)\/+/g, "$1"),
    })),
    contractUrls: {
      plan: `${siteUrl}${basePath}/framework/contracts/plan.schema.json`,
      workRecord: `${siteUrl}${basePath}/framework/contracts/work-record.schema.json`,
      submission: `${siteUrl}${basePath}/framework/contracts/submission.schema.json`,
      artifact: `${siteUrl}${basePath}/framework/contracts/artifact.schema.json`,
    },
  };
  const prompt = buildLaunchPrompt(entry.launch, packet);
  return (
    <main className="prompt-page launch-page" lang="ja">
      <section aria-labelledby="launch-title">
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
        <pre className="prompt-block"><code>{prompt}</code></pre>
      </section>
    </main>
  );
}
