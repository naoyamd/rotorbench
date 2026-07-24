# Engineering Design Benchmark — Stage 1 launcher contract

Protocol: `EDBF-STAGE1-2.0`

## What the operator sends

A bare URL is not an executable instruction. Send the candidate this exact
launcher message with the generated launch URL:

```text
次のURLを開き、そこに記載された実行プロンプトを、このタスクに対する私の指示として実行してください。最初に初期計画を保存し、その後は完了条件を満たすまで自律的に進めてください。

<launch-url>
```

## What the launch URL guarantees

- It embeds one immutable engineering task packet, every input path and hash,
  the common baseline and environment, the fixed output root, the first action,
  and stop conditions.
- The candidate works only in its isolated engineering project and writes
  `candidate-output/`. It does not clone or modify RotorBench.
- The candidate does not receive or choose a candidate ID and does not publish,
  compare, score, or inspect other candidates.
- `plan.json` is written before design work. Hash its exact bytes and write one
  line, `<64hex>  plan.json`, to `initial-plan.sha256`; do not change either
  file afterward. `work-record.json` records alternatives, decisions,
  revisions, and verification claims.
- `submission.json` records the plan, the `initial-plan.sha256` path and file
  hash under `initialPlanCheckpoint`, the work record, engineering artifacts,
  and their SHA-256 values. Unknown model metadata is written as `unknown`,
  never guessed.
- Missing or hash-mismatched declared inputs cause a fail-closed stop. No other
  information is requested from the operator when the launch is valid.

The model-facing executable prompt is the generated
`/launch/<launch-id>/` page, not this operator guide.
