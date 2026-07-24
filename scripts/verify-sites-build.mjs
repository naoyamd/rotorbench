import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_SITES_ENVIRONMENT } from "./build-sites-root.mjs";
import { pathExists } from "./framework-lib.mjs";

const projectRoot = process.cwd();
for (const relativePath of [
  "dist/client/runs/__framework-empty__",
  "dist/client/runs/__framework-empty__.rsc",
  "dist/client/benchmarks/__framework-empty__",
  "dist/client/benchmarks/__framework-empty__.rsc",
]) {
  assert.equal(await pathExists(path.join(projectRoot, relativePath)), false, relativePath);
}
const manifest = JSON.parse(
  await readFile(path.join(projectRoot, "dist", "server", "vinext-prerender.json"), "utf8"),
);
assert.equal(
  manifest.routes.some((entry) => entry.path?.includes("__framework-empty__")),
  false,
);
assert.equal(await pathExists(path.join(projectRoot, "dist", ".openai", "hosting.json")), true);
const home = await readFile(path.join(projectRoot, "dist", "client", "index.html"), "utf8");
assert.match(home, /href="\/benchmarks\/"/);
assert.equal(
  home.includes(`${ROOT_SITES_ENVIRONMENT.NEXT_PUBLIC_SITE_URL}/favicon.svg`),
  true,
  "Sites output does not use the configured root site URL",
);
for (const inheritedValue of [
  process.env.PAGES_BASE_PATH,
  process.env.NEXT_PUBLIC_BASE_PATH,
  process.env.NEXT_PUBLIC_SITE_URL,
]) {
  if (inheritedValue && !Object.values(ROOT_SITES_ENVIRONMENT).includes(inheritedValue)) {
    assert.equal(
      home.includes(inheritedValue),
      false,
      `Sites output inherited ${inheritedValue}`,
    );
  }
}
console.log(
  "Verified root-hosted Sites build and absence of public empty-catalog placeholders.",
);
