# Engineering Design Benchmark Framework

RotorBench is a URL-driven framework for measuring how well LLMs perform a
real mechanical-system design task. The current fixed anchor asks a candidate
to design an integrated fixed-base industrial robot arm and its powered
opening/closing gripper for a defined machine-tending cell.

This repository prepares, freezes, launches, evaluates, and publishes the
benchmark. It does **not** contain a candidate answer, and no model run is
performed merely by building or deploying the site.

The intended use is a trusted operator's personal, longitudinal model
comparison. Receipts, hashes, and isolated workspaces make runs reproducible
and catch ordinary setup drift; they are not a commercial certification,
an adversarial security boundary, or approval for safety-critical manufacture.

## Public entry points

- Home: <https://naoyamd.github.io/rotorbench/>
- Stage 1 candidate launcher: <https://naoyamd.github.io/rotorbench/model-task/>
- Stage 2 evaluator handoff: <https://naoyamd.github.io/rotorbench/evaluate-task/>
- Benchmark definition: <https://naoyamd.github.io/rotorbench/benchmarks/>
- Stage 0 author/review/release controls:
  <https://naoyamd.github.io/rotorbench/stage0/>

The candidate receives only the no-placeholder block generated on the Stage 1
page: one fixed authorization sentence plus one canonical, live-verified
`/launch/<launch-id>/` URL. The URL contains the complete immutable task prompt,
input hashes, workspace bootstrap, output contract, checkpoints, and stop
conditions.

## What is measured

The benchmark does not judge a rendered surrogate or a web viewer. A complete
candidate package includes:

- immutable initial planning evidence and append-only attainment checkpoints;
- native or reproducible parametric CAD source;
- a complete neutral STEP assembly;
- robot and gripper kinematics, payload states, and motion evidence;
- BOM, system calculations, and requirement traceability;
- controlled drawings/PMI for critical production definition;
- gripper opening/closing, grasp, contact, retention, and loss-of-power
  evidence;
- structure, drives, brakes, bearings, foundation, accuracy, safety,
  manufacturing, service, cost, mass, and energy evidence.

The fixed packet supplies complete cell/workpiece CSG geometry, closed purchased
component interface cards, contact-damage limits, a foundation/anchor model,
and a hash-bound static STEP/kinematics validator. Candidate code, macros,
binaries, web content, and CAD embedded code are never executed by the
evaluator.

Results are reported as:

- A0 admission and B0–B6 engineering gates;
- the highest verified checkpoint and partial-attainment profile;
- D01–D10 ordinal engineering dimensions with reviewer intervals;
- raw geometry, grasp, load, accuracy, manufacturing, safety, mass, cost, and
  energy metrics;
- baseline and optional change-response qualification as separate results; and
- execution time, tokens, tools, retries, interventions, and cost separately
  from design quality.

No composite score is published.

## Fair run preparation

Before the first candidate starts, the operator:

1. chooses one `live-verified` launch;
2. creates a measurement-conditions file from
   `evaluation/integrated-robotic-handling-v1/measurement-conditions-template.json`;
3. preassigns opaque run IDs for the official three independent runs per model;
4. records `frozenAt`, then fixes equal elapsed-time, token, reasoning, tool,
   network, and zero-human-intervention conditions; and
5. opens the cohort:

```text
pnpm stage2:open-cohort -- --cohort-id <cohort-id> --launch-id <launch-id> --conditions <measurement-conditions.json>
```

The real model-to-run mapping stays outside the candidate workspace until
post-review publication. Conditions must not be reconstructed after results are
seen. `frozenAt <= openedAt` records the operator's pre-run freeze policy; it
does not cryptographically prove when a candidate started. Runs with another
execution profile are not directly ranked; profile changes require bridge runs.

## Stage 1 — candidate design

Each run starts in a fresh materialized workspace from the launch's
hash-verified public bootstrap. The candidate writes only:

```text
candidate-output/
  workspace-receipt.json
  plan.json
  initial-plan.sha256
  work-record.json
  receipts/
  artifacts/
  submission.json
```

`workspace-receipt.json` is created by the operator before the run and is
hash-bound into the pre-run authorization. `plan.json` and
`initial-plan.sha256` are created before engineering work and remain
unchanged. Later receipts are append-only. A model that cannot finish still
submits a schema-valid partial result rather than fabricating later evidence.

The model never receives its public run ID, other candidate results, hidden
evaluator inputs, or publication instructions.

## Stage 2 — seal and evaluate

Stage 2 runs in a separate evaluator task using
[`EVALUATE_TASK.md`](./EVALUATE_TASK.md). For each predeclared run:

```text
pnpm stage2:integrate -- --source <candidate-output> --candidate-id <opaque-run-id> --cohort-id <cohort-id>
pnpm stage2:sanitize -- --project-root . --run-id <opaque-run-id> --out sanitized
pnpm evaluation:score -- --project-root . --run-id <opaque-run-id> --assessment <assessment.json> --out <temporary-evaluation-result.json>
pnpm stage2:finalize-evaluation -- --run-id <opaque-run-id> --evaluation <temporary-evaluation-result.json>
```

Integration copies candidate bytes unchanged and seals their deterministic tree
hash. Sanitization and scoring are loaded from the exact execution contract
frozen with the launch. At least two independent, identity-blind engineering
ratings are required; a third adjudicator is required on a material conflict.

