import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { ensureInside, readJson, sha256 } from "./framework-lib.mjs";

const idIndex = process.argv.indexOf("--packet-id");
const packetId = idIndex >= 0 ? process.argv[idIndex + 1] : "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(packetId)) {
  throw new Error("Pass --packet-id using lowercase kebab-case");
}
const packetRoot = path.join(process.cwd(), "task-packets", packetId);
const packetPath = path.join(packetRoot, "packet.json");
const packet = await readJson(packetPath);
for (const declaration of [packet.instructions, ...packet.inputs]) {
  const filePath = ensureInside(packetRoot, declaration.path);
  if (!filePath) throw new Error(`Unsafe declared path ${declaration.path}`);
  declaration.sha256 = sha256(await readFile(filePath));
}
await writeFile(packetPath, `${JSON.stringify(packet, null, 2)}\n`);
console.log(`Finalized task packet ${packet.id}@${packet.version}.`);
