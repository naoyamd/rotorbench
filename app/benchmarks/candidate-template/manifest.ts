import type { RotorCandidate } from "../types";
import { CandidateView } from "./candidate-view";

/**
 * フォルダを複製後、すべてのプレースホルダーを実行情報に置換します。
 */
export const candidate: RotorCandidate = {
  id: "replace-with-unique-id",
  kind: "model",
  name: "Model name",
  maker: "PROVIDER / RUN LABEL",
  summary: "この実装の狙いを1文で記載します。",
  version: "1.0",
  metadata: {
    provider: "Provider",
    model: "Exact model ID",
    reasoning: "Reasoning level or mode",
    runDate: "YYYY-MM-DD",
    promptVersion: "RB-2.0",
    tags: ["candidate"],
  },
  theme: {
    accent: "#9caeff",
    accentSoft: "rgba(156, 174, 255, 0.16)",
    grid: "rgba(156, 174, 255, 0.13)",
    renderer: "custom",
  },
  View: CandidateView,
};
