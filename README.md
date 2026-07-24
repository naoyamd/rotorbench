# Engineering Design Benchmark Framework

This repository is the neutral publication and handoff framework for future
manufacturing-design LLM benchmarks. Candidate models perform engineering work
in isolated projects. They do not build viewers, edit this site, choose public
identities, or publish results.

The repository currently contains no real engineering task, design answer,
dimensions, loads, materials, scoring rules, or reference solution. Only
underscored structural templates are present.

## Three-stage flow

### Stage 0 — prepare outside the candidate run

1. Draft and lint the task outside `task-packets/`, then freeze one immutable
   `task-packets/<benchmark-id>/<version>/` directory containing `task.json`,
   `packet.json`, `packet-lock.json`, the task brief, and every input file.
   Every revision uses a new version.
2. Add the matching neutral `benchmarks/<benchmark-id>/benchmark.json`.
3. Freeze a new launch against an exact clean Git repository and an execution
   profile, then obtain independent engineering and protocol reviews.
4. Approve and mark the digest-bound release `release-ready`. Draft,
   unapproved, and retired launches are excluded from public routes.
5. Give every model in one cohort the same launch URL and the exact launcher
   sentence shown at `/model-task/`.

Stage 0 v3 binds packet-manifest and whole-bundle digests, the verified Git
worktree, execution profile and contract, rendered prompt, and launch. Existing
Stage 1/2 v2 material remains readable; new freezes use v3.

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
pnpm stage0 -- lint --source <draft-directory>
pnpm stage0 -- freeze-packet --source <draft-directory> --packet-id <id> --version <version>
pnpm stage0 -- verify-workspace --workspace <git-repository>
pnpm stage0 -- freeze-launch --launch-id <launch-id> --packet-id <id> --version <version> --profile <profile.json> --workspace <git-repository>
pnpm stage0 -- review --launch-id <launch-id>
pnpm stage0 -- approve --launch-id <launch-id> --expected-launch-digest <digest> --approval "APPROVE RELEASE <digest>"
pnpm stage0 -- preview --launch-id <launch-id>
pnpm stage0 -- release-ready --launch-id <launch-id> --expected-launch-digest <digest> --approval "APPROVE RELEASE <digest>"
pnpm stage0 -- live-verify --launch-id <launch-id> --launch-url <https-url> --launch-json-url <https-url> --prompt-url <https-url>
node scripts/stage1-validate.mjs --root <candidate-output>
node scripts/stage1-checkpoint.mjs --root <candidate-output>
node scripts/stage2-integrate.mjs --source <candidate-output> --candidate-id <id> --cohort-id <cohort-id>
pnpm stage2:publish-cohort -- --cohort-id <cohort-id>
```

`freeze-launch` requires an execution profile with `canonicalBaseUrl`: the
canonical HTTPS deployment base without a trailing slash. Stage 0 freezes
declared input and contract-schema URLs under that exact base.

The legacy packet and launch finalize commands are check-only compatibility
shims and never mutate frozen content.

## Operator pages

- Stage 0 preparation: https://naoyamd.github.io/rotorbench/stage0/
- Stage 0 author: https://naoyamd.github.io/rotorbench/stage0/author/
- Stage 0 review: https://naoyamd.github.io/rotorbench/stage0/review/
- Stage 0 release: https://naoyamd.github.io/rotorbench/stage0/release/
- Stage 1 handoff: https://naoyamd.github.io/rotorbench/model-task/
- Stage 2 handoff: https://naoyamd.github.io/rotorbench/publish-task/
- Submission format: https://naoyamd.github.io/rotorbench/format/
- Public framework: https://naoyamd.github.io/rotorbench/

Legacy RotorBench RB-2.0 material remains under `submissions/` and its existing
`/results/<id>/` URLs. It is read-only and excluded from the engineering
framework catalog.
