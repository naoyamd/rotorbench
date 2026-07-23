export type RotorInputs = {
  collective: number;
  cyclicLat: number;
  cyclicLong: number;
  rpm: number;
};

export type Preset = {
  id: string;
  label: string;
  description: string;
  inputs: RotorInputs;
};

export type BladeState = {
  index: number;
  azimuth: number;
  pitch: number;
};

export const DEFAULT_INPUTS: Readonly<RotorInputs>;
export const PRESETS: readonly Preset[];
export function degreesToRadians(degrees: number): number;
export function normalizeDegrees(degrees: number): number;
export function pitchAtAzimuth(
  azimuthDegrees: number,
  collective: number,
  cyclicLat: number,
  cyclicLong: number,
): number;
export function bladeStates(
  rotorAzimuth: number,
  inputs: RotorInputs,
  bladeCount?: number,
): BladeState[];
export function pitchEnvelope(inputs: RotorInputs): {
  min: number;
  max: number;
  amplitude: number;
  phase: number;
};
export function advanceAzimuth(
  currentDegrees: number,
  elapsedMilliseconds: number,
  rpm: number,
): number;
