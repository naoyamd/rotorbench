import { spawn } from "node:child_process";
import { readdir } from "node:fs/promises";
import path from "node:path";

const projectRoot = process.cwd();
const testRoot = path.join(projectRoot, "tests");
const testFiles = (await readdir(testRoot, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && entry.name.endsWith(".test.mjs"))
  .map((entry) => path.join("tests", entry.name))
  .sort();

if (testFiles.length === 0) {
  throw new Error("No test files were found");
}

const cleanEnvironment = { ...process.env };
delete cleanEnvironment.NODE_OPTIONS;
delete cleanEnvironment.NODE_PATH;

const child = spawn(process.execPath, ["--test", ...testFiles], {
  cwd: projectRoot,
  env: cleanEnvironment,
  stdio: "inherit",
  windowsHide: true,
});

child.on("error", (error) => {
  throw error;
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.stderr.write(`Test process ended from signal ${signal}.\n`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
