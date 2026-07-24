import type { Metadata } from "next";
import { absoluteSiteUrl } from "../../site-url";
import { Stage0Handoff } from "../stage0-handoff";
import {
  STAGE0_RELEASE_HANDOFF,
  materializeHandoff,
} from "../../../shared/prompts.mjs";

export const metadata: Metadata = {
  title: "Stage 0 release handoff | Engineering Design Benchmark Framework",
};

export default function Stage0ReleasePage() {
  const prompt = materializeHandoff(
    STAGE0_RELEASE_HANDOFF,
    "<stage0-release-url>",
    absoluteSiteUrl("stage0/release/"),
  );
  return (
    <Stage0Handoff
      eyebrow="STAGE 00 / RELEASE &amp; LIVE VERIFICATION"
      title="Release only the explicitly approved digest"
      lead="The release owner changes digest-bound state, never frozen content. Stage 1 remains closed until the deployed launch is verified byte-for-byte."
      prompt={prompt}
      boundaryTitle="Release boundary"
      boundaries={[
        "Require both independent approvals, the expected launch digest, and the exact explicit approval phrase.",
        "Preview first. A mismatch creates a new packet version or launch; it is never corrected in place.",
        "After deployment, verify the canonical page, launch.json, and prompt.txt URLs before recording live-verified state.",
      ]}
    />
  );
}
