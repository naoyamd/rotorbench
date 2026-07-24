# Candidate output contract

Candidate models work in an isolated engineering project, not in this
publication repository. Every candidate writes exactly one
`candidate-output/` bundle with:

- `submission.json` — task identity, model metadata, process evidence, and
  artifact hashes
- `plan.json` — the initial requirements and plan, written before design work
- `initial-plan.sha256` — one `<64hex>  plan.json` checkpoint line, preserved
  with the initial plan and referenced by `submission.initialPlanCheckpoint`
- `work-record.json` — alternatives, decisions, plan revisions, and
  verification claims
- task-required engineering files referenced by `submission.json`

Stage 2 later assigns an opaque candidate ID and copies the bundle unchanged
into the publication repository.
