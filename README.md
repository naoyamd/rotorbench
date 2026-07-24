# Engineering Design Benchmark Framework

This repository is the neutral publication and handoff framework for future
manufacturing-design LLM benchmarks. Candidate models perform engineering work
in isolated projects. They do not build viewers, edit this site, choose public
identities, or publish results.

The repository currently contains no real engineering task, design answer,
dimensions, loads, materials, scoring rules, or reference solution. Only
underscored structural templates are present.

## End-to-end flow

### Prepare outside the candidate run

1. Add one immutable `task-packets/<benchmark-id>/` directory containing
   `packet.json`, the task brief, and every input file.
2. Add the matching neutral `benchmarks/<benchmark-id>/benchmark.json`.
3. Add `launches/<launch-id>/launch.json`. It binds the packet to a baseline
   workspace and common environment and produces `/launch/<launch-id>/`.
4. Give every model in one cohort the same launch URL and the exact launcher
   sentence shown at `/model-task/`.

### Stage 1 — candidate engineering work

The candidate works in an isolated engineering project and creates:

```text
candidate-output/
  submission.json
  plan.json
  initial-plan.sha256
  work-record.json
  artifacts/...
```

`plan.json` records requirements, assumptions, planned alternatives, work
steps, and verification before design work. `initial-plan.sha256` contains the
single line `<64hex>  plan.json`; both files remain unchanged afterward.
`work-record.json` records the alternatives actually considered, decisions and
trade-offs, plan revisions, and requirement-linked verification claims.
`submission.json` records all hashes and task/launch identity, including the
`initialPlanCheckpoint` path and hash.

The candidate is not given a candidate ID and does not access this repository,
other candidates, Stage 2, comparison, scoring, or publishing.

### Stage 2 — seal, integrate, publish

A separate publishing task validates the completed bundle, assigns an opaque
candidate ID, copies the bundle byte-for-byte into
`runs/<candidate-id>/submitted/`, records a deterministic tree hash in the
Stage 2-owned `run.json`, runs common STEP preprocessing, and publishes only a
valid sealed run. Every planned candidate in a cohort must first be integrated
at `validated`; publication starts only after the entire planned cohort and the
framework checks are complete. The Stage 2-owned cohort manifest is the
fail-closed source of membership; publication updates the complete cohort
together.

## Contracts

- `schemas/task-packet.schema.json` — task, input hashes, outputs, environment,
  completion criteria
- `schemas/launch.schema.json` — packet binding, baseline, workspace, first
  action, stop rules, fairness fingerprint
- `schemas/plan.schema.json` — initial requirements and plan
- `schemas/work-record.schema.json` — alternatives, decisions, revisions,
  verification claims
- `schemas/submission.schema.json` — candidate bundle manifest
- `schemas/cohort.schema.json` — Stage 2 launch binding and complete candidate membership
- `schemas/run.schema.json` — Stage 2 identity, cohort, seal, process evidence, artifacts
- `schemas/artifact.schema.json` — safe path, role, hash, and status

The fairness fingerprint is calculated from the task packet, baseline,
workspace, output root, first action, and stop rules. Candidate identity is
excluded.

## Common processing

The framework validates schemas, references, safe paths, file hashes, launch
fingerprints, and sealed bundle tree hashes. STEP is triangulated during the
build with OpenCascade via `occt-import-js`; browsers display only derived mesh
JSON. A bad STEP produces a visible failed validation report and download
fallback instead of breaking the result page.

Only `published`, sealed, fully valid runs enter the public catalog. Comparison
groups runs only by an identical fairness fingerprint and displays no built-in
rank, score, or winner.

## Local validation

Node.js 22+ and pnpm are required.

```bash
pnpm install
pnpm check
```

Useful scoped commands:

```bash
node scripts/finalize-task-packet.mjs --packet-id <benchmark-id>
node scripts/finalize-launch.mjs --launch-id <launch-id>
node scripts/stage1-validate.mjs --root <candidate-output>
node scripts/stage1-checkpoint.mjs --root <candidate-output>
node scripts/stage2-integrate.mjs --source <candidate-output> --candidate-id <id> --cohort-id <cohort-id>
pnpm stage2:publish-cohort -- --cohort-id <cohort-id>
```

## Operator pages

- Stage 1 handoff: https://naoyamd.github.io/rotorbench/model-task/
- Stage 2 handoff: https://naoyamd.github.io/rotorbench/publish-task/
- Submission format: https://naoyamd.github.io/rotorbench/format/
- Public framework: https://naoyamd.github.io/rotorbench/

Legacy RotorBench RB-2.0 material remains under `submissions/` and its existing
`/results/<id>/` URLs. It is read-only and excluded from the engineering
framework catalog.
