"use client";

import { useEffect, useRef, useState } from "react";
import type { RotorCandidateViewProps } from "../types";
import { bladeStates, degreesToRadians } from "../../kinematics.mjs";

type Point3 = [number, number, number];
type Point2 = [number, number];

function project(
  [x, y, z]: Point3,
  width: number,
  height: number,
): Point2 {
  const scale = Math.min(width / 330, height / 250);
  return [width / 2 + x * scale, height * 0.46 + y * 0.42 * scale - z * scale];
}

function line(
  context: CanvasRenderingContext2D,
  start: Point3,
  end: Point3,
  width: number,
  height: number,
) {
  const [x1, y1] = project(start, width, height);
  const [x2, y2] = project(end, width, height);
  context.beginPath();
  context.moveTo(x1, y1);
  context.lineTo(x2, y2);
  context.stroke();
}

function ring(
  context: CanvasRenderingContext2D,
  radius: number,
  zAt: (x: number, y: number) => number,
  width: number,
  height: number,
) {
  context.beginPath();
  for (let index = 0; index <= 64; index += 1) {
    const angle = (index / 64) * Math.PI * 2;
    const x = Math.cos(angle) * radius;
    const y = Math.sin(angle) * radius;
    const [screenX, screenY] = project([x, y, zAt(x, y)], width, height);
    if (index === 0) context.moveTo(screenX, screenY);
    else context.lineTo(screenX, screenY);
  }
  context.stroke();
}

function drawLuna(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  props: RotorCandidateViewProps,
) {
  const { inputs, rotorAzimuth, theme } = props;
  context.clearRect(0, 0, width, height);
  const gradient = context.createRadialGradient(
    width / 2,
    height * 0.45,
    10,
    width / 2,
    height * 0.45,
    Math.max(width, height) * 0.65,
  );
  gradient.addColorStop(0, "#102c38");
  gradient.addColorStop(1, "#06101a");
  context.fillStyle = gradient;
  context.fillRect(0, 0, width, height);

  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  for (const radius of [45, 85, 125]) {
    ring(context, radius, () => 0, width, height);
  }
  for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
    line(
      context,
      [0, 0, 0],
      [Math.cos(angle) * 138, Math.sin(angle) * 138, 0],
      width,
      height,
    );
  }

  const baseHeight = -5 + (inputs.collective - 7) * 0.7;
  const lowerPlane = (x: number, y: number) =>
    baseHeight + 0.035 * (inputs.cyclicLat * x + inputs.cyclicLong * y);
  const upperPlane = (x: number, y: number) => lowerPlane(x, y) + 4;

  context.lineCap = "round";
  context.strokeStyle = "rgba(215,235,244,.48)";
  context.lineWidth = 5;
  line(context, [0, 0, -42], [0, 0, 45], width, height);

  // Both swashplate races share the same plane normal and stay parallel.
  context.strokeStyle = "rgba(190,220,232,.72)";
  context.lineWidth = 5;
  ring(context, 40, lowerPlane, width, height);
  context.strokeStyle = theme.accent;
  context.lineWidth = 4;
  ring(context, 40, upperPlane, width, height);

  context.lineWidth = 2;
  for (const angle of [0, (Math.PI * 2) / 3, (Math.PI * 4) / 3]) {
    const x = Math.cos(angle) * 34;
    const y = Math.sin(angle) * 34;
    context.strokeStyle = "#ffba62";
    line(context, [x, y, -34], [x, y, lowerPlane(x, y)], width, height);
  }

  const rotorZ = 45;
  const blades = bladeStates(rotorAzimuth, inputs);
  for (const blade of blades) {
    const angle = degreesToRadians(blade.azimuth);
    const ux = Math.cos(angle);
    const uy = Math.sin(angle);
    const vx = -uy;
    const vy = ux;
    const pitch = degreesToRadians(blade.pitch);

    const rootX = ux * 43;
    const rootY = uy * 43;
    const hornX = rootX + vx * 10 * Math.cos(pitch);
    const hornY = rootY + vy * 10 * Math.cos(pitch);
    const hornZ = rotorZ + 10 * Math.sin(pitch);
    const plateZ = upperPlane(rootX, rootY);
    const linkLength = 40;
    const vertical = hornZ - plateZ;
    const horizontal = Math.sqrt(
      Math.max(0, linkLength * linkLength - vertical * vertical),
    );
    const plateX = hornX - ux * horizontal;
    const plateY = hornY - uy * horizontal;

    context.strokeStyle = "#f1f7fb";
    context.lineWidth = 2.5;
    line(
      context,
      [plateX, plateY, plateZ],
      [hornX, hornY, hornZ],
      width,
      height,
    );
    context.strokeStyle = "#ffba62";
    context.lineWidth = 3;
    line(
      context,
      [rootX, rootY, rotorZ],
      [hornX, hornY, hornZ],
      width,
      height,
    );

    const inner = 45;
    const outer = 137;
    const chord = 9;
    const points: Point3[] = [
      [
        ux * inner + vx * chord * Math.cos(pitch),
        uy * inner + vy * chord * Math.cos(pitch),
        rotorZ + chord * Math.sin(pitch),
      ],
      [
        ux * outer + vx * chord * 0.58 * Math.cos(pitch),
        uy * outer + vy * chord * 0.58 * Math.cos(pitch),
        rotorZ + chord * 0.58 * Math.sin(pitch),
      ],
      [
        ux * outer - vx * chord * 0.58 * Math.cos(pitch),
        uy * outer - vy * chord * 0.58 * Math.cos(pitch),
        rotorZ - chord * 0.58 * Math.sin(pitch),
      ],
      [
        ux * inner - vx * chord * Math.cos(pitch),
        uy * inner - vy * chord * Math.cos(pitch),
        rotorZ - chord * Math.sin(pitch),
      ],
    ];
    context.beginPath();
    points.forEach((point, index) => {
      const [screenX, screenY] = project(point, width, height);
      if (index === 0) context.moveTo(screenX, screenY);
      else context.lineTo(screenX, screenY);
    });
    context.closePath();
    context.fillStyle = "rgba(42,82,102,.9)";
    context.fill();
    context.strokeStyle = theme.accent;
    context.lineWidth = 1.5;
    context.stroke();
  }

  const [hubX, hubY] = project([0, 0, rotorZ], width, height);
  context.fillStyle = "#d9edf4";
  context.beginPath();
  context.arc(hubX, hubY, 7, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = theme.accent;
  context.font = "600 10px ui-monospace, monospace";
  context.fillText("ROTATING RACE", 14, 22);
  context.fillStyle = "rgba(232,244,248,.72)";
  context.fillText("FIXED-LENGTH LINKS · PARALLEL RACES", 14, 39);
}

export function LunaCandidateView(props: RotorCandidateViewProps) {
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
    drawLuna(context, size.width, size.height, props);
  }, [props, size]);

  return (
    <canvas
      aria-label={`Luna xhighの独立疑似3D実装。方位角${props.rotorAzimuth.toFixed(0)}度。上下スワッシュプレートは平行に傾斜し、固定長ピッチリンクでブレードホーンへ接続。`}
      ref={canvasRef}
      role="img"
    />
  );
}
