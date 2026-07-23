import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the static export contains the result archive home", async () => {
  const html = await readFile(
    new URL("../out/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<title>RotorBench \| Model Output Archive<\/title>/);
  assert.match(html, /MODEL OUTPUT ARCHIVE/);
  assert.match(html, /生成結果/);
  assert.match(html, /openai-gpt-5-6-terra-max/);
  assert.match(html, /Swashplate Rotor System/);
  assert.match(html, /共通プロンプト/);
  assert.match(html, /成果物だけを追加する。/);
  assert.doesNotMatch(html, /Luna xhigh|Reference Kinematics|A\s*\/\s*B 比較/);
});

test("the static export contains a benchmark-neutral model handoff", async () => {
  const html = await readFile(
    new URL("../out/model-task/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<title>Model Task \| RotorBench<\/title>/);
  assert.match(html, /モデル成果ページの/);
  assert.match(html, /生成・提出手順/);
  assert.match(html, /成果ページの内容、技術、表現、設計判断、完成度の基準は追加しません/);
  assert.match(html, /https:\/\/github\.com\/naoyamd\/rotorbench/);
  assert.match(html, /submissions\/&lt;candidate-id&gt;\//);
  assert.match(html, /pnpm check/);
  assert.doesNotMatch(html, /スワッシュプレート式可変ピッチ機構/);
});

test("the static export contains the separate publishing handoff", async () => {
  const html = await readFile(
    new URL("../out/publish-task/index.html", import.meta.url),
    "utf8",
  );

  assert.match(html, /<title>Publish Task \| RotorBench<\/title>/);
  assert.match(html, /モデル成果ページの/);
  assert.match(html, /反映・公開手順/);
  assert.match(html, /成果を生成するモデルへは渡さず/);
  assert.match(html, /https:\/\/github\.com\/naoyamd\/rotorbench/);
  assert.match(html, /https:\/\/naoyamd\.github\.io\/rotorbench\/publish-task\//);
});
