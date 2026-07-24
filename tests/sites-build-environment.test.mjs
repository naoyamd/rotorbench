import assert from "node:assert/strict";
import test from "node:test";
import {
  ROOT_SITES_ENVIRONMENT,
  createRootSitesEnvironment,
  verifyRootSitesEnvironment,
} from "../scripts/build-sites-root.mjs";

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
