# Candidate templates

These are immutable bootstrap examples, not evidence. Copy a template into
`candidate-output/` before use and replace every placeholder with facts from
the live `launch.json`; in particular copy the complete frozen `v4Contract`
object exactly. The copied, completed file becomes evidence only when it is
explicitly declared in `submission.json`, linked to the required output, and
bound by the applicable receipt.

Do not edit bootstrap templates or receipt files. For `CKPT-010` and later,
run `node tools/stage1-checkpoint.mjs` with the local hash-verified output
contract and its launch-bound SHA-256; receipt snapshots are created only by
that helper. Keep submission-declared paths equal to their latest completed
snapshots; perform interim edits at separate working paths and promote them
only when immediately sealing the next checkpoint. Required source manifests
and drawing indexes expand to every referenced file. `CKPT-050` additionally
requires the exact output-contract event ID in `--change-event`, the receipt,
and the change-impact artefact. Scratch files, caches, CAD temporary files, local exports, and
unreferenced notes are ancillary working material and are ignored. The
templates do not replace the frozen schemas, task packet, or artifact contract.
Run `node tools/stage1-preflight.mjs` against the same hash-verified output
contract before sealing a checkpoint.
