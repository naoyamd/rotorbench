export function SiteHeader() {
  const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";
  const home = basePath || "/";
  return (
    <header className="site-header">
      <a className="wordmark" href={home} aria-label="Engineering Design Benchmark Framework home">
        <span className="wordmark-mark" aria-hidden="true">E</span>
        <span>
          <strong>ENGINEERING DESIGN</strong>
          <small>BENCHMARK FRAMEWORK</small>
        </span>
      </a>
      <nav aria-label="Primary navigation">
        <a href={`${basePath}/stage0/`}>STAGE 0</a>
        <a href={`${basePath}/benchmarks/`}>BENCHMARKS</a>
        <a href={`${basePath}/model-task/`}>STAGE 1</a>
        <a href={`${basePath}/publish-task/`}>STAGE 2</a>
        <a href={`${basePath}/format/`}>FORMAT</a>
        <a href={`${basePath}/compare/`}>COMPARE</a>
        <a href={`${basePath}/legacy/`}>LEGACY RB-2.0</a>
      </nav>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer>
      <div>
        <strong>ENGINEERING DESIGN BENCHMARK FRAMEWORK</strong>
        <span>Static, inspectable, and task-neutral.</span>
      </div>
      <p>FRAMEWORK / 1.0</p>
    </footer>
  );
}
