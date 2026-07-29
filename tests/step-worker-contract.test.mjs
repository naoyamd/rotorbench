import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("STEP conversion uses a bounded separate process", async () => {
  const source = await readFile(
    new URL("../scripts/process-step.mjs", import.meta.url),
    "utf8",
  );
  const worker = await readFile(
    new URL("../scripts/process-step-worker.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /execFileAsync/);
  assert.match(source, /--max-old-space-size=/);
  assert.match(source, /timeout:\s*workerLimits\.timeoutMs/);
  assert.match(source, /STEP bytes no longer match the sealed artifact hash/);
  assert.doesNotMatch(source, /ReadStepFile/);
  assert.match(worker, /ReadStepFile/);
  assert.doesNotMatch(worker, /node:http|node:https|fetch\s*\(/);
});
