import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const MAX_INPUT_BYTES = 26_214_400;
// Keep the imported mesh bounded before it is copied into JSON for the parent
// process. These limits are duplicated by the parent as a defense in depth
// check on untrusted worker output.
const MAX_PARTS = 256;
const MAX_VERTICES = 100_000;
const MAX_TRIANGLES = 200_000;
const MAX_OUTPUT_BYTES = 12_582_912;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function finiteNumbers(value, label, maximumLength) {
  if (!Number.isSafeInteger(value?.length) || value.length === 0 || value.length > maximumLength) {
    throw new Error(`OpenCascade returned too many or invalid ${label}`);
  }
  const values = Array.from(value ?? []);
  if (values.length === 0 || values.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error(`OpenCascade returned invalid ${label}`);
  }
  return values.map((entry) => Number(entry.toFixed(8)));
}

function boundsFor(positions) {
  const bounds = {
    min: { x: Infinity, y: Infinity, z: Infinity },
    max: { x: -Infinity, y: -Infinity, z: -Infinity },
  };
  for (let index = 0; index < positions.length; index += 3) {
    const [x, y, z] = positions.slice(index, index + 3);
    bounds.min.x = Math.min(bounds.min.x, x);
    bounds.min.y = Math.min(bounds.min.y, y);
    bounds.min.z = Math.min(bounds.min.z, z);
    bounds.max.x = Math.max(bounds.max.x, x);
    bounds.max.y = Math.max(bounds.max.y, y);
    bounds.max.z = Math.max(bounds.max.z, z);
  }
  if (![...Object.values(bounds.min), ...Object.values(bounds.max)].every(Number.isFinite)) {
    throw new Error("OpenCascade returned an empty bounding box");
  }
  return bounds;
}

export function normalize(result) {
  if (!result?.success || !Array.isArray(result.meshes)) {
    throw new Error("OpenCascade could not import the STEP model");
  }
  if (result.meshes.length === 0 || result.meshes.length > MAX_PARTS) {
    throw new Error(`STEP exceeds isolated worker part limit of ${MAX_PARTS}`);
  }
  let vertexCount = 0;
  let triangleCount = 0;
  const parts = result.meshes.map((mesh, index) => {
    const rawPositions = mesh.attributes?.position?.array;
    const rawIndices = mesh.index?.array;
    if (!Number.isSafeInteger(rawPositions?.length) || rawPositions.length < 3 || rawPositions.length % 3 !== 0) {
      throw new Error("OpenCascade returned invalid mesh coordinate dimensions");
    }
    const partVertexCount = rawPositions.length / 3;
    if (vertexCount + partVertexCount > MAX_VERTICES) {
      throw new Error(`STEP exceeds isolated worker vertex limit of ${MAX_VERTICES}`);
    }
    if (!Number.isSafeInteger(rawIndices?.length) || rawIndices.length < 3 || rawIndices.length % 3 !== 0) {
      throw new Error("OpenCascade returned invalid mesh index dimensions");
    }
    const partTriangleCount = rawIndices.length / 3;
    if (triangleCount + partTriangleCount > MAX_TRIANGLES) {
      throw new Error(`STEP exceeds isolated worker triangle limit of ${MAX_TRIANGLES}`);
    }
    const positions = finiteNumbers(rawPositions, "mesh coordinates", MAX_VERTICES * 3);
    const indices = finiteNumbers(rawIndices, "mesh indices", MAX_TRIANGLES * 3);
    if (indices.length < 3 || indices.length % 3 !== 0) {
      throw new Error("OpenCascade returned invalid mesh indices");
    }
    if (indices.some((entry) => !Number.isInteger(entry) || entry < 0 || entry >= positions.length / 3)) {
      throw new Error("OpenCascade returned out-of-range mesh indices");
    }
    vertexCount += partVertexCount;
    triangleCount += partTriangleCount;
    return {
      id: `part-${String(index + 1).padStart(4, "0")}`,
      positions,
      indices,
      triangleCount: partTriangleCount,
      bounds: boundsFor(positions),
    };
  });
  if (triangleCount === 0) {
    throw new Error("STEP contained no displayable triangles");
  }
  const allPositions = parts.flatMap(({ positions }) => positions);
  return {
    schemaVersion: "1.0",
    geometry: {
      partCount: parts.length,
      triangleCount,
      bounds: boundsFor(allPositions),
      parts,
    },
  };
}

export function serializeNormalized(result, { inputSha256 = null } = {}) {
  if (inputSha256 !== null && !/^[a-f0-9]{64}$/.test(inputSha256)) {
    throw new Error("STEP worker received an invalid expected input SHA-256");
  }
  const serialized = `${JSON.stringify({ ...normalize(result), ...(inputSha256 ? { inputSha256 } : {}) })}\n`;
  if (Buffer.byteLength(serialized, "utf8") > MAX_OUTPUT_BYTES) {
    throw new Error(`STEP worker output exceeds limit of ${MAX_OUTPUT_BYTES} bytes`);
  }
  return serialized;
}

async function main() {
  const input = argument("--input");
  const output = argument("--output");
  const expectedSha256 = argument("--expected-sha256");
  if (!/^[a-f0-9]{64}$/.test(expectedSha256)) {
    throw new Error("STEP worker requires a SHA-256 expected input digest");
  }
  const bytes = await readFile(input);
  if (bytes.length > MAX_INPUT_BYTES) {
    throw new Error(`STEP exceeds isolated worker limit of ${MAX_INPUT_BYTES} bytes`);
  }
  if (sha256(bytes) !== expectedSha256) {
    throw new Error("STEP worker input bytes do not match the evaluator-owned expected SHA-256");
  }
  const factory = require("occt-import-js");
  const occt = await factory();
  const imported = occt.ReadStepFile(new Uint8Array(bytes), {
    linearUnit: "millimeter",
    linearDeflectionType: "bounding_box_ratio",
    linearDeflection: 0.001,
    angularDeflection: 0.5,
  });
  await writeFile(output, serializeNormalized(imported, { inputSha256: expectedSha256 }), { flag: "wx" });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main();
}
