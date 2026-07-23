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
  assert.match(html, /ベンチマーク結果は、まだありません。/);
  assert.match(html, /共通プロンプト/);
  assert.match(html, /成果物だけを追加する。/);
  assert.doesNotMatch(html, /Luna xhigh|Reference Kinematics|A\s*\/\s*B 比較/);
});
