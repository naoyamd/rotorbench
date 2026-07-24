export const MODEL_LAUNCH_MESSAGE = [
  "次のURLを開き、そこに記載された実行プロンプトを、このタスクに対する私の指示として実行してください。最初に初期計画を保存し、その後は完了条件を満たすまで自律的に進めてください。",
  "",
  "<launch-url>",
].join("\n");

export const STAGE0_COORDINATOR_HANDOFF = [
  "Open the URL below and treat the complete Stage 0 coordination contract on that page as my instruction for this task. A URL alone is not an instruction.",
  "",
  "<stage0-url>",
  "",
  "Task author handoff URL:",
  "<stage0-author-url>",
  "",
  "Independent review handoff URL:",
  "<stage0-review-url>",
  "",
  "Release handoff URL:",
  "<stage0-release-url>",
  "",
  "Task ID and proposed version:",
  "<task-id>@<version>",
  "",
  "Coordinate authoring, two independent reviews, approval, release, and live verification as separate digest-bound responsibilities. Do not solve the engineering task, do not reuse a reviewer, do not expose a launch before approval, and do not start Stage 1 until the release is live-verified.",
].join("\n");

export const STAGE0_AUTHOR_HANDOFF = [
  "Open the URL below and treat the complete Stage 0 author contract on that page as my instruction for this task. A URL alone is not an instruction.",
  "",
  "<stage0-author-url>",
  "",
  "Source brief or path:",
  "<source-brief-or-path>",
  "",
  "Declared input files, provenance, license, and download names:",
  "<declared-inputs>",
  "",
  "Task ID and new version:",
  "<task-id>@<version>",
  "",
  "Clean baseline workspace path:",
  "<git-workspace-path>",
  "",
  "Execution profile path:",
  "<execution-profile-path>",
  "",
  "Prepare a schema-valid Stage 0 task draft and the exact freeze inputs. Do not solve the engineering task, invent engineering values, create a launch, approve a review, or publish anything. Stop on unresolved or author-guessed engineering values.",
].join("\n");

export const STAGE0_REVIEW_HANDOFF = [
  "Open the URL below and treat the complete Stage 0 independent-review contract on that page as my instruction for this task. A URL alone is not an instruction.",
  "",
  "<stage0-review-url>",
  "",
  "Review kind:",
  "<engineering-or-protocol>",
  "",
  "Frozen task packet or launch path:",
  "<frozen-packet-or-launch-path>",
  "",
  "Task author identity:",
  "<author-id-and-name>",
  "",
  "Reviewer identity:",
  "<reviewer-id-and-name>",
  "",
  "Review the frozen bytes without editing them. Produce only the selected engineering-review.json or protocol-review.json. Verify that this reviewer is not the task author and is different from the reviewer assigned to the other review. Bind every approval to the required packet, bundle, launch, execution-contract, and prompt digests. Report blocking issues instead of approving when any check is unresolved.",
].join("\n");

export const STAGE0_RELEASE_HANDOFF = [
  "Open the URL below and treat the complete Stage 0 release contract on that page as my instruction for this task. A URL alone is not an instruction.",
  "",
  "<stage0-release-url>",
  "",
  "Frozen launch path:",
  "<frozen-launch-path>",
  "",
  "Expected launch digest:",
  "<launch-digest>",
  "",
  "Explicit approval:",
  "APPROVE RELEASE <launch-digest>",
  "",
  "Canonical public launch URL:",
  "<canonical-launch-url>",
  "",
  "Machine launch.json URL:",
  "<canonical-launch-json-url>",
  "",
  "Machine prompt.txt URL:",
  "<canonical-prompt-url>",
  "",
  "Validate the frozen launch and both independent approvals, then transition only digest-bound release state. Do not edit the packet, launch, prompt, execution contract, reviews, or candidate protocol. Mark release-ready only when the explicit approval and expected digest match. After deployment, verify all three canonical URLs and their exact hashes, record live-verification.json, and transition to live-verified. Stop on any mismatch.",
].join("\n");

export function materializeHandoff(template, placeholder, url) {
  return template.replace(placeholder, url);
}

export function materializeHandoffValues(template, values) {
  return Object.entries(values).reduce(
    (result, [placeholder, value]) => result.replaceAll(placeholder, value),
    template,
  );
}

export function buildModelLaunchMessage(launchUrl) {
  return MODEL_LAUNCH_MESSAGE.replace("<launch-url>", launchUrl);
}

