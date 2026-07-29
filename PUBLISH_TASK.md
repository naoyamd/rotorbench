# Stage 2 handoff moved

The current engineering-design benchmark uses protocol `EDBF-STAGE2-4.0`.
Its canonical evaluator and publication handoff is:

<https://naoyamd.github.io/rotorbench/evaluate-task/>

Use [`EVALUATE_TASK.md`](./EVALUATE_TASK.md) for the complete procedure.

The former workflow that waited until every candidate finished and only then
created a cohort must not be used for version 4. The operator freezes the
cohort, opaque run assignments, official three repeats per model, and equal
measurement conditions before the first candidate run. `frozenAt <= openedAt`
records that control but is not cryptographic proof of a candidate's actual
start time. Each finished bundle is then integrated, statically sanitized,
independently rated, and finalized. Only after every predeclared run is
finalized does the operator create the exact post-review disclosure and run
`stage2:publish-cohort -- --cohort-id <id> --disclosure <cohort-disclosure.json>`
to publish the cohort atomically.

This compatibility file remains only so old links do not silently lead to
obsolete instructions.

For the current protocol, keep the evaluator workspace private. After the
cohort is published, export with the launch-frozen `stage2:export-publication`
command and import the resulting bundle in the public repository with
`pnpm publication:import -- --bundle <bundle>`. Do not copy `runs/` or
`cohorts/` into the public worktree.
