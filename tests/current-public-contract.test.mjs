import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

async function text(relativePath) {
  return readFile(path.join(repositoryRoot, relativePath), "utf8");
}

test("public benchmark metadata and links select the current scoring contract", async () => {
  const [benchmarkBytes, detailPage, modelTaskPage, evaluateTask, evaluatorGuide] = await Promise.all([
    text("benchmarks/integrated-robotic-handling/benchmark.json"),
    text("app/benchmarks/[id]/page.tsx"),
    text("app/model-task/page.tsx"),
    text("app/evaluate-task/page.tsx"),
    text("EVALUATE_TASK.md"),
  ]);
  const benchmark = JSON.parse(benchmarkBytes);

  assert.equal(benchmark.version, "1.10");
  assert.deepEqual(benchmark.extensions.scoringContract, {
    id: "integrated-robotic-handling-scoring",
    version: "1.2",
    publicPath:
      "framework/evaluation/integrated-robotic-handling-v1.10/scoring-contract.json",
    compositeScorePublished: false,
  });
  assert.match(detailPage, /scoringContractPath\(benchmark\)/);
  assert.doesNotMatch(
    detailPage,
    /integrated-robotic-handling-v1\/scoring-contract\.json/,
  );
  assert.match(
    modelTaskPage,
    /integrated-robotic-handling-v1\.10\/measurement-conditions-template\.json/,
  );
  assert.match(
    evaluateTask,
    /integrated-robotic-handling-v1\.10\/reviewer-template\.json/,
  );
  assert.match(
    evaluatorGuide,
    /integrated-robotic-handling-v1\.10\/reviewer-template\.json/,
  );
  assert.match(
    evaluatorGuide,
    /integrated-robotic-handling-v1\.10\/assessment-template\.json/,
  );
  assert.doesNotMatch(
    evaluatorGuide,
    /integrated-robotic-handling-v1\/(?:reviewer|assessment)-template\.json/,
  );
});
