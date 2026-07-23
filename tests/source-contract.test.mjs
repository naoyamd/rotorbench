import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);

async function source(path) {
  return readFile(new URL(path, root), "utf8");
}

test("the immutable prompt and submission protocol are checked in", async () => {
  const [prompt, task, taskPage, specification, template, catalogScript, page] = await Promise.all([
    source("BENCHMARK_PROMPT.md"),
    source("MODEL_TASK.md"),
    source("app/model-task/page.tsx"),
    source("RESULT_SPEC.md"),
    source("submissions/_template/manifest.json"),
    source("scripts/build-result-catalog.mjs"),
    source("app/page.tsx"),
  ]);

  assert.match(prompt, /Prompt version: `RB-2\.0`/);
  assert.match(prompt, /改変不可の正本/);
  assert.match(prompt, /スワッシュプレート式可変ピッチ機構/);
  assert.match(task, /作業手順だけ/);
  assert.match(task, /BENCHMARK_PROMPT\.md/);
  assert.match(task, /https:\/\/github\.com\/naoyamd\/rotorbench/);
  assert.match(task, /他候補の成果ページは参照しません/);
  assert.doesNotMatch(task, /スワッシュプレート式可変ピッチ機構/);
  assert.match(taskPage, /MODEL HANDOFF \/ INTEGRATION ONLY/);
  assert.match(taskPage, /https:\/\/github\.com\/naoyamd\/rotorbench/);
  assert.match(taskPage, /共通UIの変更は行いません/);
  assert.match(specification, /中央レジストリへの追記は不要/);
  assert.match(template, /"promptVersion": "RB-2\.0"/);
  assert.match(catalogScript, /directoryEntry\.name\.startsWith\("_"\)/);
  assert.match(catalogScript, /manifest\.id must use lowercase kebab-case/);
  assert.match(page, /<ResultCatalog/);
  assert.match(page, /initialResults=\{initialCatalog\.results as ResultEntry\[\]\}/);
});

test("catalog generation produces an empty, versioned catalog", async () => {
  const catalog = JSON.parse(await source("public/results/catalog.json"));
  assert.deepEqual(catalog, { schemaVersion: 1, results: [] });
});

test("the project contains static hosting contracts", async () => {
  const [packageJson, nextConfig, workflow, layout] = await Promise.all([
    source("package.json"),
    source("next.config.ts"),
    source(".github/workflows/deploy-pages.yml"),
    source("app/layout.tsx"),
  ]);

  assert.match(packageJson, /"catalog": "node scripts\/build-result-catalog\.mjs"/);
  assert.match(nextConfig, /output:\s*"export"/);
  assert.match(nextConfig, /PAGES_BASE_PATH/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
  assert.match(workflow, /path: out/);
  assert.match(layout, /Model Output Archive/);
  await access(new URL("public/.nojekyll", root));
});
