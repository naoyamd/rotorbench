# Stage 1 launches

A launch binds one immutable task packet to one baseline workspace and common
environment. Its fairness fingerprint excludes candidate identity. Every model
in a comparison cohort receives the same launch URL.

The public route is generated at `/launch/<launch-id>/`. The `_template/`
directory is excluded from routing and does not represent a runnable task.

New launches are created only through the Stage 0 freeze command. A
`release-ready` launch receives its static inspection page and machine
endpoints, but only a `live-verified` launch appears in the Stage 1 handoff.
Published launches expose machine-readable
`/framework/launches/<id>/launch.json` and `prompt.txt`; their exact contract
bytes are under `/framework/contracts/<executionContractDigest>/`.
