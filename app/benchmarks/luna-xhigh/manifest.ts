import type { RotorCandidate } from "../types";
import { LunaCandidateView } from "./candidate-view";

export const lunaXhighCandidate: RotorCandidate = {
  id: "luna-xhigh",
  kind: "model",
  name: "Luna xhigh",
  maker: "IMPLEMENTATION UNDER TEST",
  summary: "平行に傾く上下スワッシュプレートと固定長リンクを描く独立疑似3D実装。",
  version: "2026.07",
  metadata: {
    provider: "OpenAI",
    model: "Luna role (runtime model unavailable)",
    reasoning: "xhigh requested",
    runDate: "2026-07-23",
    promptVersion: "RB-1.0",
    tags: ["Canvas", "pseudo-3D", "fixed-link"],
  },
  theme: {
    accent: "#55e6c8",
    accentSoft: "rgba(85, 230, 200, 0.16)",
    grid: "rgba(85, 230, 200, 0.13)",
    renderer: "luna",
  },
  View: LunaCandidateView,
};
