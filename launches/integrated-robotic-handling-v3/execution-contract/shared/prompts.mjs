export const MODEL_LAUNCH_MESSAGE = [
  "現在の作業フォルダを基準に次のURLを開き、そこに記載された実行プロンプトを、このタスクに対する私の指示として実行してください。最初にワークスペースの事前検証と初期計画の固定を行い、その後は完了条件を満たすまで自律的に進めてください。",
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
  "Protocol: `EDBF-STAGE1-4.0`",
  "",
  "The operator sends the exact, no-placeholder authorization sentence and canonical `/launch/<launch-id>/` URL block shown on this page.",
  "",
  "Only a Stage 0 live-verified launch with a valid detached post-activation verification is executable. Before any candidate starts, the operator freezes an open cohort, opaque three-run assignments per model, and equal time, token, reasoning, tool, network, and zero-intervention conditions. Immediately before each run, the operator atomically creates a launch-bound isolated workspace, records its receipt hash in the immutable `operator-attested-pre-run` authorization, and enforces the generated access policy. These are auditable operator/harness records, not cryptographic proof of external start time or network enforcement. The candidate preserves the receipt and creates its design evidence only in `candidate-output/`. Candidate identity, RotorBench integration, private evaluator material, assessment, and publication belong to Stage 2.",
].join("\n");

export const PUBLISH_LAUNCH_MESSAGE = [
  "次のURLを開き、そこに記載されたStage 2評価手順を、このタスクに対する私の指示として実行してください。候補成果は改変せず、候補コードを実行せず、凍結済みの静的検査・独立レビュー・多次元評価・cohort単位の公開確認まで完了してください。",
  "",
  "https://naoyamd.github.io/rotorbench/evaluate-task/",
  "",
  "launch ID:",
  "<launch-id>",
  "",
  "run ID:",
  "<opaque-run-id>",
  "",
  "cohort ID:",
  "<cohort-id>",
  "",
  "assessment panel:",
  "fixed-anchor-baseline",
  "",
  "成果物:",
  "<candidate-output/の絶対パス、または成果を生成したCodexタスクのリンク>",
].join("\n");

export const EVALUATE_LAUNCH_MESSAGE = [
  "次の完成済み成果を、指定されたRotorBench launchのStage 2評価へ進めてください。",
  "候補成果は改変せず、候補コードを実行せず、凍結済みの静的検査・独立レビュー・多次元評価・cohort単位の公開確認まで完了してください。",
  "",
  "評価手順:",
  "https://naoyamd.github.io/rotorbench/evaluate-task/",
  "",
  "launch ID:",
  "<launch-id>",
  "",
  "run ID:",
  "<opaque-run-id>",
  "",
  "cohort ID:",
  "<cohort-id>",
  "",
  "assessment panel:",
  "fixed-anchor-baseline",
  "",
  "成果物:",
  "<candidate-output/の絶対パス、または成果を生成したCodexタスクのリンク>",
].join("\n");

export const PUBLISH_TASK_PROMPT = [
  "# Engineering Design Benchmark — Stage 2 evaluation and publication",
  "",
  "Protocol: `EDBF-STAGE2-4.0`",
  "",
  "This instruction is used only in a separate evaluator task after a candidate has completed `candidate-output/`. Never send it to a candidate model.",
  "",
  "- The operator must record frozenAt and freeze the cohort, opaque run assignments, official three repeats per model, and equal execution conditions before the first candidate starts. Immediately before each run, atomically create its launch-bound candidate workspace and bind the returned receipt SHA-256 into the immutable operator-attested-pre-run authorization. These records are auditable operator/harness controls, not cryptographic proof of external start time or network enforcement.",
  "- Inputs are the completed `candidate-output/` location, its predeclared opaque run ID, the live launch, the open cohort, and the assessment panel.",
  "- Use the latest `main` of <https://github.com/naoyamd/rotorbench>.",
  "- Validate the submitted workspace receipt against its pre-run authorization, then validate and byte-seal the submission and run only the launch-frozen static sanitizer. Never execute candidate source, macros, binaries, web content, or CAD embedded code.",
  "- Copy the candidate bundle byte-for-byte into `runs/<opaque-run-id>/submitted/` and record its deterministic tree hash in the Stage 2-owned `run.json`.",
  "- Do not improve, rewrite, normalize, or regenerate submitted files.",
  "- Prepare the identity-neutral review package, seal every external reviewer input into evaluator-owned opaque review records, and bind only those record paths/hashes into assessment. Require sealed primary and secondary identity-blind independent engineering reviews; use a sealed third adjudicator on conflicts. The public scoring rubric and deterministic scorer remain unchanged for reproducibility.",
  "- Finalize every evaluator record before publication. After every predeclared run is finalized, use stage2:publish-cohort -- --cohort-id <id> --disclosure <cohort-disclosure.json>; it requires exact frozen group membership and publishes the complete cohort atomically.",
  "- Report qualification, the ten-dimensional vector, intervals, evidence coverage, raw metrics, uncertainty, and efficiency separately. Never emit a composite score.",
].join("\n");

