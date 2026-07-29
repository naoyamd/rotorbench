# Engineering Design Benchmark — Stage 1 launcher contract

Protocol: `EDBF-STAGE1-4.0`

Stage 1 begins only after Stage 0 has produced a `live-verified` launch and the
operator has frozen the cohort and common run conditions.

## What the operator sends

Before the first run, use the measurement-conditions template to preassign
opaque run IDs for the official three independent runs per model and freeze
equal elapsed-time, token, reasoning, tool, network, and zero-intervention
conditions with `stage2:open-cohort`.

Immediately before each external candidate run, create a new candidate
workspace outside the RotorBench repository:

```text
pnpm stage1:prepare-workspace -- --launch-id <launch-id> --target <new-absolute-directory>
```

The command refuses an existing target, validates the live launch, and
atomically materializes the baseline, all 19 declared public task inputs,
frozen schemas and candidate helpers. It returns `receiptSha256`. Configure
the candidate harness to enforce the generated `isolation-policy.json`: the
exact launch URL and ordinary public technical research are allowed, while
other RotorBench, GitHub repository, result, comparison, cohort, run, and
publication surfaces are denied.

Before starting the model, issue its exclusive pre-run authorization and bind
that receipt:

```text
pnpm stage1:authorize-run -- --cohort-id <cohort-id> --run-id <opaque-run-id> --operator-pseudonym <operator-id> --external-run-configuration-sha256 <receiptSha256>
```

This hash-binds the opaque run to the already-frozen conditions, launch, and
exact operator-created workspace. The timestamps and isolation boundary are
auditable operator/harness attestations, not cryptographic proof of an
external provider's start time or network enforcement. Do not backfill the
authorization after a candidate begins.

Start a new model task with the generated directory as its working directory.
Then open `/model-task/` and copy one complete launch-specific block. The block
contains the fixed authorization sentence and one canonical
`/launch/<launch-id>/` URL. It has no placeholders. If the page lists no
live-verified launches, Stage 1 is closed and the operator returns to
`/stage0/`.

## What the launch URL guarantees

- The task packet is frozen at `task-packets/<id>/<version>/` and bound by both
  its manifest digest and whole-bundle digest.
- The baseline is an exact clean Git repository attested with
  `sha256-git-worktree-v1`; symbolic links and submodules are rejected.
- The execution profile, launcher message, prompt renderer, and plan,
  work-record, submission, and artifact schemas are bound by the execution
  contract digest. Every declared input and schema link is a frozen canonical
  HTTPS URL under the profile's bound deployment base.
- Two independent reviewers approved the exact packet and launch digests;
  neither reviewer is the author, and the release was verified at its
  canonical page, `launch.json`, and `prompt.txt` URLs.
- Live verification rejects redirects and cross-origin or base-path drift,
  compares remote `launch.json` and `prompt.txt` to the exact frozen bytes,
  and requires the launch digest markers on the rendered page.
- The candidate works only in the operator-created isolated project and writes
  `candidate-output/`. It never receives or chooses a candidate ID. The
  candidate first runs the local receipt preflight and stops on any mismatch.
- Stage 2 refuses an official result unless its predeclared opaque run has a
  valid, hash-bound pre-run operator authorization created after cohort
  opening and before execution, and the submitted workspace receipt exactly
  matches that authorization.
- `plan.json` is written before design work. Its exact bytes are checkpointed
  in `initial-plan.sha256` and neither file is changed afterward.
- `submission.json` binds the packet manifest and bundle, execution contract,
  prompt hash, launch digest, fairness fingerprint, process evidence, and every
  engineering artifact.

## Version 4 additions

- The generated launch declares the exact public workspace bootstrap and its
  SHA-256 before the candidate begins work. The operator initializer
  materializes it together with every declared input and frozen candidate
  helper; the model does not assemble its own environment from many URLs.
- The candidate creates append-only, digest-bound checkpoint receipts as the
  declared checkpoints are reached. A stopped run records its verified partial
  attainment instead of inventing unperformed work.
- The candidate requests evaluator-owned sanitization in `submission.json`; it
  does not claim to have performed that evaluation step. Sanitization and
  scoring load the exact implementations frozen with the launch.
- Hidden robustness assets, run-private instances, and private change-event
  payloads are withheld. A public launch exposes only a change event's ID,
  commitment digest, and checkpoint trigger.

The model-facing executable prompt is the generated
`/launch/<launch-id>/` page, not this operator guide.
