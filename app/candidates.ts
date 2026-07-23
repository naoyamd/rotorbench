import type { RotorCandidate } from "./benchmarks/types";
import { lunaXhighCandidate } from "./benchmarks/luna-xhigh/manifest";
import { referenceCandidate } from "./benchmarks/reference-kinematics/manifest";

export type {
  CandidateModelMetadata,
  CandidateTheme,
  RotorCandidate,
  RotorCandidateViewProps,
} from "./benchmarks/types";

/**
 * ベンチ対象の登録場所。
 * 新しい実装を追加するときは、この配列に Candidate を追加する。
 */
export const CANDIDATES: RotorCandidate[] = [
  lunaXhighCandidate,
  referenceCandidate,
];

export function getCandidate(id: string) {
  return CANDIDATES.find((candidate) => candidate.id === id) ?? CANDIDATES[0];
}
