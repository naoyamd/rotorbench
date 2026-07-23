"use client";

import { useEffect, useRef } from "react";
import type { RotorCandidateViewProps } from "../types";
import { bladeStates } from "../../kinematics.mjs";

/**
 * 最小の接続例です。ここを各モデルが自由に実装します。
 * 時刻や入力を内部に持たず、props の値だけで描画してください。
 */
export function CandidateView({
  inputs,
  rotorAzimuth,
  theme,
}: RotorCandidateViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    const bounds = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(bounds.width * ratio));
    canvas.height = Math.max(1, Math.round(bounds.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(0, 0, bounds.width, bounds.height);
    context.fillStyle = "#08131d";
    context.fillRect(0, 0, bounds.width, bounds.height);

    const centerX = bounds.width / 2;
    const centerY = bounds.height / 2;
    const radius = Math.min(bounds.width, bounds.height) * 0.34;
    for (const blade of bladeStates(rotorAzimuth, inputs)) {
      const angle = (blade.azimuth * Math.PI) / 180;
      context.strokeStyle = theme.accent;
      context.lineWidth = 5;
      context.beginPath();
      context.moveTo(centerX, centerY);
      context.lineTo(
        centerX + Math.cos(angle) * radius,
        centerY + Math.sin(angle) * radius,
      );
      context.stroke();
    }
  }, [inputs, rotorAzimuth, theme]);

  return (
    <canvas
      aria-label="候補テンプレートのローター表示"
      ref={canvasRef}
      role="img"
    />
  );
}
