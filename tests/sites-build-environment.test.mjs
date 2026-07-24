import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOT_SITES_ENVIRONMENT,
  createRootSitesEnvironment,
  verifyRootSitesEnvironment,
} from "../scripts/build-sites-root.mjs";
import { findInheritedBasePathUrls } from "../scripts/sites-build-url-contract.mjs";

test("Sites build environment replaces inherited review-base settings", () => {
  const parentEnvironment = {
    KEEP_ME: "preserved",
    PAGES_BASE_PATH: "/review-base",
    NEXT_PUBLIC_BASE_PATH: "/review-base",
    NEXT_PUBLIC_SITE_URL: "https://example.test/review-base",
  };

  const childEnvironment = createRootSitesEnvironment(parentEnvironment);

  assert.equal(childEnvironment.KEEP_ME, "preserved");
  assert.deepEqual(
    {
      PAGES_BASE_PATH: childEnvironment.PAGES_BASE_PATH,
      NEXT_PUBLIC_BASE_PATH: childEnvironment.NEXT_PUBLIC_BASE_PATH,
      NEXT_PUBLIC_SITE_URL: childEnvironment.NEXT_PUBLIC_SITE_URL,
    },
    ROOT_SITES_ENVIRONMENT,
  );
  assert.equal(parentEnvironment.PAGES_BASE_PATH, "/review-base");
  verifyRootSitesEnvironment(childEnvironment);
});

test("Sites root environment uses an absolute root URL", () => {
  const siteUrl = new URL(ROOT_SITES_ENVIRONMENT.NEXT_PUBLIC_SITE_URL);

  assert.equal(siteUrl.pathname, "/");
  assert.equal(siteUrl.search, "");
  assert.equal(siteUrl.hash, "");
});

test("Sites URL verification allows literal external repository and Pages links", () => {
  const html = [
    '<link rel="stylesheet" href="/assets/app.css">',
    '<a href="/benchmarks/">Benchmarks</a>',
    '<a href="https://github.com/naoyamd/rotorbench">Repository</a>',
    '<a href="https://naoyamd.github.io/rotorbench">GitHub Pages</a>',
  ].join("");
  const inheritedEnvironment = {
    PAGES_BASE_PATH: "/rotorbench",
    NEXT_PUBLIC_BASE_PATH: "/rotorbench",
    NEXT_PUBLIC_SITE_URL: "https://naoyamd.github.io/rotorbench",
  };

  assert.deepEqual(
    findInheritedBasePathUrls(html, inheritedEnvironment),
    [],
  );
});

test("Sites URL verification reports inherited prefixes on internal navigation and assets", () => {
  const html = [
    '<link data-rsc-css-href="/rotorbench/assets/app.css">',
    '<a href="/rotorbench/benchmarks/">Benchmarks</a>',
    '<script src="/rotorbench/assets/app.js"></script>',
    '<a href="https://github.com/naoyamd/rotorbench">Repository</a>',
  ].join("");
  const inheritedEnvironment = {
    PAGES_BASE_PATH: "/rotorbench/",
    NEXT_PUBLIC_BASE_PATH: "/rotorbench",
    NEXT_PUBLIC_SITE_URL: "https://naoyamd.github.io/rotorbench",
  };

  assert.deepEqual(
    findInheritedBasePathUrls(html, inheritedEnvironment),
    [
      {
        attribute: "data-rsc-css-href",
        url: "/rotorbench/assets/app.css",
        basePath: "/rotorbench",
      },
      {
        attribute: "href",
        url: "/rotorbench/benchmarks/",
        basePath: "/rotorbench",
      },
      {
        attribute: "src",
        url: "/rotorbench/assets/app.js",
        basePath: "/rotorbench",
      },
    ],
  );
});
