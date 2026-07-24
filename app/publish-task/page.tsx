import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";

export const metadata: Metadata = { title: "Publishing | Engineering Design Benchmark Framework" };

export default function PublishTaskPage() {
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">STATIC PUBLISHING</p><h1>Publish a validated framework catalog</h1><p>Target repository: <a href="https://github.com/naoyamd/rotorbench">github.com/naoyamd/rotorbench</a>. This identifies the publication repository only; it does not define or modify benchmark task content.</p><p>The build validates manifests, paths, hashes, and static links; it preprocesses STEP in Node and exports a static site without a runtime API, database, or authentication layer.</p></section><section className="content-section"><h2>Build sequence</h2><ol className="plain-list"><li>Run `pnpm framework:validate` for schema, ID, path, and hash checks.</li><li>Run `pnpm framework:process-step` to create viewer meshes and failure reports.</li><li>Run `pnpm framework:index` and `pnpm check` before static export.</li></ol></section><section className="content-section"><h2>Legacy protection</h2><p>The existing RB-2.0 submission archive and its `/results/&lt;id&gt;/` URLs are preserved as read-only legacy content. It must not be mixed into framework comparison or ranking views.</p></section></main><SiteFooter /></>;
}
