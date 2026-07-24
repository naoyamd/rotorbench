import path from "node:path";
import { issueText, validateFrozenPacket } from "./stage0-lib.mjs";

const idIndex = process.argv.indexOf("--packet-id");
const versionIndex = process.argv.indexOf("--version");
const packetId = idIndex >= 0 ? process.argv[idIndex + 1] : "";
const version = versionIndex >= 0 ? process.argv[versionIndex + 1] : "";
if (!packetId || !version) {
  throw new Error(
    "Legacy finalize is check-only. Pass --packet-id and --version, or use `pnpm stage0 -- freeze-packet` to create a new immutable packet version.",
  );
}
const result = await validateFrozenPacket(
  path.join(process.cwd(), "task-packets", packetId, version),
);
if (result.status !== "valid") {
  throw new Error(`Frozen packet check failed:\n${issueText(result.issues)}`);
}
console.log(`Packet ${packetId}@${version} is already frozen and valid; no files changed.`);
