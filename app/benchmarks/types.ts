import type { ComponentType } from "react";
import type { RotorInputs } from "../kinematics.mjs";

export type CandidateTheme = {
  accent: string;
  accentSoft: string;
  grid: string;
  renderer: "luna" | "reference" | "custom";
};

export type CandidateModelMetadata = {
  provider: string;
  model: string;
  reasoning: string;
  runDate: string;
  promptVersion: string;
  tags: string[];
};

export type RotorCandidateViewProps = {
  inputs: Readonly<RotorInputs>;
  rotorAzimuth: number;
  paused: boolean;
  assetBasePath: string;
  theme: Readonly<CandidateTheme>;
};

export type RotorCandidate = {
  id: string;
  kind: "model" | "reference";
  name: string;
  maker: string;
  summary: string;
  version: string;
  metadata: CandidateModelMetadata;
  theme: CandidateTheme;
  View?: ComponentType<RotorCandidateViewProps>;
};
