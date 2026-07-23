import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Publish Task | RotorBench",
  description:
    "完成済みのベンチマーク成果を改変せず、RotorBenchへ反映・公開するための手順。",
};

export default function PublishTaskPage() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <>
      <header className="site-header">
        <a className="wordmark" href={basePath || "/"}>
          <span className="wordmark-mark" aria-hidden="true">
            R
          </span>
          <span>
            <strong>ROTORBENCH</strong>
            <small>PUBLISH HANDOFF</small>
          </span>
        </a>
        <nav aria-label="公開ガイドナビゲーション">
          <a href={basePath || "/"}>HOME</a>
          <a href="https://github.com/naoyamd/rotorbench/blob/main/PUBLISH_TASK.md">
            MARKDOWN ↗
          </a>
        </nav>
      </header>

      <main className="task-page">
        <section className="task-hero" aria-labelledby="publish-title">
          <p className="section-index">PUBLISH HANDOFF / AFTER GENERATION</p>
          <h1 id="publish-title">
            モデル成果ページの
            <br />
            反映・公開手順
          </h1>
          <div className="boundary-note">
            <span>BOUNDARY</span>
            <p>
              完成済み成果を共通サイトへ接続する公開担当向けの手順です。
              成果を生成するモデルへは渡さず、生成完了後の別タスクで使用してください。
            </p>
          </div>
        </section>

        <section className="task-section" aria-labelledby="publish-input-title">
          <div className="task-section-label">01 / INPUT</div>
          <div className="task-section-body">
            <h2 id="publish-input-title">必要な入力</h2>
            <p>
              対象リポジトリは
              <a href="https://github.com/naoyamd/rotorbench">
                https://github.com/naoyamd/rotorbench
              </a>
              です。
            </p>
            <ul className="task-list">
              <li>
                完成済みの<code>submissions/&lt;candidate-id&gt;/</code>
                が存在する場所、またはその成果を生成したCodexタスク
              </li>
              <li>候補ID</li>
            </ul>
          </div>
        </section>

        <section className="task-section" aria-labelledby="integrate-title">
          <div className="task-section-label">02 / INTEGRATE</div>
          <div className="task-section-body">
            <h2 id="integrate-title">反映</h2>
            <ol className="task-list">
              <li>
                対象リポジトリの最新<code>main</code>を使用します。
              </li>
              <li>
                完成済みの候補ディレクトリを、同じ候補IDで
                <code>submissions/&lt;candidate-id&gt;/</code>へ取り込みます。
              </li>
              <li>取り込み前後のファイル内容が一致することを確認します。</li>
              <li>
                成果ページ、<code>manifest.json</code>、
                <code>BENCHMARK_PROMPT.md</code>は改変しません。
              </li>
              <li>
                共通サイト側で必要な修正だけを行い、
                <code>pnpm check</code>を通します。
              </li>
            </ol>
          </div>
        </section>

        <section className="task-section" aria-labelledby="publish-finish-title">
          <div className="task-section-label">03 / PUBLISH</div>
          <div className="task-section-body">
            <h2 id="publish-finish-title">公開</h2>
            <ol className="task-list">
              <li>対象リポジトリへcommit・pushします。</li>
              <li>GitHub Pagesの公開処理が成功するまで確認します。</li>
              <li>ホームと候補固有の成果ページをブラウザから確認します。</li>
              <li>候補ID、成果ページURL、検証結果を報告します。</li>
            </ol>
          </div>
        </section>

        <section className="task-section" aria-labelledby="instruction-title">
          <div className="task-section-label">04 / INSTRUCTION</div>
          <div className="task-section-body">
            <h2 id="instruction-title">Codexへの指示例</h2>
            <pre>
              <code>{`次の完成済み成果をRotorBenchへ反映し、公開確認まで完了してください。

反映手順:
https://naoyamd.github.io/rotorbench/publish-task/

候補ID:
<candidate-id>

成果物:
<成果を生成したCodexタスクのリンク、またはsubmissions/<candidate-id>/の絶対パス>`}</code>
            </pre>
            <div className="final-note">
              この公開タスクでは、成果物の改善、再設計、評価、ベンチマークの再実行は行いません。
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div>
          <strong>ROTORBENCH</strong>
          <span>Finished artifact in. Public result out.</span>
        </div>
        <p>PUBLISH TASK / 2026</p>
      </footer>
    </>
  );
}
