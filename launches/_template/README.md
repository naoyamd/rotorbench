# Stage 0 launch output

Do not hand-edit a launch here. `stage0 freeze-launch` creates an immutable
Stage 1 v3 directory containing `launch.json`, `prompt.txt`,
`baseline-attestation.json`, `execution-profile.json`, and digest-bound
`release.json`. The profile must provide the canonical HTTPS deployment base
URL (without a trailing slash); Stage 0 freezes every prompt input and schema
reference against that exact base.

Release the launch in this order: deploy `release-ready`, run `live-verify`,
deploy `live-verified`, run create-only `activate-live`, then perform the
final deploy and run read-only `audit-live`. Confirm the remote `launch.json`
and `prompt.txt` checksums, the published activation record, final-only marker,
and rendered prompt bytes. The activation record is stored outside this
immutable directory; its page SHA is forensic evidence, while the immutable
manifest and prompt bytes and semantic markers are the integrity gate.
