import type { Metadata } from "next";
import { readFileSync } from "node:fs";
import path from "node:path";

export const metadata: Metadata = {
  title: "Common model prompt | Engineering Design Benchmark Framework",
  description:
    "The immutable common execution prompt supplied to every candidate model.",
};

const prompt = readFileSync(
  path.join(process.cwd(), "MODEL_TASK.md"),
  "utf8",
).trim();

export default function ModelTaskPage() {
  return (
    <main className="prompt-page" lang="ja">
      <section aria-labelledby="prompt-title">
        <p className="eyebrow">STAGE 01 / EDBF-COMMON-1.0</p>
        <h1 id="prompt-title">モデルへ渡す共通実行プロンプト</h1>
        <p className="prompt-lead">
          第1段階として、このページのURLをすべての候補モデルへ同一条件で渡します。
          課題固有の内容は現在のタスクで別途提供し、この共通指示は変更しません。
        </p>
        <pre className="prompt-block">
          <code>{prompt}</code>
        </pre>
        <p className="prompt-source">
          Canonical source:{" "}
          <a href="https://github.com/naoyamd/rotorbench/blob/main/MODEL_TASK.md">
            MODEL_TASK.md
          </a>
        </p>
      </section>
    </main>
  );
}
