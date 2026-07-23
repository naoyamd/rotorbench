import type { RotorCandidate } from "../types";
import { ReferenceCandidateView } from "./candidate-view";

export const referenceCandidate: RotorCandidate = {
  id: "reference-kinematics",
  kind: "reference",
  name: "Reference Kinematics",
  maker: "CANONICAL BASELINE · NOT AN LLM",
  summary: "上面図と1/rev波形で共通運動学を検算する、非LLMの独立基準表示。",
  version: "1.0",
  metadata: {
    provider: "RotorBench",
    model: "Reference Kinematics",
    reasoning: "deterministic",
    runDate: "2026-07-23",
    promptVersion: "RB-1.0",
    tags: ["baseline", "canonical-formula", "not-an-LLM"],
  },
  theme: {
    accent: "#ffbd66",
    accentSoft: "rgba(255, 189, 102, 0.16)",
    grid: "rgba(255, 189, 102, 0.13)",
    renderer: "reference",
  },
  View: ReferenceCandidateView,
};
