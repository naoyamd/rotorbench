import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const stage2Integrate = await readFile(
  new URL("../scripts/stage2-integrate.mjs", import.meta.url),
  "utf8",
);

test("Stage 2 rejects an existing response receipt that omits or mismatches its exact change event", () => {
  assert.match(
    stage2Integrate,
    /const responseReceipt = receiptByCheckpoint\.get\(event\.responseCheckpointId\);[\s\S]*?if \(responseReceipt && responseReceipt\.changeEventId !== event\.id\)/,
  );
  assert.match(
    stage2Integrate,
    /response checkpoint \$\{event\.responseCheckpointId\} must bind exact change event \$\{event\.id\}/,
  );
});
