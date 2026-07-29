# Engineering Design Benchmark — Stage 2 evaluation handoff

Protocol: `EDBF-STAGE2-4.0`

Use this instruction only in a separate evaluator task after a candidate model
has stopped and returned a `candidate-output/` directory. Never send it to a
candidate model and never ask a candidate to evaluate itself.

Target repository:
<https://github.com/naoyamd/rotorbench>

## Required inputs

- the completed `candidate-output/` path or the Codex task that produced it;
- the live-verified launch ID;
- an operator-assigned opaque run ID;
- the already-open cohort ID; and
- the assessment panel, normally `fixed-anchor-baseline`.

The operator must freeze the cohort and measurement conditions **before** the
first candidate run begins, then issue the named run's
`stage1:authorize-run` record immediately before pasting the launch handoff.
That authorization must bind the `receiptSha256` returned by
`stage1:prepare-workspace` through
`--external-run-configuration-sha256`. Do not create or backfill either record
after seeing a candidate result.
`frozenAt`, `openedAt`, and `issuedAt` are operator-recorded controls; they are
not cryptographic proof of the candidate's actual start time.

## Evaluation sequence

1. Use the latest `main`. Confirm that the launch remains `live-verified`, the
   run ID was predeclared in the open cohort, the recorded frozen measurement
   conditions still match the cohort hash, and the run has an immutable
   `operator-attested-pre-run` authorization. Confirm that
   `candidate-output/workspace-receipt.json` is present and unchanged.
   Integration fails closed if the authorization or receipt is missing, late,
   hash-mismatched, bound to another run, or inconsistent with the launch.
2. Integrate the finished bundle:

   ```text
   pnpm stage2:integrate -- --source <candidate-output> --candidate-id <opaque-run-id> --cohort-id <cohort-id>
   ```

   This validates the launch, packet, prompt, workspace receipt, pre-run
   authorization, contracts, checkpoints, paths, hashes, and output bindings,
   then copies the candidate bytes unchanged into
   `runs/<opaque-run-id>/submitted/`.
3. Run the launch-frozen static sanitizer:

   ```text
   pnpm stage2:sanitize -- --project-root . --run-id <opaque-run-id> --out sanitized
   ```

   Never execute candidate source, macros, binaries, HTML, JavaScript, or CAD
   embedded code. Native CAD remains opaque read-only evidence. Only admitted
   static STEP, JSON, CSV, PDF, text, image, and indexed drawing evidence may
   cross into evaluation.
4. Build the identity-neutral reviewer directory from the frozen package tool:

   ```text
   pnpm stage2:prepare-review -- --project-root . --run-id <opaque-run-id> --sanitized sanitized
   ```

   Give each primary reviewer only
   `runs/<opaque-run-id>/sanitized/review-package/`. It contains opaque
   `EVD-*` evidence labels, the frozen scoring contract, and hashes binding the
   package to the passed sanitization report. It deliberately excludes
   `submission.json`, `run.json`, cohort metadata, provider, model, candidate
   ID, original candidate paths, and all other reviewers' ratings. Never give a
   reviewer the `submitted/` tree or a separate reviewer's work. The tool also
   refuses evidence that contains a nontrivial provider, model-name, or model-
   version value declared in `submission.json`.
5. Copy `evaluation/integrated-robotic-handling-v1/reviewer-template.json`
   outside the repository once per reviewer. Each reviewer fills only its
   role, required attestations, gate ratings, dimension ratings, and `EVD-*`
   references. Reviewer input has no name, account, provider, model, or
   candidate-identity field. Do not give a reviewer another reviewer's input.
6. Seal every completed reviewer input before assembling the assessment:

   ```text
   pnpm stage2:seal-review -- --project-root . --run-id <opaque-run-id> --review <external-review.json>
   ```

   The sealer allocates an opaque `rater-…` pseudonym and writes an
   evaluator-owned `sanitized/reviews/<rater-id>.json` with exclusive-create
   semantics. Use at least one primary and one secondary record. If a gate
   conflicts or a dimension differs by more than one level, obtain and seal a
   third adjudicator record before scoring. Do not edit a sealed record.
