# Engineering Design Benchmark — Stage 1 launcher contract

Protocol: `EDBF-STAGE1-3.0`

Stage 1 begins only after Stage 0 has produced a `live-verified` launch. A bare
URL is not an executable instruction.

## What the operator sends

Open `/model-task/` and copy one complete launch-specific block. The block
contains the fixed launcher sentence and one canonical `/launch/<launch-id>/`
URL. It has no placeholders. If the page lists no live-verified launches,
Stage 1 is closed and the operator returns to `/stage0/`.

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
- The candidate works only in its isolated project and writes
  `candidate-output/`. It never receives or chooses a candidate ID.
- `plan.json` is written before design work. Its exact bytes are checkpointed
  in `initial-plan.sha256` and neither file is changed afterward.
- `submission.json` binds the packet manifest and bundle, execution contract,
  prompt hash, launch digest, fairness fingerprint, process evidence, and every
  engineering artifact.

The model-facing executable prompt is the generated
`/launch/<launch-id>/` page, not this operator guide.
