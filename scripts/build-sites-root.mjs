import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT_SITES_ENVIRONMENT = Object.freeze({
  PAGES_BASE_PATH: "",
  NEXT_PUBLIC_BASE_PATH: "",
  NEXT_PUBLIC_SITE_URL: "https://rotorbench-lab.naoyamd.chatgpt.site",
});

export function createRootSitesEnvironment(parentEnvironment = process.env) {
  return {
    ...parentEnvironment,
    ...ROOT_SITES_ENVIRONMENT,
  };
}

export function verifyRootSitesEnvironment(environment) {
  assert.equal(environment.PAGES_BASE_PATH, "");
  assert.equal(environment.NEXT_PUBLIC_BASE_PATH, "");
  assert.equal(
    environment.NEXT_PUBLIC_SITE_URL,
    ROOT_SITES_ENVIRONMENT.NEXT_PUBLIC_SITE_URL,
  );
}

function runVinextBuild(projectRoot, environment) {
  const vinextCli = path.join(
    projectRoot,
    "node_modules",
    "vinext",
    "dist",
    "cli.js",
  );

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [vinextCli, "build"], {
      cwd: projectRoot,
      env: environment,
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(
        new Error(
          `vinext build failed (${signal ? `signal ${signal}` : `exit ${code}`})`,
        ),
      );
    });
  });
}

export async function buildSitesAtRoot({
  projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  parentEnvironment = process.env,
} = {}) {
  const environment = createRootSitesEnvironment(parentEnvironment);
  verifyRootSitesEnvironment(environment);
  await runVinextBuild(projectRoot, environment);
}

const entrypoint = process.argv[1]
  ? pathToFileURL(path.resolve(process.argv[1])).href
  : null;

if (entrypoint === import.meta.url) {
  await buildSitesAtRoot();
  console.log(
    `Built Sites at the host root (${ROOT_SITES_ENVIRONMENT.NEXT_PUBLIC_SITE_URL}).`,
  );
}
