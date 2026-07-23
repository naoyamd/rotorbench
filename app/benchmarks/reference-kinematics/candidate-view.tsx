"use client";

import { useEffect, useRef, useState } from "react";
import type { RotorCandidateViewProps } from "../types";
import {
  bladeStates,
  degreesToRadians,
  pitchAtAzimuth,
} from "../../kinematics.mjs";

function drawReference(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: RotorCandidateViewProps,
) {
  const { inputs, rotorAzimuth, theme } = props;
  context.clearRect(0, 0, width, height);
  context.fillStyle = "#07121d";
  context.fillRect(0, 0, width, height);

  const centerX = width * 0.5;
  const centerY = height * 0.45;
  const radius = Math.min(width * 0.34, height * 0.33);
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  for (const ratio of [0.35, 0.7, 1]) {
    context.beginPath();
    context.arc(centerX, centerY, radius * ratio, 0, Math.PI * 2);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(centerX - radius - 14, centerY);
  context.lineTo(centerX + radius + 14, centerY);
  context.moveTo(centerX, centerY - radius - 14);
  context.lineTo(centerX, centerY + radius + 14);
  context.stroke();

  for (const blade of bladeStates(rotorAzimuth, inputs)) {
    const angle = degreesToRadians(blade.azimuth);
    const inner = radius * 0.22;
    const outer = radius;
    const chord = Math.max(5, 9 * Math.cos(degreesToRadians(blade.pitch)));
    const ux = Math.cos(angle);
    const uy = -Math.sin(angle);
    const vx = -uy;
    const vy = ux;
    context.beginPath();
    context.moveTo(
      centerX + ux * inner + vx * chord,
      centerY + uy * inner + vy * chord,
    );
    context.lineTo(
      centerX + ux * outer + vx * chord * 0.55,
      centerY + uy * outer + vy * chord * 0.55,
    );
    context.lineTo(
      centerX + ux * outer - vx * chord * 0.55,
      centerY + uy * outer - vy * chord * 0.55,
    );
    context.lineTo(
      centerX + ux * inner - vx * chord,
      centerY + uy * inner - vy * chord,
    );
    context.closePath();
    const normalized = Math.max(-1, Math.min(1, blade.pitch / 16));
    context.fillStyle =
      normalized >= 0
        ? `rgba(255,189,102,${0.35 + normalized * 0.5})`
        : "rgba(89,190,255,.55)";
    context.fill();
    context.strokeStyle = theme.accent;
    context.stroke();
  }

  const tiltScale = radius * 0.035;
  context.strokeStyle = "#f0f7fa";
  context.lineWidth = 2;
  context.beginPath();
  context.ellipse(
    centerX + inputs.cyclicLat * tiltScale,
    centerY - inputs.cyclicLong * tiltScale,
    radius * 0.27,
    radius * 0.12,
    degreesToRadians(rotorAzimuth),
    0,
    Math.PI * 2,
  );
  context.stroke();
  context.strokeStyle = theme.accent;
  context.beginPath();
  context.ellipse(
    centerX + inputs.cyclicLat * tiltScale,
    centerY - inputs.cyclicLong * tiltScale,
    radius * 0.24,
    radius * 0.1,
    degreesToRadians(rotorAzimuth),
    0,
    Math.PI * 2,
  );
  context.stroke();

  const graphX = 18;
  const graphY = height - 58;
  const graphWidth = width - 36;
  const graphHeight = 38;
  context.strokeStyle = theme.grid;
  context.strokeRect(graphX, graphY, graphWidth, graphHeight);
  context.strokeStyle = theme.accent;
  context.lineWidth = 2;
  context.beginPath();
  for (let index = 0; index <= 90; index += 1) {
    const psi = (index / 90) * 360;
    const pitch = pitchAtAzimuth(
      psi,
      inputs.collective,
      inputs.cyclicLat,
      inputs.cyclicLong,
    );
    const x = graphX + (index / 90) * graphWidth;
    const y = graphY + graphHeight / 2 - ((pitch - inputs.collective) / 8) * 14;
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  context.font = "600 10px ui-monospace, monospace";
  context.fillStyle = "rgba(231,242,247,.7)";
  context.fillText("TOP VIEW · ψ=0° RIGHT · CCW", 14, 20);
  context.fillText("0°", graphX, graphY - 5);
  context.fillText("360°", graphX + graphWidth - 28, graphY - 5);
}

export function ReferenceCandidateView(props: RotorCandidateViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  useEffect(() => {
    const canvas = canvasRef.current;
    const parent = canvas?.parentElement;
    if (!canvas || !parent) return;
    const observer = new ResizeObserver(([entry]) => {
      const bounds = entry.contentRect;
      setSize({ width: bounds.width, height: bounds.height });
    });
    observer.observe(parent);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.width <= 0 || size.height <= 0) return;
    const ratio = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.max(1, Math.round(size.width * ratio));
    canvas.height = Math.max(1, Math.round(size.height * ratio));
    canvas.style.width = `${size.width}px`;
    canvas.style.height = `${size.height}px`;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    drawReference(context, size.width, size.height, props);
  }, [props, size]);

  return (
    <canvas
      aria-label={`Reference Kinematicsの独立上面図。方位角${props.rotorAzimuth.toFixed(0)}度。ピッチ波形と4枚のブレード値を検算する基準表示。`}
      ref={canvasRef}
      role="img"
    />
  );
}
