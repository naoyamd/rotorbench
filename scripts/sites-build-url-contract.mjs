function deploymentBasePaths(environment) {
  return [
    environment.PAGES_BASE_PATH,
    environment.NEXT_PUBLIC_BASE_PATH,
  ]
    .filter((value) => typeof value === "string" && value.trim())
    .map((value) => {
      const pathOnly = value.trim().split(/[?#]/, 1)[0];
      const withLeadingSlash = pathOnly.startsWith("/") ? pathOnly : `/${pathOnly}`;
      return withLeadingSlash.replace(/\/+$/, "");
    })
    .filter((value, index, values) =>
      value !== "" && value !== "/" && values.indexOf(value) === index,
    );
}

export function findInheritedBasePathUrls(html, environment = process.env) {
  const basePaths = deploymentBasePaths(environment);
  if (basePaths.length === 0) return [];

  const references = [];
  const attributePattern =
    /\b(href|src|data-rsc-css-href)\s*=\s*(["'])([^"'<>]*)\2/gi;
  for (const match of html.matchAll(attributePattern)) {
    const url = match[3];
    if (!url.startsWith("/") || url.startsWith("//")) continue;
    const pathname = url.split(/[?#]/, 1)[0];
    const basePath = basePaths.find(
      (candidate) =>
        pathname === candidate || pathname.startsWith(`${candidate}/`),
    );
    if (basePath) {
      references.push({
        attribute: match[1].toLowerCase(),
        url,
        basePath,
      });
    }
  }
  return references;
}
