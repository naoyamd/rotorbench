# Stage 0 launch output

Do not hand-edit a launch here. `stage0 freeze-launch` creates an immutable
Stage 1 v3 directory containing `launch.json`, `prompt.txt`,
`baseline-attestation.json`, `execution-profile.json`, and digest-bound
`release.json`. The profile must provide the canonical HTTPS deployment base
URL (without a trailing slash); Stage 0 freezes every prompt input and schema
reference against that exact base.
