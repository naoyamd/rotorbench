# Integrated robotic handling system design

## Your assignment

Design and document a fixed-base industrial robot and its powered
opening/closing mechanical gripper for the supplied machine-tending cell. The
system runs from the floor mounting interface through the base, manipulator,
wrist, end-effector interface, gripper actuation, fingers, and workpiece
contact surfaces.

This is an engineering-design benchmark. Treat the supplied values as the
authoritative public baseline for this run. Select and justify reasonable
assumptions where the brief leaves design freedom, but do not silently change a
requirement or invent unavailable input data.

This is a full Stage 1 design task. Before design work, the execution protocol
will require an immutable `plan.json` checkpoint. That checkpoint is process
evidence, not a substitute for the engineering deliverables below. Then carry
out the design, test your own artefacts, correct defects you find, and submit
the complete evidence package. Do not stop at a concept, a rendered image, or
a partial CAD assembly.

## Public inputs

Read every file declared in `task.json` and use its IDs when you
refer to a requirement or input. In particular:

- `inputs/requirements.json` defines what the handling system must achieve.
- `inputs/cell-layout.json` and `inputs/interface-dimensions.json` define the
  coordinate frame, required poses, clearances, fixture interfaces, and
  collision envelopes.
- `inputs/workpieces.json` defines the three parts and their approved
  mechanical grasp regions.
- `inputs/component-catalog-snapshot.json` is the only source of catalogue
  actuator, reducer, brake, bearing, and gripper-transmission data for the
  benchmark. You may design custom structural parts and linkages.
- `inputs/calibration-provenance.json` identifies values whose uncertainty or
  calibration method must be carried into the design plan.
- `inputs/evaluation-commitments.json` and `inputs/output-contract.json`
  explain the later evidence and evaluation boundary. They are not a design
  solution.

## Required system boundary

The Stage 1 design must be a single integrated handling system. The candidate
is free to select serial, parallel, hybrid, or other mechanically defensible
manipulator architecture, provided it can be represented by the neutral
kinematic and CAD handoff. An off-the-shelf complete robot arm may not be used
as the candidate's designed system.

The end effector must include a powered mechanical opening/closing mechanism
and at least two opposing mechanical contact paths. Vacuum, magnetic adhesion,
or a fixture may be an auxiliary retention feature, but may not be the primary
load path. One common installed gripper configuration must handle all three
baseline workpieces; automatic tool change and changing fingers between the
three baseline cycles are not permitted.

Control software, PLC logic, certification, and electrical cabinet design are
outside the candidate's implementation scope. They remain design interfaces:
declare the mechanical-control handoff, motion assumptions, sensing needs,
brake behavior, and safety concept needed for the mechanical design to be
evaluated under the common host trajectory model.

## Required engineering deliverables

Write only under `candidate-output/`. Before any design work, write the
immutable `plan.json` checkpoint required by the execution profile. Then
produce the following files using the paths, schemas, and evidence roles in
`inputs/output-contract.json`:

1. A requirement trace and concept-selection record, including at least three
   feasible integrated arm-and-gripper architectures, rejection reasons, and
   the design decision trail to the selected concept.
2. Native CAD source or a reproducible parametric CAD source, plus a neutral
   assembly STEP AP242 export. The assembly must contain the base,
   manipulator, wrist, gripper body, actuation/transmission, fingers, relevant
   purchased components, and workpiece interfaces.
3. A neutral kinematic and motion manifest with joint topology, limits,
   coordinate transforms, payload states, required waypoints, carried
   workpiece envelopes, and collision-relevant geometry references.
4. A complete BOM separating candidate-designed, catalogue, fastener, and
   consumable parts, with quantity, mass, material/process, catalogue source,
   and cost basis or uncertainty.
5. System calculations covering workspace/cycle, load cases, drive/reducer/
   brake sizing, structural load path and deflection, gripper force and contact
   retention, life/duty, tolerance/accuracy budget, and energy/power estimate.
6. Controlled drawings and PMI for the critical design set: base/column,
   governing high-load joint or link, complete gripper assembly, all finger
   contact components, and any part governing accuracy or safety.
7. A gripper design package that exposes the opening/closing mechanism,
   transmission, force/displacement characteristic, contacts, retention path,
   sensing interface, loss-of-power behavior, and all three workpiece grasp
   configurations.
8. A safety and reliability package containing a requirement-linked risk
   register/FMEA, fault load cases, end-stop/brake/retention concept,
   pinch/crush mitigation, cable/utility routing, and service procedure.
9. A verification report and evidence manifest that identify the source,
   method, model scope, units, output, acceptance result, and uncertainty for
   every claimed requirement result.
10. A change-readiness record mapping each major interface and calculation to
    the type of later workpiece, cell, cycle, or safety change that would
    require rework.

Use no information from other candidates or benchmark runs. Do not alter the
task inputs, shared framework, task definition, or evaluation rules. If an
input is missing or its integrity cannot be verified, stop and record the
blocker rather than substituting a private data set.

## What good Stage 1 work looks like

A strong submission turns the cell, workpiece, safety, manufacturing, and
evidence requirements into a coherent, manufacturable and verifiable system.
It distinguishes facts from assumptions; makes conflicts visible; identifies
the governing load cases and design decisions; and leaves an independent
evaluator a clear path from each requirement to inspectable evidence. It does
not optimise for prose volume or pretend that a simulation, CAD image, or
spreadsheet is evidence without a defined model, input, output, and acceptance
method.
