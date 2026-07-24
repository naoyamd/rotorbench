import type { Metadata } from "next";
import { PUBLISH_TASK_PROMPT } from "../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Publishing prompt | Engineering Design Benchmark Framework",
  description:
    "The immutable integration and publishing prompt used only after a candidate run is complete.",
};

export default function PublishTaskPage() {
  return (
    <main className="prompt-page prompt-page-publish" lang="ja">
      <section aria-labelledby="prompt-title">
        <p className="eyebrow">STAGE 02 / EDBF-PUBLISH-1.0</p>
        <h1 id="prompt-title">完成後に渡す反映・公開プロンプト</h1>
        <p className="prompt-lead">
          候補モデルには渡しません。成果完成後に開始する別の公開担当タスクへ、
          完成済み成果の場所とともにこのページのURLを渡します。
        </p>
        <pre className="prompt-block">
          <code>{PUBLISH_TASK_PROMPT}</code>
        </pre>
        <p className="prompt-source">
          Canonical source:{" "}
          <a href="https://github.com/naoyamd/rotorbench/blob/main/PUBLISH_TASK.md">
            PUBLISH_TASK.md
          </a>
        </p>
      </section>
    </main>
  );
}
