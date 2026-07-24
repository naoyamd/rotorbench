const defaultSiteUrl = "https://rotorbench-lab.naoyamd.chatgpt.site";

function normalizedBasePath() {
  const value = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  if (!value || value === "/") return "";
  return `/${value.replace(/^\/+|\/+$/g, "")}`;
}

export function sitePath(relativePath: string) {
  const clean = relativePath.replace(/^\/+/, "");
  return `${normalizedBasePath()}/${clean}`.replace(/\/{2,}/g, "/");
}

export function absoluteSiteUrl(relativePath: string) {
  const site = new URL(process.env.NEXT_PUBLIC_SITE_URL ?? defaultSiteUrl);
  const basePath = normalizedBasePath();
  const sitePathname = site.pathname.replace(/\/+$/, "");
  const prefix = basePath && sitePathname.endsWith(basePath)
    ? sitePathname
    : `${sitePathname}${basePath}`;
  site.pathname = `${prefix}/${relativePath.replace(/^\/+/, "")}`.replace(
    /\/{2,}/g,
    "/",
  );
  site.search = "";
  site.hash = "";
  return site.toString();
}
