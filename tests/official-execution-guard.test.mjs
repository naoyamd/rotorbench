import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const guardPath = path.join(projectRoot, "scripts", "official-execution-guard.mjs");

test("official frozen execution rejects external Node module search injection", async () => {
  await assert.rejects(
    () => execFileAsync(process.execPath, [guardPath], {
      cwd: projectRoot,
      env: {
        ...process.env,
        NODE_PATH: path.join(projectRoot, "untrusted-node-path"),
      },
      windowsHide: true,
    }),
    /Official frozen execution refuses Node preload or external module search injection/,
  );
});

test("official frozen execution accepts a clean Node environment", async () => {
  const env = { ...process.env };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  const result = await execFileAsync(process.execPath, [guardPath], {
    cwd: projectRoot,
    env,
    windowsHide: true,
  });
  assert.equal(result.stdout, "");
  assert.equal(result.stderr, "");
});
