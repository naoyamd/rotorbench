# Public cohort publications

This directory is the only Stage 2 result state that belongs in the public
repository. Each `publications/<cohort-id>/` directory is created exclusively
by `pnpm publication:import -- --bundle <outside-private-workspace-path>`.

The source bundle is produced in a separate private evaluator workspace by the
launch-frozen `stage2:export-publication` command after cohort publication.
It contains only post-review disclosure, aggregate, host-generated evaluation
summaries, safe run metadata, validation summaries, and admitted inert artifact
downloads. Do not copy `runs/`, `cohorts/`, review packages, sealed review
records, evaluator records, or sanitizer state into this repository.

`publication.json` and `publication.sha256` bind every file in a publication.
The importer rejects unsafe paths, symlinks, hash changes, duplicate cohort/run
IDs, reviewer fields, reviewer tokens, private paths, and unlisted files.
