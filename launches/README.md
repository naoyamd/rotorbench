# Stage 1 launches

A launch binds one immutable task packet to one baseline workspace and common
environment. Its fairness fingerprint excludes candidate identity. Every model
in a comparison cohort receives the same launch URL.

The public route is generated at `/launch/<launch-id>/`. The `_template/`
directory is excluded from routing and does not represent a runnable task.
