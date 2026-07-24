import type { Metadata } from "next";
import { absoluteSiteUrl } from "../../site-url";
import { Stage0Handoff } from "../stage0-handoff";
import {
  STAGE0_REVIEW_HANDOFF,
  materializeHandoff,
} from "../../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 0 independent review | Engineering Design Benchmark Framework",
};

export default function Stage0ReviewPage() {
  const prompt = materializeHandoff(
    STAGE0_REVIEW_HANDOFF,
    "<stage0-review-url>",
    absoluteSiteUrl("stage0/review/"),
  );
  return (
    <Stage0Handoff
      eyebrow="STAGE 00 / INDEPENDENT REVIEW"
      title="Review frozen evidence without editing it"
      lead="Engineering and protocol review are separate assignments. Their reviewers must be different people, and neither may be the task author."
      prompt={prompt}
      boundaryTitle="Reviewer boundary"
      boundaries={[
        "Engineering review binds the packet manifest and whole packet bundle; protocol review binds the launch, execution contract, and rendered prompt.",
        "Do not repair the task or launch while reviewing. Return blocking issues and require a new version or launch.",
        "Approval is valid only for the exact reviewed digests and contains no candidate, cohort, or publication decision.",
      ]}
    />
  );
}
