# Engineering Design Benchmark — Stage 2 integration and publishing

Protocol: `EDBF-STAGE2-3.0`

This instruction is used only in a separate publishing task after a candidate
has completed `candidate-output/`. Never send it to a candidate model.

## What the operator sends

Wait until every planned Stage 1 task has finished, then send one publishing
task this exact message. Replace the placeholders and repeat the candidate line
for the complete cohort:

```text
次のURLを開き、そこに記載されたStage 2公開手順を、このタスクに対する私の指示として実行してください。完成済み成果は改変せず、予定した全候補を検証してからcohort単位で公開確認まで完了してください。

https://naoyamd.github.io/rotorbench/publish-task/

cohort ID:
<cohort-id>

予定候補と完成済み成果:
- <candidate-id>: <成果を生成したCodexタスクのリンク、またはcandidate-output/の絶対パス>
- <candidate-id>: <成果を生成したCodexタスクのリンク、またはcandidate-output/の絶対パス>
```

## Execution contract

- Stage 2 first defines `cohorts/<cohort-id>/cohort.json` with one launch,
  fairness fingerprint, and the complete unique list of planned opaque
  candidate IDs. The cohort begins at `open`.
- Inputs for each integration are the completed `candidate-output/` location,
  its operator-assigned opaque candidate ID, and the open cohort ID.
- Use the latest `main` of <https://github.com/naoyamd/rotorbench>.
- Validate `submission.json`, `plan.json`, `work-record.json`, every declared
  file hash, task-packet manifest and bundle digests, live-verified launch,
  execution-contract digest, prompt hash, launch digest, and fairness
  fingerprint. Protocol v2 remains readable for existing material, but every
  new Stage 0 launch and Stage 1 bundle uses v3.
- Copy the entire candidate bundle byte-for-byte into
  `runs/<candidate-id>/submitted/`. Do not improve, rewrite, normalize, or
  regenerate any submitted file.
- Calculate the deterministic tree hash of the copied bundle and record it in
  the Stage 2-owned `run.json`. Candidate content must never be able to create
  a published run by itself.
- Integrate every planned candidate with
  `stage2:integrate -- --source <candidate-output> --candidate-id <id>
  --cohort-id <cohort-id>` and keep every run at `validated`. Do not publish
  while another listed candidate is incomplete.
- After all planned candidates are integrated, run the common validation, STEP
  preprocessing, static build, links, and tests. Only the common framework may
  derive browser meshes or public result pages.
- Transition the whole cohort only after every listed run and the framework
  pass, using `pnpm stage2:publish-cohort -- --cohort-id <cohort-id>`. This
  command fixes each successful publication report by hash and updates all
  member runs and the cohort together, rolling back on failure. Commit and push
  the exact validated source, wait for GitHub Pages, and deploy the same commit
  to Sites when configured.
- Confirm the home, run page, process-evidence downloads, engineering artifact
  downloads, STEP view or failure report, and validation report.
- Report the candidate ID, source bundle tree hash, commit, public run URL, and
  verification result.

If the completed bundle location, candidate ID, or open cohort ID is missing,
report only the missing item and stop.
