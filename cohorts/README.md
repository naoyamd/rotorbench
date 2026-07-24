# Stage 2 cohorts

A cohort is the Stage 2-owned publication boundary for one comparison group.
Create `cohorts/<cohort-id>/cohort.json` only after the complete set of planned
opaque candidate IDs is known.

- Every member uses the cohort's single validated launch and fairness
  fingerprint.
- Candidate models never receive or edit this manifest.
- Integrations remain `validated` while the cohort is `open`.
- `stage2:publish-cohort` publishes all listed members together only after
  every sealed run and staged validation report passes.
- Missing, duplicated, mismatched, or invalid members keep the entire cohort
  out of the public catalog.

The `_template/` directory is structural only and is never treated as a real
cohort.
