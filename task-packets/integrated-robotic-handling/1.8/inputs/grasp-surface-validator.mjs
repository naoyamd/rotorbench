#!/usr/bin/env node
// Benchmark-owned static geometry check. It reads only the named frozen JSON input.
import { readFile } from "node:fs/promises";
import path from "node:path";

const EPSILON = 1e-7;
const AXIS = { x: 0, y: 1, z: 2 };

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index < 0 ? "" : process.argv[index + 1];
  if (!value) throw new Error(`Missing ${name}`);
  return path.resolve(value);
}

function dot(left, right) {
  return left.reduce((sum, value, index) => sum + value * right[index], 0);
}

function magnitude(vector) {
  return Math.sqrt(dot(vector, vector));
}

function sameNumber(left, right, tolerance = EPSILON) {
  return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= tolerance;
}

function sameVector(left, right, tolerance = EPSILON) {
  return Array.isArray(left) && Array.isArray(right)
    && left.length === 3 && right.length === 3
    && left.every((value, index) => sameNumber(value, right[index], tolerance));
}

function point(origin, uAxis, u, vAxis, v) {
  return origin.map((value, index) => value + u * uAxis[index] + v * vAxis[index]);
}

function insideBox(value, primitive, tolerance = EPSILON) {
  return value.every((coordinate, index) => coordinate >= primitive.origin[index] - tolerance
    && coordinate <= primitive.origin[index] + primitive.size[index] + tolerance);
}

function insideCylinder(value, primitive, tolerance = EPSILON) {
  const axisLength = magnitude(primitive.axis ?? []);
  if (!sameNumber(axisLength, 1)) return false;
  const offset = value.map((coordinate, index) => coordinate - primitive.origin[index]);
  const axial = dot(offset, primitive.axis);
  if (axial < -tolerance || axial > primitive.length + tolerance) return false;
  const radialSquared = dot(offset, offset) - axial ** 2;
  return radialSquared <= (primitive.diameter / 2) ** 2 + tolerance;
}

function insidePrimitive(value, primitive) {
  if (primitive?.kind === "box") return insideBox(value, primitive);
  if (primitive?.kind === "cylinder") return insideCylinder(value, primitive);
  return false;
}

function occupied(workpiece, value) {
  const add = workpiece.solid?.add ?? [];
  const subtract = workpiece.solid?.subtract ?? [];
  return add.some((primitive) => insidePrimitive(value, primitive))
    && !subtract.some((primitive) => insidePrimitive(value, primitive));
}

function primitiveIndex(workpiece) {
  return new Map((workpiece.solid?.add ?? []).map((primitive) => [primitive.id, primitive]));
}

function validateSurface(workpiece, region, surface, index) {
  const prefix = `${workpiece.id}/${region.id}/surface-${index + 1}`;
  const coordinate = surface?.coordinateSystem;
  const face = surface?.solidFace;
  const primitive = primitiveIndex(workpiece).get(face?.sourcePrimitiveId);
  const issues = [];
  const fail = (detail) => issues.push(`${prefix}: ${detail}`);
  if (!coordinate || !face || primitive?.kind !== "box") {
    fail("requires coordinateSystem and a box solidFace sourcePrimitiveId");
    return issues;
  }
  const { origin, uAxis, uRange, vAxis, vRange, normal } = coordinate;
  if (![origin, uAxis, vAxis, normal].every((value) => Array.isArray(value) && value.length === 3 && value.every(Number.isFinite))
    || ![uRange, vRange].every((value) => Array.isArray(value) && value.length === 2 && value.every(Number.isFinite))) {
    fail("coordinateSystem vectors and ranges must be finite 3-vectors and ordered finite pairs");
    return issues;
  }
  if (!(uRange[0] <= uRange[1] && vRange[0] <= vRange[1])) fail("uRange and vRange must be ordered");
  if (!sameNumber(magnitude(uAxis), 1) || !sameNumber(magnitude(vAxis), 1) || !sameNumber(magnitude(normal), 1)
    || !sameNumber(dot(uAxis, vAxis), 0) || !sameNumber(dot(uAxis, normal), 0) || !sameNumber(dot(vAxis, normal), 0)) {
    fail("uAxis, vAxis, and normal must be mutually orthonormal axes");
  }
  const axis = AXIS[face.axis];
  if (axis === undefined || ![1, -1].includes(face.exteriorSign)) fail("solidFace axis and exteriorSign are invalid");
  const expectedCoordinate = face.exteriorSign < 0
    ? primitive.origin[axis]
    : primitive.origin[axis] + primitive.size[axis];
  const expectedNormal = [0, 0, 0];
  expectedNormal[axis] = face.exteriorSign;
  if (!sameNumber(face.coordinate, expectedCoordinate) || !sameVector(normal, expectedNormal)) {
    fail("solidFace coordinate or normal does not match the named exposed box face");
  }
  if (!sameVector(surface?.plane?.origin, origin) || !sameVector(surface?.plane?.normal, normal)
    || !sameVector(surface?.rectangle?.uAxis, uAxis) || !sameVector(surface?.rectangle?.vAxis, vAxis)
    || JSON.stringify(surface?.rectangle?.u) !== JSON.stringify(uRange)
    || JSON.stringify(surface?.rectangle?.v) !== JSON.stringify(vRange)) {
    fail("legacy plane/rectangle fields must exactly repeat coordinateSystem");
  }
  const samples = [
    [uRange[0], vRange[0]], [uRange[0], vRange[1]],
    [uRange[1], vRange[0]], [uRange[1], vRange[1]],
    [(uRange[0] + uRange[1]) / 2, (vRange[0] + vRange[1]) / 2],
  ];
  for (const [u, v] of samples) {
    const onFace = point(origin, uAxis, u, vAxis, v);
    if (!sameNumber(onFace[axis], expectedCoordinate) || !insideBox(onFace, primitive)) {
      fail(`P(${u}, ${v}) is not on the declared source face`);
      continue;
    }
    const outside = onFace.map((value, component) => value + normal[component] * 0.001);
    const inside = onFace.map((value, component) => value - normal[component] * 0.001);
    if (occupied(workpiece, outside)) fail(`P(${u}, ${v}) exterior probe is occupied`);
    if (!occupied(workpiece, inside)) fail(`P(${u}, ${v}) material-side probe is not occupied after CSG subtraction`);
  }
  return issues;
}

export function validateGraspSurfaces(geometry) {
  const issues = [];
  for (const workpiece of geometry?.workpieces ?? []) {
    for (const region of workpiece.graspRegions ?? []) {
      for (const [index, surface] of (region.surfaces ?? []).entries()) {
        if (surface?.coordinateSystem || surface?.solidFace) {
          issues.push(...validateSurface(workpiece, region, surface, index));
        }
      }
    }
  }
  return { status: issues.length ? "invalid" : "valid", issues };
}

async function main() {
  const geometry = JSON.parse(await readFile(argument("--geometry"), "utf8"));
  const result = validateGraspSurfaces(geometry);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exitCode = result.status === "valid" ? 0 : 1;
}

if (import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 2; });
}
