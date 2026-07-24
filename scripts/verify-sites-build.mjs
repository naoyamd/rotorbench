import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { ROOT_SITES_ENVIRONMENT } from "./build-sites-root.mjs";
import { pathExists } from "./framework-lib.mjs";
import { findInheritedBasePathUrls } from "./sites-build-url-contract.mjs";

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
const inheritedBasePathUrls = findInheritedBasePathUrls(home);
assert.equal(
  inheritedBasePathUrls.length,
  0,
  `Sites internal URLs inherited a deployment base path: ${inheritedBasePathUrls
    .map(({ attribute, url }) => `${attribute}="${url}"`)
    .join(", ")}`,
);
console.log(
  "Verified root-hosted Sites build and absence of public empty-catalog placeholders.",
);
