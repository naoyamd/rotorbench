import type { Metadata } from "next";
import { getFrameworkCatalog } from "../framework-data";
import { SiteFooter, SiteHeader } from "../components/site-header";
import {
  MODEL_LAUNCH_MESSAGE,
  MODEL_TASK_PROMPT,
} from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 1 launcher | Engineering Design Benchmark Framework",
  description:
    "The operator handoff that starts a self-contained engineering benchmark launch.",
};

export default function ModelTaskPage() {
  const { launches } = getFrameworkCatalog();
  return (
    <>
      <SiteHeader />
      <main className="listing-page" lang="ja">
        <section className="page-intro">
          <p className="eyebrow">STAGE 01 / OPERATOR HANDOFF</p>
          <h1>URLを、実行指示として成立させる</h1>
          <p>
            裸のURLだけではモデルへの指示になりません。将来の課題ごとに生成される
            launch URLを、下の固定ランチャー文と一緒に渡します。
          </p>
        </section>
        <section className="content-section">
          <h2>候補モデルへ貼る全文</h2>
          <pre className="prompt-block"><code>{MODEL_LAUNCH_MESSAGE}</code></pre>
          <p>
            <code>&lt;launch-url&gt;</code>だけを実際の
            <code>/launch/&lt;launch-id&gt;/</code>へ置き換えます。それ以外は全候補で変更しません。
          </p>
        </section>
        <section className="content-section">
          <h2>この入口が保証する境界</h2>
          <pre className="code-block"><code>{MODEL_TASK_PROMPT}</code></pre>
          <ul className="plain-list">
            <li>実課題、入力、hash、環境、完了条件はlaunch URL内で完結します。</li>
            <li>候補は別プロジェクトで設計し、固定の<code>candidate-output/</code>だけを引き渡します。</li>
            <li>候補IDの付与、RotorBenchへの登録、比較、評価、公開はStage 2へ分離します。</li>
            <li>初期計画と設計判断・代替案・検証証拠を構造化して残します。</li>
          </ul>
        </section>
        <section className="empty-state">
          <h2>{launches.length} executable launches</h2>
          <p>
            現在は実際のエンジニアリング課題を登録していないため、候補へ渡せるlaunch URLはありません。
          </p>
          <a className="button-link secondary" href="https://github.com/naoyamd/rotorbench/blob/main/MODEL_TASK.md">
            CANONICAL CONTRACT
          </a>
        </section>
      </main>
      <SiteFooter />
    </>
  );
}
