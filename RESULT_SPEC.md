# Framework result and evidence specification

A published run is rendered at `/runs/<candidate-id>/` only when:

1. it references a valid task packet, launch, and Stage 2-owned cohort;
2. a protocol v3 launch is `live-verified`, and its packet
   bundle, execution-contract, prompt, and launch digests match the sealed
   submission and Stage 2-owned run;
3. its benchmark version, launch, cohort membership, and fairness fingerprint
   match;
4. Stage 2 has sealed `submitted/` with `sha256-tree-v1`;
5. every process-evidence and artifact path is a safe regular file below the
   sealed bundle path;
6. the sealed `submission.json` matches the run model, process hashes, and
   complete artifact declarations;
7. every protocol v3 artifact declares `requiredOutputRefs`, and each
   task-packet required output ID is bound by exactly one artifact whose role
   matches that output and whose status is `present`;
8. every declared SHA-256 and the immutable initial-plan checkpoint match;
9. Stage 2 has fixed a schema-valid, successful publication report whose seal
   attestation matches the run;
10. every candidate listed in the cohort has a valid sealed run; and
11. the run and its complete cohort both have status `published`.

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
