# Framework publishing flow

Target repository: <https://github.com/naoyamd/rotorbench>. This identifies the
publication repository only; it does not define or modify benchmark task
content.

The framework produces a fully static export. It has no runtime API, database,
or authentication requirement.

## Build stages

1. `pnpm framework:validate` applies the Draft 2020-12 schemas with Ajv and
   validates duplicate IDs, regular-file real paths, and SHA-256 hashes.
2. `pnpm framework:process-step` uses OpenCascade in Node to triangulate valid
   STEP files into deterministic viewer mesh JSON and sidecar metadata.
3. `pnpm framework:index` copies downloadable artifacts and emits the framework
   catalog used for static route generation.
4. `pnpm check` performs all stages plus linting, static export, static-link
   validation, and tests.

An invalid STEP file is an expected per-run processing failure: its run page
still exports with a validation report and a link to download the original file.
The report records common manifest/path/hash checks, input hashes, processor
versions, and derived mesh hashes.

## Legacy boundary

`submissions/` is the read-only RB-2.0 archive. The legacy catalog build keeps
existing `/results/<id>/` output URLs available. Do not add it to the framework
benchmark, run, or comparison catalogs, and do not modify the legacy
`BENCHMARK_PROMPT.md`.

## Hosting

The static export supports a host root and GitHub Pages repository subpaths via
the existing `PAGES_BASE_PATH` and `NEXT_PUBLIC_BASE_PATH` settings. Keep
`.openai/hosting.json` unchanged.