After every planned run is finalized, create the operator-owned disclosure with
the exact frozen groups/run IDs and the provider, model, version, reasoning
setting, and policy for each group. Then publish:

```text
pnpm check
pnpm stage2:publish-cohort -- --cohort-id <cohort-id> --disclosure <cohort-disclosure.json>
```

Publication is cohort-atomic and rolls back if a member or framework check
fails. It produces a post-review, exact-three-repeat group aggregate with D01–D10
medians/intervals, gates, qualification and admission rates, checkpoint
distribution, raw metrics, and separate efficiency facts—never a composite,
rank, or winner.

## Private evaluator → public repository boundary

Run Stage 2 in a **separate private clone, fork, or evaluator workspace**.
`runs/` and `cohorts/` contain sealed candidate bytes, reviewer packages,
reviewer records, evaluator records, and source paths; they are intentionally
ignored by Git and must never be committed to this public repository.

After `stage2:publish-cohort` succeeds, export a verified portable publication
outside that private workspace using the launch-frozen command:

```text
pnpm stage2:export-publication -- --project-root <private-workspace> --cohort-id <cohort-id> --out <outside-private-workspace/publication-bundle>
```

In a clean public repository clone, import only that bundle:

```text
pnpm publication:import -- --bundle <publication-bundle>
pnpm check
```

The importer atomically writes `publications/<cohort-id>/` only after checking
the signed manifest, every file hash and path, publication schemas, private
field/token exclusions, and duplicate cohort/run IDs. The public catalog reads
these checked-in publications; it does not require or copy raw evaluator state.
Only post-review disclosure, aggregate, host-generated public summaries, safe
run metadata, validation summaries, and admitted inert artifact downloads may
cross this boundary.

## Stage 0 — immutable authoring and release

New task versions are authored outside `task-packets/`, frozen once, and never
edited. Stage 0 binds:

- the task definition, every public input, packet manifest, and whole-bundle
  digest;
- a clean Git baseline and public workspace bootstrap;
- schemas, prompt renderer, sanitizer, artifact validator, and scoring runtime;
- an independent engineering review and a distinct protocol review;
- explicit release approval; and
- the canonical page, `launch.json`, and `prompt.txt` bytes observed after
  deployment.

Only a `live-verified` launch with a valid detached activation verification
appears on the Stage 1 launcher. Release-ready and activation-pending launches
remain available only as non-executable inspection pages.

### Required deployment and live-verification sequence

For every release, use this exact order. The first verification observes the
release-ready page. A post-activation attestation is then stored outside the
immutable launch directory in `activations/<launch-id>/verification.json`.
Its page SHA is forensic evidence only; the canonical marker projection and
the exact `launch.json` and `prompt.txt` bytes remain the integrity checks.

1. Deploy the `release-ready` launch.
2. Run `live-verify` against its canonical page, `launch.json`, and `prompt.txt` URLs.
3. Deploy the resulting `live-verified` state.
4. Run create-only `activate-live` against the same canonical URLs.
5. Perform the final deploy, then run read-only `audit-live` to confirm the
   remote activation record and frozen-file bytes, the final-only activation
   marker, and byte-exact rendered prompt text before opening Stage 1.
6. Open each cohort and create every candidate workspace only after activation.
   Root validation rejects current-protocol cohort or workspace timestamps that
   predate the activation record, so pre-activation state cannot later become a
   measurable run.

Only the package commands documented below are valid operator entrypoints.
They recheck the detached activation before delegating to the immutable launch
runtime. Direct execution of files below a frozen `execution-contract/`
directory bypasses that operational gate and is therefore an invalid,
non-measurable run.

## Local validation

Node.js 22+ and pnpm are required.

```text
pnpm install
pnpm check
```

Useful Stage 0 checks:

```text
pnpm stage0 -- lint --source <draft-directory>
pnpm stage0 -- check-packet --packet-id <id> --version <version>
pnpm stage0 -- verify-workspace --workspace <git-repository>
pnpm stage0 -- freeze-launch --launch-id <launch-id> --packet-id <id> --version <version> --profile <profile.json> --workspace <git-repository>
pnpm stage0 -- review --launch-id <launch-id>
pnpm stage0 -- approve --launch-id <launch-id> --expected-launch-digest <digest> --approval "APPROVE RELEASE <digest>"
pnpm stage0 -- release-ready --launch-id <launch-id> --expected-launch-digest <digest> --approval "APPROVE RELEASE <digest>"
pnpm stage0 -- live-verify --launch-id <launch-id> --launch-url <https-url> --launch-json-url <https-url> --prompt-url <https-url>
pnpm stage0 -- activate-live --launch-id <launch-id> --launch-url <https-url> --launch-json-url <https-url> --prompt-url <https-url>
pnpm stage0 -- audit-live --launch-id <launch-id> --launch-url <https-url> --launch-json-url <https-url> --prompt-url <https-url>
```

## Public rubric and private boundaries

Requirements and the scoring rubric are public so every candidate faces the
same stated engineering standard. “Evaluator-private” means other candidates,
run identity, hidden robustness instances, change-event payloads, reviewer
work, anti-leakage controls, and results—not an undisclosed primary scoring
rule.

## Legacy archive

RotorBench RB-2.0 web-demo submissions remain read-only under `submissions/`
and their existing `/results/<id>/` URLs. They are excluded from this
engineering benchmark, launch catalog, and comparisons.
