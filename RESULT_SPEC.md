# Framework result page specification

A future framework run is rendered in a neutral static shell at
`/runs/<run-id>/`. The page contains the following evidence sections:

1. Overview — run and benchmark metadata
2. 3D — only a common preprocessed mesh for STEP artifacts
3. Drawing — submitted drawing downloads
4. BOM — submitted bill-of-material downloads
5. Calculation — submitted calculation downloads
6. Files — all submitted artifact downloads, roles, paths, and hashes
7. Validation — manifest/path/hash and STEP processing results, including input
   hashes, processor versions, and derived mesh hashes

The browser must never parse original STEP or run arbitrary model-supplied HTML,
CSS, or JavaScript. It displays a generated mesh asset with orbit, pan, zoom,
fit, projection toggle, keyboard support, and a download fallback.

The framework does not require a particular scoring method or engineering task.
Those values, if a future benchmark introduces them, are scoped to `extensions`
and must not change this common result shell.

Existing RB-2.0 `/results/<id>/` pages are a separate read-only legacy archive
and do not conform to or populate this framework result catalog.
