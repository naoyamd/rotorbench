import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const viewerSource = await readFile(
  new URL("../app/components/step-viewer.tsx", import.meta.url),
  "utf8",
);

test("STEP viewer keeps React status content separate from its canvas mount", () => {
  assert.match(
    viewerSource,
    /<div className="viewer-canvas-mount" ref=\{canvasMountRef\} aria-hidden="true" \/>/,
  );
  assert.match(viewerSource, /canvasMount\.appendChild\(canvas\)/);
  assert.match(
    viewerSource,
    /if \(canvas\.parentNode === canvasMount\) canvasMount\.removeChild\(canvas\)/,
  );
  assert.doesNotMatch(viewerSource, /\.replaceChildren\(/);
});

test("FIT restores the orthographic zoom before updating its projection", () => {
  assert.match(
    viewerSource,
    /orthographic\.zoom = 1;\s+orthographic\.updateProjectionMatrix\(\)/,
  );
});