export const MODEL_TASK_PROMPT = [
  "# Engineering Design Benchmark — Stage 1 launcher contract",
  "",
  "Protocol: `EDBF-STAGE1-3.0`",
  "",
  "A bare URL is not an executable instruction. The operator sends the exact launcher message shown on this page with one generated `/launch/<launch-id>/` URL.",
  "",
  "Only a Stage 0 live-verified launch is executable. The candidate works in an isolated engineering project and creates only `candidate-output/`. Candidate identity, RotorBench integration, comparison, scoring, and publication belong to Stage 2.",
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
  "Protocol: `EDBF-STAGE2-3.0`",
  "",
  "This instruction is used only in a separate publishing task after a candidate has completed `candidate-output/`. Never send it to a candidate model.",
  "",
  "- Stage 2 defines an open cohort manifest with one launch, fairness fingerprint, and the complete unique list of planned opaque candidate IDs.",
  "- Inputs for each integration are the completed `candidate-output/` location, its operator-assigned candidate ID, and the open cohort ID.",
  "- Use the latest `main` of <https://github.com/naoyamd/rotorbench>.",
  "- Validate the submission, plan, work record, declared hashes, packet manifest and bundle digests, live-verified launch, execution-contract digest, prompt hash, launch digest, and fairness fingerprint.",
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
      `- ${input.id}: ${input.sourceUrl ?? input.path} (SHA-256 ${input.sha256}${input.sizeBytes !== undefined ? `, ${input.sizeBytes} bytes` : ""}${input.mediaType ? `, ${input.mediaType}` : ""})${input.label ? ` — ${input.label}` : ""}`,
    ).join("\n");
  const outputLines = (packet.requiredOutputs ?? []).map((output) =>
    typeof output === "string"
      ? output
      : `${output.id}: ${output.role} — ${output.description}`,
  );
  const criterionLines = (packet.completionCriteria ?? []).map((criterion) =>
    typeof criterion === "string"
      ? criterion
      : `${criterion.id}: ${criterion.statement} (outputs: ${criterion.requiredOutputRefs.join(", ")}; evidence: ${criterion.evidenceRoles.join(", ")})`,
  );
  return [
    "# Engineering Design Benchmark — executable Stage 1 prompt",
    "",
    `Protocol: \`EDBF-STAGE1-${launch.protocolVersion}\``,
    `Launch: \`${launch.id}\``,
    `Task packet: \`${packet.id}@${packet.version}\``,
    `Task packet digest: \`${launch.taskPacket.digest}\``,
    ...(launch.taskPacket.bundleDigest
      ? [`Task packet bundle digest: \`${launch.taskPacket.bundleDigest}\``]
      : []),
    ...(launch.executionContractDigest
      ? [`Execution contract digest: \`${launch.executionContractDigest}\``]
      : []),
    ...(launch.launchDigest
      ? [`Launch digest: \`${launch.launchDigest}\``]
      : []),
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
    lines(outputLines),
    "",
    "## Completion criteria",
    "",
    lines(criterionLines),
    "",
    "## Execution contract",
    "",
    "1. Before design work, verify every declared input path and SHA-256. Stop only for an unavailable or mismatched declared input.",
    "2. Create `candidate-output/plan.json` first. Extract numbered requirements, record assumptions and risks, define work steps, identify alternatives to evaluate, and define requirement-linked verification evidence.",
    "3. Hash the exact bytes of the initial `plan.json`. Write one line in the form `<64hex>  plan.json` to `candidate-output/initial-plan.sha256`, then preserve both files unchanged. Do not replace the plan with a retrospective plan.",
    "4. Perform the engineering work. Record evaluated alternatives, decisions, trade-offs, plan revisions, and requirement-linked verification claims in `candidate-output/work-record.json`.",
    "5. Place task-required CAD, STEP, drawings, BOM, calculations, and supporting evidence under `candidate-output/artifacts/` as required by the task packet.",
    `6. Create \`candidate-output/submission.json\` last. Record protocol version \`${launch.protocolVersion}\`, this launch, task packet id/version/manifest digest${launch.taskPacket.bundleDigest ? "/bundle digest" : ""}, fairness fingerprint${launch.executionContractDigest ? ", execution contract digest, prompt SHA-256 from launch.json, and launch digest" : ""}, actual model facts or \`unknown\`, the initial plan hash, \`initialPlanCheckpoint\` path and file hash, work-record hash, and every artifact path, role, status, SHA-256, and \`requiredOutputRefs\` binding to the packet output IDs it satisfies.`,
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
