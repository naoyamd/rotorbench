# Future run submission format

Target repository: <https://github.com/naoyamd/rotorbench>. This identifies
where the framework integration is maintained; it does not add to or change any
benchmark task requirements.

This is a framework integration guide, not a benchmark prompt. No engineering
task, sample solution, target design, or score is supplied here.

## Required structure

```text
benchmarks/<benchmark-id>/benchmark.json
runs/<run-id>/run.json
runs/<run-id>/<submitted files>
```

The benchmark manifest uses `schemas/benchmark.schema.json`. The run manifest
uses `schemas/run.schema.json`; each artifact follows
`schemas/artifact.schema.json`.

The run must pin the benchmark's declared version in `benchmarkVersion` and
record the producing model's provider, name, and version.

## Evidence boundary

A future run can provide the following artifact roles when relevant:

- `cad-source` for an editable CAD source file
- `step` for an interchange model
- `drawing` for drawings
- `bom` for a bill of materials
- `calculation` for calculations
- `supporting` for other evidence

Every artifact must name a safe relative path to a regular file within its run
directory, a lowercase SHA-256 hash, and a status. Symlinks, directories,
traversal, and URL-dangerous path characters are rejected. Do not submit
arbitrary HTML, CSS, or JavaScript: the common static site renders result pages
and only links to the submitted files.

Benchmark-specific values, requirements, and any evaluation logic belong only
in `extensions`. Do not alter the legacy RB-2.0 material in `submissions/` or
`BENCHMARK_PROMPT.md` when adding a future framework run.

## Local check

Run `pnpm check` before proposing a static publication. It verifies the
manifest, paths, hashes, STEP preprocessing, export, and links.
