import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("the static export contains the RotorBench product shell", async () => {
  const html = await readFile(
    new URL("../out/index.html", import.meta.url),
    "utf8",
  );

  assert.match(
    html,
    /<title>RotorBench \| 可変ピッチ機構ベンチマーク<\/title>/,
  );
  assert.match(html, /RotorBench/);
  assert.match(html, /可変ピッチ/);
  assert.match(html, /A\s*\/\s*B/);
  assert.match(html, /Luna xhigh/);
  assert.match(html, /Reference Kinematics/);
  assert.match(html, /同じ基準で採点する/);
  assert.match(html, /6軸の加重得点/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});
