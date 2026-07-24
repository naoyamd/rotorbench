import type { Metadata } from "next";
import { absoluteSiteUrl } from "../../site-url";
import { Stage0Handoff } from "../stage0-handoff";
import {
  STAGE0_AUTHOR_HANDOFF,
  materializeHandoff,
} from "../../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 0 author handoff | Engineering Design Benchmark Framework",
};

export default function Stage0AuthorPage() {
  const prompt = materializeHandoff(
    STAGE0_AUTHOR_HANDOFF,
    "<stage0-author-url>",
    absoluteSiteUrl("stage0/author/"),
  );
  return (
    <Stage0Handoff
      eyebrow="STAGE 00 / TASK AUTHOR"
      title="Define the task without designing the answer"
      lead="The author converts an authorized source brief and declared files into a lint-clean, versioned draft ready for immutable freeze."
      prompt={prompt}
      boundaryTitle="Author boundary"
      boundaries={[
        "Record input size, media type, provenance, license, and download name; never infer missing values.",
        "Give every required output and completion criterion a stable ID, with explicit output and evidence links.",
        "Stop on unresolved or author-guessed engineering values. Do not solve, launch, review, approve, or publish the task.",
      ]}
    />
  );
}
