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

Missing engineering work is retained as partial attainment. It is not converted
into an invalid submission unless A0 fails. An evaluator limitation is reported
as `evaluator-unsupported` or `evaluator-uncertain`, not as a design failure.

The fixed public anchor baseline is the only primary longitudinal panel and is
the task delivered by the public launch URL. Hidden robustness, change
response, and fresh generalization require separately controlled evaluator
inputs and remain optional, separately reported panels. GitHub Pages is not
presented as a private-input delivery system. The scoring contract publishes no
uncalibrated aggregate weighting.
