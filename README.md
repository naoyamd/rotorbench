# Engineering Design Benchmark Framework

This repository is a static, task-neutral publication framework for future
manufacturing design LLM benchmarks. It provides common manifests, evidence
validation, STEP preprocessing, static review pages, and downloads. It does not
contain a benchmark task, reference design, sample engineering answer, scoring
rules, runtime API, database, or authentication.

## Current catalog

The new `benchmarks/` and `runs/` catalogs intentionally contain **zero**
published entries. Their `_template/` directories are structural examples only.

The former RotorBench RB-2.0 material remains under `submissions/` and is
published separately at its existing `/results/<id>/` URLs. It is read-only
legacy material and is never included in the framework catalog or comparison
pages. `BENCHMARK_PROMPT.md` remains unchanged as its legacy source document.

## Common format

- `schemas/benchmark.schema.json` — shared benchmark metadata
- `schemas/run.schema.json` — shared run metadata
- `schemas/artifact.schema.json` — file role, safe path, hash, and status
- `schemas/validation-report.schema.json` — validation report shape
- `benchmarks/<benchmark-id>/benchmark.json` — a future definition
- `runs/<run-id>/run.json` and submitted files — a future run

Accepted artifact roles are `cad-source`, `step`, `drawing`, `bom`,
`calculation`, and `supporting`. Any task-specific requirements or scoring data
must stay in a manifest's `extensions` object.

Every benchmark declares a `version`; each run pins it with
`benchmarkVersion` and records a model `provider`, `name`, and `version`.
Draft 2020-12 schemas are enforced with Ajv. Artifact paths must resolve to
regular files inside the run directory, and declared SHA-256 values must match.

Submitted artifacts are copied into the static export for download. STEP is
validated and triangulated during the Node build with OpenCascade via
`occt-import-js`; browsers display only generated mesh JSON and never parse the
original STEP file. A bad STEP file records a failed validation report and keeps
the result page usable. Reports include manifest/path/hash checks, input hashes,
processor versions, and derived mesh hashes.

## Local development

Node.js 22+ and pnpm are required.

```bash
pnpm install
pnpm dev
```

```bash
pnpm framework:validate
pnpm framework:process-step
pnpm framework:index
pnpm check
```

`pnpm check` includes the framework preparation, legacy archive catalog,
TypeScript, linting, static export, static-link verification, and tests.

The Next configuration supports both a root-hosted site and a GitHub Pages
subpath through `PAGES_BASE_PATH` / `NEXT_PUBLIC_BASE_PATH`. Do not change
`.openai/hosting.json` for this static framework.

## Documentation

- [Immutable common model prompt](./MODEL_TASK.md)
- [Immutable integration and publishing prompt](./PUBLISH_TASK.md)
- [Framework result specification](./RESULT_SPEC.md)
- [Legacy RB-2.0 prompt](./BENCHMARK_PROMPT.md)
