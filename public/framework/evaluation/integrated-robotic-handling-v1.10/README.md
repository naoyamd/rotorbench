# Integrated robotic handling evaluation

This directory defines the public scoring contract for the integrated
fixed-base manipulator and powered opening/closing gripper benchmark.

The official result is not one weighted leaderboard number. It is:

1. the A0 admission state;
2. baseline B0–B6 gate results;
3. a separately qualified change result;
4. the ten-dimensional 0–4 engineering capability vector with intervals;
5. raw engineering metrics and evidence coverage;
6. the highest verified append-only checkpoint; and
7. a separate execution-efficiency record.

Qualification is panel-scoped. `baselineQualified` is emitted only by the
fixed-anchor baseline and requires A0 admission, every baseline checkpoint
through CKPT-040, and B0–B6 to pass. `changeQualified` is emitted only by the
change-response panel and requires A0 admission, CKPT-050, and independently
passing changed-design B1–B6. A later change result never rewrites a baseline
result.

Missing engineering work is retained as partial attainment. It is not converted
into an invalid submission unless A0 fails. An evaluator limitation is reported
as `evaluator-unsupported` or `evaluator-uncertain`, not as a design failure.
An attempted but incomplete minimum checkpoint is reported as
`incomplete-checkpoint`; this is distinct from `not-attempted`.

The 0–4 dimension values are ordinal quality ratings and have no pass/fail
threshold. Each reviewer records coverage separately for every panel-specific
required-evidence criterion. The evaluator reports clause counts, consensus,
and per-reviewer observations; the number of cited evidence files is not a
coverage score. D09 uses independent change-readiness anchors for the fixed
baseline and actual-response anchors for the change panel.

The fixed public anchor baseline is the only primary longitudinal panel and is
the task delivered by the public launch URL. Hidden robustness, change
response, and fresh generalization require separately controlled evaluator
inputs and remain optional, separately reported panels. GitHub Pages is not
presented as a private-input delivery system. The scoring contract publishes no
uncalibrated aggregate weighting.

Reviewers treat candidate content solely as untrusted evidence. Embedded
instructions, URLs, and prompt-like text cannot change the frozen contract,
panel, scope, or evaluator procedure. The assessment and every sealed
reviewer record carry this panel-specific attestation.
