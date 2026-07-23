import type { Metadata } from "next";
import initialCatalog from "../public/results/catalog.json";
import { ResultCatalog, type ResultEntry } from "./result-catalog";

export const metadata: Metadata = {
  title: "RotorBench | Model Output Archive",
  description:
    "同じ共通プロンプトから生まれた、モデル固有の独立Webページを収集・公開するアーカイブ。",
};

const prompt = [
  "ヘリコプター主回転翼のスワッシュプレート式可変ピッチ機構を、ブラウザで操作できる技術デモとして実装してください。",
  "共通のGitHub Pagesで開く、モデル固有の独立コンテンツのWEBページとして実装してください。",
  "コレクティブ／サイクリックをリアルタイムに反映してください。",
  "模式図ではなく、実機・CAD志向の構造と運動を追求してください。",
  "ローターヘッドだけでなく、動力・伝達・制御までつながる機械システムとして捉えてください。",
  "未指定事項は自律的に判断し、最低限で止めず、改善を重ねて完成させてください。",
];

export default function Home() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

  return (
    <>
      <a className="skip-link" href="#results">
        生成結果へ移動
      </a>

      <header className="site-header">
        <a className="wordmark" href={basePath || "/"}>
          <span className="wordmark-mark" aria-hidden="true">
            R
          </span>
          <span>
            <strong>ROTORBENCH</strong>
            <small>MODEL OUTPUT ARCHIVE</small>
          </span>
        </a>
        <nav aria-label="メインナビゲーション">
          <a href="#results">RESULTS</a>
          <a href="#prompt">PROMPT</a>
          <a href={`${basePath}/model-task/`}>MODEL TASK</a>
          <a href="https://github.com/naoyamd/rotorbench">GITHUB ↗</a>
        </nav>
      </header>

      <main>
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-copy">
            <p className="hero-kicker">
              <span>RB-2.0</span>
              <span>STATIC ARCHIVE</span>
              <span>OPEN SOURCE</span>
            </p>
            <h1 id="hero-title">
              同じ課題から、
              <br />
              <em>違う答え</em>が生まれる。
            </h1>
            <p>
              RotorBenchは、各LLMが独立して制作した技術デモを、そのままの体験で保存・公開するためのホームです。
              共通UIで中身を均すのではなく、ページそのものをモデルの成果として並べます。
            </p>
          </div>
          <div className="hero-figure" aria-hidden="true">
            <div className="orbital-grid">
              <span className="orbit orbit-one" />
              <span className="orbit orbit-two" />
              <span className="rotor-axis" />
              <span className="rotor-blade blade-one" />
              <span className="rotor-blade blade-two" />
              <i />
            </div>
            <p>
              INDEPENDENT
              <br />
              IMPLEMENTATIONS
            </p>
          </div>
        </section>

        <ResultCatalog
          basePath={basePath}
          initialResults={initialCatalog.results as ResultEntry[]}
        />

        <section className="prompt-section" id="prompt" aria-labelledby="prompt-title">
          <div className="section-head">
            <div>
              <p className="section-index">02 / IMMUTABLE INPUT</p>
              <h2 id="prompt-title">共通プロンプト</h2>
              <p>全モデルに改変せず渡す、RB-2.0の正本です。</p>
            </div>
            <a
              className="text-link"
              href="https://github.com/naoyamd/rotorbench/blob/main/BENCHMARK_PROMPT.md"
            >
              VIEW SOURCE ↗
            </a>
          </div>
          <div className="prompt-sheet">
            <div className="prompt-sheet-head">
              <span>BENCHMARK_PROMPT.md</span>
              <span>LOCKED / RB-2.0</span>
            </div>
            <ul>
              {prompt.map((line, index) => (
                <li key={line}>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <p>{line}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="system-section" aria-labelledby="system-title">
          <div className="section-head">
            <div>
              <p className="section-index">03 / PUBLISHING SYSTEM</p>
              <h2 id="system-title">成果物だけを追加する。</h2>
              <p>ホーム画面や他モデルのページを変更せず、独立した結果を積み上げられます。</p>
            </div>
          </div>
          <ol className="system-flow">
            <li>
              <span>01</span>
              <div>
                <strong>GENERATE</strong>
                <p>モデルが独立した静的Webページを制作</p>
              </div>
            </li>
            <li>
              <span>02</span>
              <div>
                <strong>SUBMIT</strong>
                <p>ページ一式とmanifestを専用フォルダへ配置</p>
              </div>
            </li>
            <li>
              <span>03</span>
              <div>
                <strong>PUBLISH</strong>
                <p>ビルドが検証・一覧化し、共通サイトへ自動反映</p>
              </div>
            </li>
          </ol>
          <a className="system-guide-link" href={`${basePath}/model-task/`}>
            モデルへ渡す生成・提出手順を見る <span>↗</span>
          </a>
        </section>
      </main>

      <footer>
        <div>
          <strong>ROTORBENCH</strong>
          <span>Independent pages. One common prompt.</span>
        </div>
        <p>RESULT ARCHIVE / RB-2.0 / 2026</p>
      </footer>
    </>
  );
}
