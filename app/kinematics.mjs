export const DEFAULT_INPUTS = Object.freeze({
  collective: 8,
  cyclicLat: 0,
  cyclicLong: 0,
  rpm: 240,
});

export const PRESETS = Object.freeze([
  {
    id: "hover",
    label: "ホバリング",
    description: "全ブレードを同じピッチに保つ",
    inputs: { collective: 8, cyclicLat: 0, cyclicLong: 0, rpm: 240 },
  },
  {
    id: "climb",
    label: "上昇",
    description: "コレクティブを増加",
    inputs: { collective: 13, cyclicLat: 0, cyclicLong: 0, rpm: 280 },
  },
  {
    id: "roll-right",
    label: "右ロール",
    description: "横サイクリックを付与",
    inputs: { collective: 8, cyclicLat: 5, cyclicLong: 0, rpm: 240 },
  },
  {
    id: "nose-down",
    label: "前進",
    description: "縦サイクリックを付与",
    inputs: { collective: 8, cyclicLat: 0, cyclicLong: -5, rpm: 260 },
  },
  {
    id: "crosswind",
    label: "複合入力",
    description: "縦・横を同時入力",
    inputs: { collective: 10, cyclicLat: -3.5, cyclicLong: 4.5, rpm: 250 },
  },
]);

export function degreesToRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

export function normalizeDegrees(degrees) {
  return ((degrees % 360) + 360) % 360;
}

/**
 * Blade pitch schedule:
 * θ(ψ) = θ0 + θlat cos(ψ) + θlong sin(ψ)
 */
export function pitchAtAzimuth(
  azimuthDegrees,
  collective,
  cyclicLat,
  cyclicLong,
) {
  const psi = degreesToRadians(azimuthDegrees);
  return collective + cyclicLat * Math.cos(psi) + cyclicLong * Math.sin(psi);
}

export function bladeStates(rotorAzimuth, inputs, bladeCount = 4) {
  return Array.from({ length: bladeCount }, (_, index) => {
    const azimuth = normalizeDegrees(rotorAzimuth + index * (360 / bladeCount));
    return {
      index,
      azimuth,
      pitch: pitchAtAzimuth(
        azimuth,
        inputs.collective,
        inputs.cyclicLat,
        inputs.cyclicLong,
      ),
    };
  });
}

export function pitchEnvelope(inputs) {
  const amplitude = Math.hypot(inputs.cyclicLat, inputs.cyclicLong);
  return {
    min: inputs.collective - amplitude,
    max: inputs.collective + amplitude,
    amplitude,
    phase: normalizeDegrees(
      (Math.atan2(inputs.cyclicLong, inputs.cyclicLat) * 180) / Math.PI,
    ),
  };
}

export function advanceAzimuth(currentDegrees, elapsedMilliseconds, rpm) {
  return normalizeDegrees(currentDegrees + elapsedMilliseconds * rpm * 0.006);
}
