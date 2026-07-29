import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";

const require = createRequire(import.meta.url);
const MAX_INPUT_BYTES = 26_214_400;

function argument(name) {
  const index = process.argv.indexOf(name);
  const value = index >= 0 ? process.argv[index + 1] : "";
  if (!value) throw new Error(`Missing required argument ${name}`);
  return value;
}

function numericArray(value) {
  const array = Array.from(value ?? []);
  if (array.some((entry) => typeof entry !== "number" || !Number.isFinite(entry))) {
    throw new Error("mesh contains non-finite geometry values");
  }
  return array.map((entry) => Number(entry.toFixed(8)));
}

function normalizeMesh(result, sourceArtifactId) {
  if (!result?.success || !Array.isArray(result.meshes)) {
    throw new Error("OpenCascade could not read a triangulated STEP model");
  }
  const meshes = result.meshes.map((mesh, index) => ({
    id: `mesh-${index + 1}`,
    name: typeof mesh.name === "string" ? mesh.name : `Mesh ${index + 1}`,
    color: Array.isArray(mesh.color)
      ? mesh.color.slice(0, 3).map((value) => Number(value))
      : null,
    positions: numericArray(mesh.attributes?.position?.array),
    normals: mesh.attributes?.normal?.array
      ? numericArray(mesh.attributes.normal.array)
      : null,
    indices: numericArray(mesh.index?.array),
  }));
  const triangleCount = meshes.reduce(
    (count, mesh) => count + Math.floor(mesh.indices.length / 3),
    0,
  );
  if (meshes.length === 0 || triangleCount === 0) {
    throw new Error("STEP contained no displayable triangles");
  }
  return {
    schemaVersion: "1.0",
    sourceArtifactId,
    meshes,
    triangleCount,
  };
}

const input = argument("--input");
const output = argument("--output");
const artifactId = argument("--artifact-id");
const bytes = await readFile(input);
if (bytes.length > MAX_INPUT_BYTES) {
  throw new Error(`STEP exceeds isolated worker limit of ${MAX_INPUT_BYTES} bytes`);
}

const factory = require("occt-import-js");
const occt = await factory();
const imported = occt.ReadStepFile(new Uint8Array(bytes), {
  linearUnit: "millimeter",
  linearDeflectionType: "bounding_box_ratio",
  linearDeflection: 0.001,
  angularDeflection: 0.5,
});
const mesh = normalizeMesh(imported, artifactId);
await writeFile(output, `${JSON.stringify(mesh)}\n`, { flag: "wx" });
