import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Model Task | RotorBench",
  description:
    "ベンチマーク成果ページを共通サイトへ接続するための、内容非干渉の生成・提出手順。",
};

const scopeItems = [
  "完成した静的Webページ一式を site/ へ置き、入口を site/index.html にする。",
  "CSS、JavaScript、画像などは、配信先のサブパスでも動く相対URLで参照する。",
  "テンプレートと同じmanifest項目を、実行時に確認できた正確な事実で記録する。",
  "秘密情報、ローカル専用パス、共通サイト外の未公開資産に依存させない。",
];

const protectedItems = [
  "BENCHMARK_PROMPT.md",
  "app/、scripts/、公開・ビルド設定",
  "submissions/_template/",
  "他候補の submissions/<candidate-id>/",
];

export default function ModelTaskPage() {
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
            <small>MODEL HANDOFF</small>
          </span>
        </a>
        <nav aria-label="ガイドナビゲーション">
          <a href={basePath || "/"}>HOME</a>
          <a href="https://github.com/naoyamd/rotorbench/blob/main/MODEL_TASK.md">
            MARKDOWN ↗
          </a>
        </nav>
      </header>

      <main className="task-page">
        <section className="task-hero" aria-labelledby="task-title">
          <p className="section-index">MODEL HANDOFF / INTEGRATION ONLY</p>
          <h1 id="task-title">
            モデル成果ページの
            <br />
            生成・提出手順
          </h1>
          <div className="boundary-note">
            <span>BOUNDARY</span>
            <p>
              このページは成果物の配置と接続だけを定めます。成果ページの内容、技術、表現、設計判断、完成度の基準は追加しません。
              制作要件は
              <a href="https://github.com/naoyamd/rotorbench/blob/main/BENCHMARK_PROMPT.md">
                BENCHMARK_PROMPT.md
              </a>
              だけに従ってください。
            </p>
          </div>
        </section>

        <section className="task-section" aria-labelledby="start-title">
          <div className="task-section-label">01 / START</div>
          <div className="task-section-body">
            <h2 id="start-title">開始</h2>
            <ol className="task-list">
              <li>
                指定されたリポジトリとcommitを使用します。指定がなければ、このリポジトリの
                <code>main</code>を使用します。
              </li>
              <li>
                <code>BENCHMARK_PROMPT.md</code>を改変せずに読み、その内容を実装します。
              </li>
              <li>他候補の成果ページは参照しません。</li>
              <li>
                候補IDが未指定なら、実際のprovider・model・reasoningを小文字のkebab-caseで連結して決めます。
              </li>
            </ol>
          </div>
        </section>

        <section className="task-section" aria-labelledby="scope-title">
          <div className="task-section-label">02 / SCOPE</div>
          <div className="task-section-body">
            <h2 id="scope-title">作業範囲</h2>
            <p>新規に作成する次の場所だけを編集します。</p>
            <pre aria-label="成果物のディレクトリ構成">
              <code>{`submissions/<candidate-id>/
├─ manifest.json
└─ site/
   ├─ index.html
   └─ ...`}</code>
            </pre>
            <ul className="task-list">
              {scopeItems.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>

        <section className="task-section" aria-labelledby="protect-title">
          <div className="task-section-label">03 / PROTECT</div>
          <div className="task-section-body">
            <h2 id="protect-title">変更しないもの</h2>
            <ul className="protected-grid">
              {protectedItems.map((item) => (
                <li key={item}>
                  <span>LOCKED</span>
                  <code>{item}</code>
                </li>
              ))}
            </ul>
            <p>
              共通ホームへの登録処理、公開処理、共通UIの変更は行いません。
            </p>
          </div>
        </section>

        <section className="task-section" aria-labelledby="finish-title">
          <div className="task-section-label">04 / FINISH</div>
          <div className="task-section-body">
            <h2 id="finish-title">完了</h2>
            <ol className="task-list">
              <li>
                必要な生成処理がある場合は実行し、最終的な静的成果物を
                <code>site/</code>へ格納します。
              </li>
              <li>
                リポジトリ直下で<code>pnpm check</code>を実行します。
              </li>
              <li>候補ID、成果物の場所、検証結果を報告して終了します。</li>
            </ol>
            <div className="final-note">
              この手順にない制作上の判断は追加要件と解釈せず、正本プロンプトとモデル自身の判断に委ねます。
            </div>
          </div>
        </section>
      </main>

      <footer>
        <div>
          <strong>ROTORBENCH</strong>
          <span>Mechanical handoff. Creative boundary preserved.</span>
        </div>
        <p>MODEL TASK / RB-2.0 / 2026</p>
      </footer>
    </>
  );
}
