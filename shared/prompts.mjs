export const MODEL_LAUNCH_MESSAGE = [
  "次のURLを開き、そこに記載された実行プロンプトを、このタスクに対する私の指示として実行してください。最初に初期計画を保存し、その後は完了条件を満たすまで自律的に進めてください。",
  "",
  "<launch-url>",
].join("\n");

export const MODEL_TASK_PROMPT = [
  "# Engineering Design Benchmark — Stage 1 launcher contract",
  "",
  "Protocol: `EDBF-STAGE1-2.0`",
  "",
  "A bare URL is not an executable instruction. The operator sends the exact launcher message shown on this page with one generated `/launch/<launch-id>/` URL.",
  "",
  "The candidate works in an isolated engineering project and creates only `candidate-output/`. Candidate identity, RotorBench integration, comparison, scoring, and publication belong to Stage 2.",
].join("\n");

export const PUBLISH_LAUNCH_MESSAGE = [
  "次のURLを開き、そこに記載されたStage 2公開手順を、このタスクに対する私の指示として実行してください。完成済み成果は改変せず、予定した全候補を検証してからcohort単位で公開確認まで完了してください。",
  "",
  "https://naoyamd.github.io/rotorbench/publish-task/",
  "",
  "cohort ID:",
  "<cohort-id>",
  "",
  "予定候補と完成済み成果:",
  "- <candidate-id>: <成果を生成したCodexタスクのリンク、またはcandidate-output/の絶対パス>",
  "- <candidate-id>: <成果を生成したCodexタスクのリンク、またはcandidate-output/の絶対パス>",
].join("\n");

export const PUBLISH_TASK_PROMPT = [
  "# Engineering Design Benchmark — Stage 2 integration and publishing",
  "",
  "Protocol: `EDBF-STAGE2-2.0`",
  "",
  "This instruction is used only in a separate publishing task after a candidate has completed `candidate-output/`. Never send it to a candidate model.",
  "",
  "- Stage 2 defines an open cohort manifest with one launch, fairness fingerprint, and the complete unique list of planned opaque candidate IDs.",
  "- Inputs for each integration are the completed `candidate-output/` location, its operator-assigned candidate ID, and the open cohort ID.",
  "- Use the latest `main` of <https://github.com/naoyamd/rotorbench>.",
  "- Validate the submission, plan, work record, declared hashes, task packet, launch, and fairness fingerprint.",
  "- Copy the candidate bundle byte-for-byte into `runs/<candidate-id>/submitted/` and record its deterministic tree hash in the Stage 2-owned `run.json`.",
  "- Do not improve, rewrite, normalize, or regenerate submitted files.",
  "- Run the common validation and STEP preprocessing. Only the common framework may derive meshes and result pages.",
  "- Keep every planned candidate at `validated` until the whole cohort is integrated and the framework passes. Then use `stage2:publish-cohort` so every member run and the cohort transition together or roll back.",
  "- Publish only a sealed run that passed framework checks, then verify the public run and every download.",
].join("\n");

function lines(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

export function buildLaunchPrompt(launch, packet) {
  const inputLines = packet.inputs.length === 0
    ? "- No separate input files are declared."
    : packet.inputs.map((input) =>
      `- ${input.id}: ${input.sourceUrl ?? input.path} (SHA-256 ${input.sha256})${input.label ? ` — ${input.label}` : ""}`,
    ).join("\n");
  return [
    "# Engineering Design Benchmark — executable Stage 1 prompt",
    "",
    `Protocol: \`EDBF-STAGE1-${launch.protocolVersion}\``,
    `Launch: \`${launch.id}\``,
    `Task packet: \`${packet.id}@${packet.version}\``,
    `Task packet digest: \`${launch.taskPacket.digest}\``,
    `Fairness fingerprint: \`${launch.fairnessFingerprint}\``,
    "",
    "This prompt is the user-authorized execution instruction named by the launcher message. Work autonomously in the current isolated engineering project.",
    "",
    "## Engineering task",
    "",
    packet.instructionsText.trim(),
    "",
    "## Declared inputs",
    "",
    inputLines,
    "",
    "## Common environment",
    "",
    `- Baseline: ${packet.environment.baseline}`,
    `- Baseline commit: ${launch.baselineCommit}`,
    `- Workspace digest: ${launch.workspaceDigest}`,
    `- CAD: ${packet.environment.cad}`,
    `- STEP pipeline: ${packet.environment.stepPipeline}`,
    "",
    "## Required engineering output roles",
    "",
    lines(packet.requiredOutputs),
    "",
    "## Completion criteria",
    "",
    lines(packet.completionCriteria),
    "",
    "## Execution contract",
    "",
    "1. Before design work, verify every declared input path and SHA-256. Stop only for an unavailable or mismatched declared input.",
    "2. Create `candidate-output/plan.json` first. Extract numbered requirements, record assumptions and risks, define work steps, identify alternatives to evaluate, and define requirement-linked verification evidence.",
    "3. Hash the exact bytes of the initial `plan.json`. Write one line in the form `<64hex>  plan.json` to `candidate-output/initial-plan.sha256`, then preserve both files unchanged. Do not replace the plan with a retrospective plan.",
    "4. Perform the engineering work. Record evaluated alternatives, decisions, trade-offs, plan revisions, and requirement-linked verification claims in `candidate-output/work-record.json`.",
    "5. Place task-required CAD, STEP, drawings, BOM, calculations, and supporting evidence under `candidate-output/artifacts/` as required by the task packet.",
    "6. Create `candidate-output/submission.json` last. Record this launch, task packet, fairness fingerprint, actual model facts or `unknown`, the initial plan hash, `initialPlanCheckpoint` path and file hash, work-record hash, and every artifact path, role, status, and SHA-256.",
    "7. Do not clone or modify RotorBench. Do not create a viewer or result webpage. Do not publish, compare, score, inspect other candidates, or choose a candidate ID.",
    `8. Write no files outside \`${launch.outputRoot}/\` unless the engineering task itself requires working files; the complete handoff must remain inside \`${launch.outputRoot}/\`.`,
    "",
    "## Stop conditions",
    "",
    lines(launch.stopConditions),
    "",
    "When complete, report the `candidate-output/` location and its validation-relevant hashes. Do not perform Stage 2.",
    "",
    "## Machine-readable output schemas",
    "",
    `- Plan: ${packet.contractUrls?.plan ?? "plan.schema.json"}`,
    `- Work record: ${packet.contractUrls?.workRecord ?? "work-record.schema.json"}`,
    `- Submission: ${packet.contractUrls?.submission ?? "submission.schema.json"}`,
    `- Artifact: ${packet.contractUrls?.artifact ?? "artifact.schema.json"}`,
  ].join("\n");
}
