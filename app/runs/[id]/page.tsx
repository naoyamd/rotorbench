import { notFound } from "next/navigation";
import { RunDetail } from "../../components/run-detail";
import { SiteFooter, SiteHeader } from "../../components/site-header";
import { getFrameworkCatalog, getRun } from "../../framework-data";

export const dynamicParams = false;
export const dynamic = "force-static";
const emptyCatalogPlaceholder = "__framework-empty__";

export async function generateStaticParams() {
  const ids = getFrameworkCatalog().runs.map(({ id }) => ({ id }));
  // Next 16 cache-component validation requires one build-time param even when
  // a deliberately empty catalog has no result routes to export.
  return ids.length > 0 ? ids : [{ id: emptyCatalogPlaceholder }];
}

export default async function RunPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (id === emptyCatalogPlaceholder) {
    return <><SiteHeader /><main className="listing-page"><section className="empty-state"><h1>No runs published</h1><p>This build-validation route is removed from the public output.</p></section></main><SiteFooter /></>;
  }
  const run = getRun(id);
  if (!run) notFound();
  return <><SiteHeader /><RunDetail run={run} basePath={process.env.NEXT_PUBLIC_BASE_PATH ?? ""} /><SiteFooter /></>;
}
