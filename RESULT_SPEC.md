# Framework result and evidence specification

A published run is rendered at `/runs/<candidate-id>/` only when:

1. it references a valid task packet, launch, and Stage 2-owned cohort;
2. its benchmark version, launch, cohort membership, and fairness fingerprint
   match;
3. Stage 2 has sealed `submitted/` with `sha256-tree-v1`;
4. every process-evidence and artifact path is a safe regular file below the
   sealed bundle path;
5. the sealed `submission.json` matches the run model, process hashes, and
   complete artifact declarations;
6. every task-packet `requiredOutputs` role has at least one artifact whose
   status is `present`;
7. every declared SHA-256 and the immutable initial-plan checkpoint match;
8. Stage 2 has fixed a schema-valid, successful publication report whose seal
   attestation matches the run;
9. every candidate listed in the cohort has a valid sealed run; and
10. the run and its complete cohort both have status `published`.

The neutral result page exposes:

1. Overview — benchmark, launch, fairness fingerprint, model facts, and seal
2. Process — initial requirements/plan and later work record as separate,
   hashed downloads
3. 3D — only common preprocessed meshes for STEP artifacts
4. Drawings
5. BOM
6. Calculations
7. All submitted files
8. Validation — manifest, reference, path, hash, STEP, and bundle-seal checks

The browser never runs candidate HTML, CSS, JavaScript, or CAD parsers.
Candidate files are copied to inert same-origin `.download` paths and retain
their original save names through download metadata. The candidate bundle is
preserved as submitted; derived public assets remain outside the sealed bundle.

The comparison page groups only runs with the same fairness fingerprint. It
does not introduce a score, rank, winner, or task-specific interpretation.
