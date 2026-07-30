# Candidate output

`candidate-output/` is the handoff boundary. Create `plan.json` first, create
`initial-plan.sha256` with `node tools/stage1-checkpoint.mjs --root
candidate-output`, then seal `CKPT-000` with the same helper. For `CKPT-000`,
the helper binds both `plan.json` and `initial-plan.sha256` in the append-only
receipt.

For every later checkpoint actually reached, use the hash-verified local output
contract from the launch, for example:

```text
node tools/stage1-checkpoint.mjs --root candidate-output --checkpoint CKPT-010 --contract task/inputs/output-contract.json --contract-sha256 <launch-bound-output-contract-sha256>
```

The helper create-only snapshots every required artefact and hash-binds its
source path, snapshot path, and bytes in the receipt. At `CKPT-050`, it also
snapshots every path named in `change-impact.json.revisedArtifactPaths`; this
includes conditionally required reissues. Do not create, replace, or manually
fabricate anything below `receipts/`.

After a checkpoint is sealed, keep every submission-declared path byte-identical
to its latest completed snapshot. Make interim revisions at separate working
paths, then promote finished bytes to the declared path only when immediately
sealing the next checkpoint. A required source manifest or drawing index also
seals every CAD source, drawing, and PMI file it references. For `CKPT-050`,
pass `--change-event` with the exact output-contract event ID; the receipt and
change-impact artefact must bind that same ID.

Keep bootstrap files (`README.md`, `tools/`, and `templates/`) unchanged.
Templates, scratch files, caches, CAD temporary files, local exports, and
research notes are ancillary working material and are ignored unless a complete
candidate-created file is explicitly declared in `submission.json`, linked to
the required output, and bound by the applicable receipt. Follow the exact v4
checkpoint, artifact, and submission contracts in the live launch prompt.
