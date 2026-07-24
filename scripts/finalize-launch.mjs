import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  computeFairnessFingerprint,
  manifestDigest,
  readJson,
} from "./framework-lib.mjs";

const idIndex = process.argv.indexOf("--launch-id");
const launchId = idIndex >= 0 ? process.argv[idIndex + 1] : "";
if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(launchId)) {
  throw new Error("Pass --launch-id using lowercase kebab-case");
}
const launchPath = path.join(process.cwd(), "launches", launchId, "launch.json");
const launch = await readJson(launchPath);
const packetPath = path.join(
  process.cwd(),
  "task-packets",
  launch.taskPacket.id,
  "packet.json",
);
const packet = await readJson(packetPath);
launch.taskPacket.version = packet.version;
launch.taskPacket.digest = manifestDigest(packet);
launch.fairnessFingerprint = computeFairnessFingerprint(launch);
await writeFile(launchPath, `${JSON.stringify(launch, null, 2)}\n`);
console.log(`Finalized launch ${launch.id} (${launch.fairnessFingerprint}).`);
