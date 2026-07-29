import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "../components/site-header";
import { getFrameworkCatalog } from "../framework-data";

export const metadata: Metadata = { title: "Compare | Engineering Design Benchmark Framework" };

export default function ComparePage() {
  const { runs, cohorts } = getFrameworkCatalog();
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    const current = groups.get(run.fairnessFingerprint) ?? [];
    current.push(run);
    groups.set(run.fairnessFingerprint, current);
  }
  const modelGroups = cohorts.flatMap((cohort) => {
    const disclosure = cohort.postReview?.disclosure.content;
    const aggregate = cohort.postReview?.aggregate.content;
    if (!disclosure || !aggregate) return [];
    return aggregate.modelGroups.map((group) => ({
      cohort,
      group,
      model: disclosure.modelGroups.find(({ groupId }) => groupId === group.groupId)?.model,
    }));
  });
  return <><SiteHeader /><main className="listing-page"><section className="page-intro"><p className="eyebrow">POST-REVIEW COMPARISON SURFACE</p><h1>Compare like-for-like model groups</h1><p>Only published cohorts with the same frozen fairness bindings appear here. The table reports the three-repeat Engineering Attainment Profile; it never calculates a composite, rank, or winner.</p></section>{modelGroups.length === 0 ? <section className="empty-state"><h2>0 published model groups</h2><p>No post-review cohort disclosure and aggregate have been published.</p></section> : <section className="content-section"><h2>Model-group aggregates</h2><table className="comparison"><thead><tr><th>Model group</th><th>Model disclosure</th><th>Repeats</th><th>Admission</th><th>Baseline qualification</th><th>Checkpoint distribution</th><th>D01–D10 medians</th></tr></thead><tbody>{modelGroups.map(({ cohort, group, model }) => <tr key={`${cohort.id}-${group.groupId}`}><td>{group.groupId}</td><td>{model ? `${model.provider} / ${model.name} / ${model.version}; ${model.reasoningSetting}; ${model.policy}` : "disclosure unavailable"}</td><td>{group.runCount}</td><td>{group.admission.count}/{group.runCount} ({Math.round(group.admission.rate * 100)}%)</td><td>{group.qualification.baseline.count}/{group.runCount} ({Math.round(group.qualification.baseline.rate * 100)}%)</td><td>{Object.entries(group.attainment.highestCheckpointCounts).map(([id, count]) => `${id}: ${count}`).join(", ") || "—"}</td><td>{group.dimensions.map(({ id, median }) => `${id}: ${median ?? "—"}`).join(", ")}</td></tr>)}</tbody></table></section>}{runs.length > 0 ? Array.from(groups.entries()).map(([fingerprint, group]) => <section className="content-section" key={fingerprint}><p className="eyebrow">FAIRNESS FINGERPRINT</p><h2><code>{fingerprint}</code></h2><table className="comparison"><thead><tr><th>Run</th><th>Benchmark</th><th>Version</th><th>Status</th><th>Artifacts</th></tr></thead><tbody>{group.map((run) => <tr key={run.id}><td><a href={`${basePath}/runs/${run.id}/`}>{run.id}</a></td><td>{run.benchmarkId}</td><td>{run.benchmarkVersion}</td><td>{run.status}</td><td>{run.artifacts.length}</td></tr>)}</tbody></table></section>) : null}</main><SiteFooter /></>;
}