function lines(values) {
  return values.map((value) => `- ${value}`).join("\n");
}

export function buildLaunchPrompt(launch, packet) {
  const isV4 = launch.protocolVersion === "4.0";
  const workspaceBootstrap = packet.workspaceBootstrap ?? launch.workspaceBootstrap;
  const outputContractInput = (packet.inputs ?? []).find(
    ({ id }) => id === "output-contract",
  );
  const inputLines = packet.inputs.length === 0
    ? "- No separate input files are declared."
    : packet.inputs.map((input) =>
      `- ${input.id}: ${isV4 ? `task/${input.path}` : (input.sourceUrl ?? input.path)} (SHA-256 ${input.sha256}${input.sizeBytes !== undefined ? `, ${input.sizeBytes} bytes` : ""}${input.mediaType ? `, ${input.mediaType}` : ""})${input.label ? ` — ${input.label}` : ""}`,
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
  const checkpointLines = (packet.checkpoints ?? []).map((checkpoint) =>
    `${checkpoint.id}: ${checkpoint.title} (sequence ${checkpoint.sequence}; ${checkpoint.phase}${checkpoint.requiredForBaseline === false ? "; optional evaluator-issued panel, not required for baseline completion" : "; required for baseline completion"})`,
  );
  const changeCommitmentLines = (packet.changeEvents ?? []).map((event) =>
    `${event.id}: commitment digest ${event.digest}; trigger after receipt ${event.triggerAfterCheckpointId}. The change payload is not disclosed in this launch.`,
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
    ...(isV4 && workspaceBootstrap ? [
      `- Public workspace bootstrap: ${workspaceBootstrap.kind} at ${workspaceBootstrap.location} (SHA-256 ${workspaceBootstrap.sha256})`,
      "- The operator has already materialized and hash-verified the launch, all declared task inputs, schemas, and helpers in this isolated workspace. Use the local files; do not download or replace them.",
      "- Preserve `candidate-workspace-receipt.json`, `isolation-policy.json`, and `candidate-output/workspace-receipt.json` unchanged. The evaluator rejects a submission whose receipt differs from the pre-run authorization.",
    ] : []),
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
    ...(isV4 ? [
      "1. Before design work, run `node tools/candidate-workspace-preflight.mjs --root .`. Stop and report the blocker unless it returns `valid`; do not repair, replace, or redownload a frozen input.",
      "2. Create `candidate-output/plan.json` first. Extract numbered requirements, record assumptions and risks, define work steps, identify alternatives to evaluate, and define requirement-linked verification evidence.",
      "3. Run `node tools/candidate-workspace-preflight.mjs --root . --require-plan`, then hash the exact bytes of the valid initial `plan.json`. Write one line in the form `<64hex>  plan.json` to `candidate-output/initial-plan.sha256`, create the CKPT-000 receipt as directed below, and preserve the plan, hash, workspace receipt, and checkpoint receipt unchanged. Do not replace the plan with a retrospective plan.",
    ] : [
      "1. Before design work, verify every declared input path and SHA-256. Stop only for an unavailable or mismatched declared input.",
      "2. Create `candidate-output/plan.json` first. Extract numbered requirements, record assumptions and risks, define work steps, identify alternatives to evaluate, and define requirement-linked verification evidence.",
      "3. Hash the exact bytes of the initial `plan.json`. Write one line in the form `<64hex>  plan.json` to `candidate-output/initial-plan.sha256`, then preserve both files unchanged. Do not replace the plan with a retrospective plan.",
    ]),
    "4. Perform the engineering work. Record evaluated alternatives, decisions, trade-offs, plan revisions, and requirement-linked verification claims in `candidate-output/work-record.json`.",
    "5. Place task-required CAD, STEP, drawings, BOM, calculations, and supporting evidence under `candidate-output/artifacts/` as required by the task packet.",
    `6. Create \`candidate-output/submission.json\` last. Record protocol version \`${launch.protocolVersion}\`, this launch, task packet id/version/manifest digest${launch.taskPacket.bundleDigest ? "/bundle digest" : ""}, fairness fingerprint${launch.executionContractDigest ? ", execution contract digest, prompt SHA-256 from launch.json, and launch digest" : ""}, actual model facts or \`unknown\`, the initial plan hash, \`initialPlanCheckpoint\` path and file hash, work-record hash, and every artifact path, role, status, SHA-256, and \`requiredOutputRefs\` binding to the packet output IDs it satisfies. For blind review, write provider, model name, and model version only in \`submission.json.model\`; do not place them in plans, work records, receipts, artifacts, filenames, drawing title blocks, CAD metadata, or comments.`,
    ...(isV4 ? [
      `7. Immediately after writing and hashing the immutable initial plan, create its first append-only receipt with \`node tools/stage1-checkpoint.mjs --root candidate-output --checkpoint CKPT-000 --evidence initial-plan.sha256\`. For each later baseline checkpoint actually reached, run \`node tools/stage1-checkpoint.mjs --root candidate-output --checkpoint <checkpoint-id> --contract task/inputs/output-contract.json --contract-sha256 ${outputContractInput?.sha256 ?? "<verified-output-contract-sha256>"} --evidence <each-required-evidence-path>\`. Include every artefact required by that checkpoint; a required source manifest or drawing index also requires every file it references. Preserve the emitted immutable snapshot and receipt files and record their declarations in \`submission.json.checkpointReceipts\` in sequence order. After sealing a checkpoint, keep submission-declared paths byte-identical to their latest completed snapshots: make interim revisions at separate working paths, then promote a finished revision only when immediately sealing the next checkpoint.`,
      "8. In `submission.json`, record `partialAttainment` honestly: attempted checkpoints, completed checkpoints, the highest verified checkpoint, and the stop reason. A partial submission is valid evidence; never fabricate later checkpoints.",
      "9. Copy the frozen `v4Contract` object exactly into `submission.json.v4Contract`. Set `sanitizationRequest.profileDigest` to the frozen sanitization-profile digest. Sanitization is executed and attested only by the evaluator; do not claim that you sanitized the submission.",
      `10. Before sealing \`submission.json\`, run the launch-provided preflight against the local hash-verified output contract: \`node tools/stage1-preflight.mjs --root candidate-output --highest <highest-verified-checkpoint-id> --contract task/inputs/output-contract.json --contract-sha256 ${outputContractInput?.sha256 ?? "<verified-output-contract-sha256>"}\`. Resolve every due error; retain deferred later-checkpoint obligations as deferred rather than fabricating them.`,
      "11. Private instances, hidden robustness material, and change-event payloads are not available in this baseline launch. Do not infer, request, or create substitutes for them. Optional evaluator-issued checkpoints are not required for a complete baseline submission and must not be emitted unless a separately controlled panel supplies the committed event. When such an event is supplied, CKPT-050, its change-impact artifact, and `--change-event` must all bind the exact event ID committed by the output contract.",
    ] : []),
    `${isV4 ? 12 : 7}. Do not clone or modify RotorBench. Do not create a viewer or result webpage. Do not publish, compare, score, inspect other candidates, or choose a candidate ID.`,
    `${isV4 ? 13 : 8}. Write no files outside \`${launch.outputRoot}/\` unless the engineering task itself requires working files; the complete handoff must remain inside \`${launch.outputRoot}/\`.`,
    ...(isV4 ? [
      "",
      "## Version 4 checkpoint contract",
      "",
      checkpointLines.length > 0 ? lines(checkpointLines) : "- No checkpoint definitions are available.",
      "",
      "## Sealed change-event commitments",
      "",
      changeCommitmentLines.length > 0 ? lines(changeCommitmentLines) : "- No later change event is committed for this launch.",
    ] : []),
    "",
    "## Stop conditions",
    "",
    lines(launch.stopConditions),
    "",
    "When complete, report the `candidate-output/` location and its validation-relevant hashes. Do not perform Stage 2.",
    "",
    "## Machine-readable output schemas",
    "",
    `- Plan: ${isV4 ? "schemas/plan.schema.json" : (packet.contractUrls?.plan ?? "plan.schema.json")}`,
    `- Work record: ${isV4 ? "schemas/work-record.schema.json" : (packet.contractUrls?.workRecord ?? "work-record.schema.json")}`,
    `- Submission: ${isV4 ? "schemas/submission.schema.json" : (packet.contractUrls?.submission ?? "submission.schema.json")}`,
    `- Artifact: ${isV4 ? "schemas/artifact.schema.json" : (packet.contractUrls?.artifact ?? "artifact.schema.json")}`,
    ...(isV4 ? [
      "- Version 4 contract: schemas/stage-contract-v4.schema.json",
      "- Evaluation record: schemas/evaluation-record.schema.json",
      "- Assessment evidence: schemas/assessment-evidence.schema.json",
    ] : []),
  ].join("\n");
}
