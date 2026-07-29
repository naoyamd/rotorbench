# Candidate output v4 template

Copy this directory to the launch-provided `candidate-output/` directory. Do not copy the
placeholder digests: use the frozen `launch.json` values exactly. Create the immutable
initial-plan checkpoint, then create one append-only receipt per v4 checkpoint with:

```text
pnpm stage1:checkpoint -- --root candidate-output --checkpoint CKPT-000
```

The candidate may submit `status: partial`; that preserves verified engineering attainment
without representing an incomplete result as a complete design.
