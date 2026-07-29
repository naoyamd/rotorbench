# Authoring note — integrated robotic handling v1

## What this draft establishes

This is a concrete design task, not a surrogate web-design prompt. A candidate
must design a fixed-base industrial manipulator and a real powered gripper
mechanism for three parts in a constrained machine-tending cell. It must prove
the result through neutral geometry, kinematics, calculations, controlled
drawings, BOM, risk/FMEA, and a traceable evidence manifest.

The task deliberately retains freedom where engineering ability should be
visible: arm topology, joint arrangement, drive layout, structural form,
gripper linkage, contact/compliance strategy, sensing interface, material and
manufacturing choices, and verification approach. It fixes only the cell,
part, interface, safety, evidence, and comparability boundaries necessary to
make those choices assessable.

## Why the gripper is integral to the task

The three workpieces require a common installed end effector to handle:

- an aluminium housing with opposed rails;
- a heavier oiled ductile-iron circular carrier; and
- a thin cosmetic aluminium cover with reinforced internal pads and optional
  anti-drop ledges.

The candidate therefore cannot satisfy the task with a generic end-effector
placeholder, tool changer, or simple replaceable jaw exercise. It must design
the opening/closing actuator and transmission, finger geometry, contact/load
path, loss-of-power behavior, and interaction with the arm as one system.

## Evaluation boundary

`inputs/evaluation-commitments.json` commits to gates, independent result
panels, partial-attainment reporting, input visibility classes, and a neutral
STEP/kinematics-centered evaluator. The detailed scoring contract is authored
separately at:

`evaluation/integrated-robotic-handling-v1/scoring-contract.json`

The packet source includes the byte-identical copy at
`inputs/scoring-contract.json`; its SHA-256 is bound by `task.json`. Exact
weights, thresholds, and automated calculation coverage are therefore public
and stable for this task version.

## Launch handoff

All numerical public inputs are resolved benchmark inputs. Their source class,
applicability, and uncertainty are recorded instead of being presented as
physical test results. Before a benchmark run, the operator freezes this source
as a task-packet v4 bundle and seals the actual private instance and private
change-event payloads against the public commitments. Those payloads do not
belong in this candidate-visible source directory.

Independent rater calibration and any future physical correlation study may
revise a *new version* of the task; they do not alter an already frozen run.

## Non-goals of this directory

This directory contains no candidate solution, CAD model, STEP geometry,
evaluation result, launch instance, private change payload, or public score.
