# Run manifests

This directory intentionally starts empty. Only Stage 2 creates a future run.
It assigns the opaque candidate ID, binds the run to an open cohort, writes
`run.json`, and copies the completed candidate bundle unchanged into
`submitted/`. A candidate must never write directly to this directory or set
publication status. Runs remain `validated` until their complete cohort passes
the rollback-protected publication transition.