7. Use the frozen neutral-handoff checks and sanitized evidence to fill a copy
   of `evaluation/integrated-robotic-handling-v1/assessment-template.json`.
   Bind the exact run, launch, scoring contract, sealed candidate tree,
   sanitization-report path/hash, automatic checks, checkpoint receipts, raw
   metrics, the review-package manifest hash, and every sealed review-record
   path/hash. The assessment contains references to immutable review records;
   it never contains retyped reviewer identities or ratings.

   The scoring implementation and rubric remain public deterministic inputs
   for reproducibility. Only the evaluator-owned review package, sealed review
   records, hidden instances, and run identity are restricted during review.
<!-- Legacy unsealed-review wording retained only in repository history:
6. Obtain at least two identity-blind, independent engineering ratings against
   the frozen A0 and B0–B6 gates and D01–D10 ordinal anchors. Add a third
   independent adjudicator whenever a gate conflicts or a dimension differs by
   more than one level. Preserve each rater's evidence references and
   rationale; do not let one reviewer rewrite another review.
-->
8. Create the evaluator result with the scoring implementation frozen by that
   launch:

   ```text
   pnpm evaluation:score -- --project-root . --run-id <opaque-run-id> --assessment <assessment.json> --out <temporary-evaluation-result.json>
   ```

9. Finalize and hash-bind the evaluator-owned record:

   ```text
   pnpm stage2:finalize-evaluation -- --run-id <opaque-run-id> --evaluation <temporary-evaluation-result.json>
   ```

   Finalization re-reads and hash-verifies the review package and every sealed
   review record as well as the exact submitted bytes, sanitization report,
   launch, fairness fingerprint, scoring contract, and measurement conditions.
10. Repeat Steps 2–9 for every run predeclared in the cohort. Do not publish a
    partial cohort.
<!-- Obsolete numbering retained only in repository history:
9. Repeat Steps 2–8 for every run predeclared in the cohort. Do not publish a
   partial cohort.
-->
11. After every member has a finalized evaluator record, prepare the
   operator-owned post-review disclosure. It must contain the exact opaque
   groups and run IDs from the frozen conditions plus provider, model, version,
   reasoning setting, and policy. Then run the common framework checks and
   publish atomically:

   ```text
   pnpm check
   pnpm stage2:publish-cohort -- --cohort-id <cohort-id> --disclosure <cohort-disclosure.json>
   ```

12. Verify the published disclosure, exact three-repeat group aggregate, every
    public evaluation summary, validation report, and admitted artifact download
    at the public URLs. No rank, winner, or composite score is emitted.

13. Still in the **private evaluator workspace**, export the publication bundle
    outside that workspace using the exact launch-frozen exporter:

    ```text
    pnpm stage2:export-publication -- --project-root <private-workspace> --cohort-id <cohort-id> --out <outside-private-workspace/publication-bundle>
    ```

    The exporter revalidates the complete private framework and every source
    hash before it writes an atomic manifest-bound bundle. It does not copy
    `runs/`, `cohorts/`, reviewer packages, sealed reviewer records, evaluator
    records, sanitizer state, or private source paths.

14. In a separate clean public-repository clone, import only the exported
    bundle and then publish the normal site update:

    ```text
    pnpm publication:import -- --bundle <publication-bundle>
    pnpm check
    ```

    The importer is fail-closed for hashes, schema, paths, symlinks, duplicate
    run/cohort IDs, reviewer fields/tokens, and unlisted files. It writes only
    `publications/<cohort-id>/`; never commit the private evaluator workspace.

## Result semantics

- An incomplete but well-formed design remains measurable through its highest
  verified checkpoint and Engineering Attainment Profile.
- `design-failed`, `artifact-invalid`, `evaluator-unsupported`, and
  `evaluator-uncertain` are distinct outcomes.
- Baseline qualification and change-response qualification are separate.
- Runtime, tokens, tool calls, retries, and cost remain separate from design
  quality.
- The official result is the qualification state, ten-dimensional ordinal
  vector, reviewer interval, evidence coverage, raw metrics, and uncertainty.
  No composite score is emitted.

## Operator message

```text
次の完成済み成果を、指定されたRotorBench launchのStage 2評価へ進めてください。
候補成果は改変せず、候補コードを実行せず、凍結済みの静的検査・独立レビュー・多次元評価・cohort単位の公開確認まで完了してください。

評価手順:
https://naoyamd.github.io/rotorbench/evaluate-task/

launch ID:
<launch-id>

run ID:
<opaque-run-id>

cohort ID:
<cohort-id>

assessment panel:
fixed-anchor-baseline

成果物:
<candidate-output/の絶対パス、または成果を生成したCodexタスクのリンク>
```
