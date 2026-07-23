import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("the reusable candidate protocol is checked in", async () => {
  const [registry, types, prompt, specification, template, app] = await Promise.all([
    source("app/candidates.ts"),
    source("app/benchmarks/types.ts"),
    source("BENCHMARK_PROMPT.md"),
    source("CANDIDATE_SPEC.md"),
    source("app/benchmarks/candidate-template/manifest.ts"),
    source("app/rotor-bench.tsx"),
  ]);

  assert.match(registry, /CANDIDATES:\s*RotorCandidate\[\]/);
  assert.match(registry, /luna-xhigh/);
  assert.match(registry, /reference-kinematics/);
  assert.match(types, /View\?: ComponentType<RotorCandidateViewProps>/);
  assert.match(types, /rotorAzimuth:\s*number/);
  assert.match(types, /assetBasePath:\s*string/);
  assert.match(types, /kind:\s*"model" \| "reference"/);
  assert.match(prompt, /Prompt version: `RB-2\.0`/);
  assert.match(prompt, /改変不可の正本/);
  assert.match(prompt, /すわっしゅプレート式可変ピッチ機構/);
  assert.match(prompt, /未指定事項は自律的に判断/);
  assert.match(specification, /DeepSeek、Qwen、Kimi、GLM/);
  assert.match(specification, /共有 controls \/ azimuth/);
  assert.match(template, /replace-with-unique-id/);
  assert.match(template, /promptVersion: "RB-2\.0"/);
  assert.match(registry, /lunaXhighCandidate/);
  assert.match(registry, /referenceCandidate/);
  assert.match(app, /rotorbench-session-v1/);
  assert.match(app, /Prompt version: RB-2\.0/);
  assert.match(app, /この共通プロンプトは改変不可/);
  assert.match(app, /onInput=/);
});

test("the project contains static hosting contracts without starter residue", async () => {
  const [packageJson, nextConfig, page, layout, workflow] = await Promise.all([
    source("package.json"),
    source("next.config.ts"),
    source("app/page.tsx"),
    source("app/layout.tsx"),
    source(".github/workflows/deploy-pages.yml"),
  ]);

  assert.doesNotMatch(packageJson, /react-loading-skeleton|drizzle/);
  assert.match(nextConfig, /output:\s*"export"/);
  assert.match(nextConfig, /PAGES_BASE_PATH/);
  assert.match(page, /<RotorBench \/>/);
  assert.match(layout, /<html lang="ja">/);
  assert.match(layout, /\/og\.png/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: out/);
  await access(new URL("public/.nojekyll", root));
  await assert.rejects(access(new URL("app/_sites-preview/SkeletonPreview.tsx", root)));
});
