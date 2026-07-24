import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

const exportRoot = path.resolve(process.argv[2] ?? "out");
const configuredBasePath = (process.env.PAGES_BASE_PATH ?? "").replace(/\/$/, "");

async function listHtml(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...(await listHtml(entryPath)));
    else if (entry.name.endsWith(".html")) paths.push(entryPath);
  }
  return paths;
}

function internalHref(href) {
  return href && !href.startsWith("#") && !href.startsWith("mailto:") && !href.startsWith("tel:") && !/^[a-z]+:/i.test(href);
}

async function exists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

const htmlFiles = await listHtml(exportRoot);
const failures = [];
for (const htmlPath of htmlFiles) {
  const html = await readFile(htmlPath, "utf8");
  const hrefs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((match) => match[1]);
  for (const rawHref of hrefs.filter(internalHref)) {
    const href = rawHref.split(/[?#]/, 1)[0];
    if (!href || href.startsWith("/_next/") || href.startsWith("/favicon") || href.startsWith("/file.svg") || href.startsWith("/window.svg") || href.startsWith("/globe.svg")) continue;
    let relative = href;
    if (configuredBasePath && relative === configuredBasePath) relative = "/";
    else if (configuredBasePath && relative.startsWith(`${configuredBasePath}/`)) relative = relative.slice(configuredBasePath.length);
    const destination = relative.startsWith("/")
      ? path.join(exportRoot, relative.slice(1))
      : path.resolve(path.dirname(htmlPath), relative);
    const candidates = [destination, path.join(destination, "index.html"), `${destination}.html`];
    if (!(await Promise.all(candidates.map(exists))).some(Boolean)) {
      failures.push(`${path.relative(exportRoot, htmlPath)} -> ${rawHref}`);
    }
  }
}
if (failures.length) {
  console.error(`Broken static links:\n${failures.join("\n")}`);
  process.exitCode = 1;
} else {
  console.log(`Verified static links in ${htmlFiles.length} HTML files.`);
}
