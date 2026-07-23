import assert from "node:assert/strict";
import test from "node:test";

import {
  bladeStates,
  pitchAtAzimuth,
  pitchEnvelope,
} from "../app/kinematics.mjs";

const hover = {
  collective: 8,
  cyclicLat: 0,
  cyclicLong: 0,
  rpm: 240,
};

test("collective alone gives every blade the same pitch", () => {
  const blades = bladeStates(37, hover);
  assert.equal(blades.length, 4);
  assert.deepEqual(
    blades.map(({ pitch }) => pitch),
    [8, 8, 8, 8],
  );
});

test("opposite blades have equal and opposite cyclic components", () => {
  const inputs = {
    collective: 7,
    cyclicLat: 4,
    cyclicLong: -2,
    rpm: 240,
  };
  const blades = bladeStates(23, inputs);
  for (let index = 0; index < 2; index += 1) {
    const cyclicA = blades[index].pitch - inputs.collective;
    const cyclicB = blades[index + 2].pitch - inputs.collective;
    assert.ok(Math.abs(cyclicA + cyclicB) < 1e-10);
  }
});

test("the four-blade mean equals collective", () => {
  const inputs = {
    collective: 5.5,
    cyclicLat: -6,
    cyclicLong: 3.25,
    rpm: 280,
  };
  const mean =
    bladeStates(111, inputs).reduce((sum, blade) => sum + blade.pitch, 0) /
    4;
  assert.ok(Math.abs(mean - inputs.collective) < 1e-10);
});

test("the envelope and canonical pitch equation agree", () => {
  const inputs = {
    collective: 6,
    cyclicLat: 3,
    cyclicLong: 4,
    rpm: 220,
  };
  const envelope = pitchEnvelope(inputs);
  assert.equal(envelope.amplitude, 5);
  assert.equal(envelope.min, 1);
  assert.equal(envelope.max, 11);

  const peak = pitchAtAzimuth(
    envelope.phase,
    inputs.collective,
    inputs.cyclicLat,
    inputs.cyclicLong,
  );
  assert.ok(Math.abs(peak - envelope.max) < 1e-10);
});
