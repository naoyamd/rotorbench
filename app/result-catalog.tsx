"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";

export type ResultEntry = {
  schemaVersion: 1;
  id: string;
  title: string;
  provider: string;
  model: string;
  reasoning: string;
  runDate: string;
  promptVersion: string;
  summary: string;
  tags: string[];
  cover: string | null;
};

type CatalogPayload = {
  schemaVersion: 1;
  results: ResultEntry[];
};

type CatalogState =
  | { status: "loading"; results: ResultEntry[] }
  | { status: "ready"; results: ResultEntry[] }
  | { status: "error"; results: ResultEntry[] };

function joinPublicPath(basePath: string, path: string) {
  return `${basePath}/${path}`.replace(/\/+/g, "/");
}

export function ResultCatalog({
  basePath,
  initialResults,
}: {
  basePath: string;
  initialResults: ResultEntry[];
}) {
  const [catalog, setCatalog] = useState<CatalogState>({
    status: "ready",
    results: initialResults,
  });
  const [query, setQuery] = useState("");

  useEffect(() => {
    const controller = new AbortController();

    fetch(joinPublicPath(basePath, "results/catalog.json"), {
      cache: "no-store",
      signal: controller.signal,
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("catalog request failed");
        }
        return response.json() as Promise<CatalogPayload>;
      })
      .then((payload) => {
        setCatalog({
          status: "ready",
          results: Array.isArray(payload.results) ? payload.results : [],
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") {
          return;
        }
        setCatalog({ status: "error", results: [] });
      });

    return () => controller.abort();
  }, [basePath]);

  const visibleResults = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("ja");
    if (!normalized) {
      return catalog.results;
    }
    return catalog.results.filter((result) =>
      [
        result.title,
        result.provider,
        result.model,
        result.summary,
        result.tags.join(" "),
      ]
        .join(" ")
        .toLocaleLowerCase("ja")
        .includes(normalized),
    );
  }, [catalog.results, query]);

  return (
    <section className="results-section" id="results" aria-labelledby="results-title">
      <div className="section-head">
        <div>
          <p className="section-index">01 / MODEL OUTPUTS</p>
          <h2 id="results-title">生成結果</h2>
          <p>同じ課題に対して各モデルが制作した、独立したWebページを並べます。</p>
        </div>
        <div className="result-tools">
          <span className="result-count" aria-live="polite">
            {catalog.status === "loading" ? "—" : catalog.results.length}
            <small> RESULTS</small>
          </span>
          {catalog.results.length > 0 ? (
            <label className="search-field">
              <span className="visually-hidden">結果を検索</span>
              <input
                type="search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="MODEL / PROVIDER / TAG"
              />
            </label>
          ) : null}
        </div>
      </div>

      {catalog.status === "loading" ? (
        <div className="catalog-message" aria-live="polite">
          <span className="message-number">00</span>
          <div>
            <strong>カタログを読み込んでいます</strong>
            <p>登録済みの成果物を確認しています。</p>
          </div>
        </div>
      ) : null}

      {catalog.status === "error" ? (
        <div className="catalog-message error-message" role="alert">
          <span className="message-number">!</span>
          <div>
            <strong>カタログを読み込めませんでした</strong>
            <p>ページを再読み込みしてください。</p>
          </div>
        </div>
      ) : null}

      {catalog.status === "ready" && catalog.results.length === 0 ? (
        <div className="empty-state">
          <div className="empty-rotor" aria-hidden="true">
            <span />
          </div>
          <p className="empty-label">ARCHIVE READY / 0 ENTRIES</p>
          <h3>ベンチマーク結果は、まだありません。</h3>
          <p>
            共通サイトと登録機構だけを先に公開しています。
            最初のモデル成果が追加されると、ここに自動的にカードが生成されます。
          </p>
        </div>
      ) : null}

      {catalog.status === "ready" && catalog.results.length > 0 ? (
        <>
          <div className="result-grid">
            {visibleResults.map((result, index) => {
              const resultUrl = joinPublicPath(basePath, `results/${result.id}/`);
              const coverUrl = result.cover
                ? joinPublicPath(basePath, `results/${result.id}/${result.cover}`)
                : null;

              return (
                <article
                  className="result-card"
                  key={result.id}
                  style={{ "--card-index": index + 1 } as CSSProperties}
                >
                  <a className="result-cover" href={resultUrl}>
                    {coverUrl ? (
                      <span
                        className="cover-image"
                        style={{ backgroundImage: `url("${coverUrl}")` }}
                        role="img"
                        aria-label={`${result.title}のプレビュー`}
                      />
                    ) : (
                      <span className="cover-fallback" aria-hidden="true">
                        <i />
                      </span>
                    )}
                    <span className="open-label">OPEN RESULT ↗</span>
                  </a>
                  <div className="result-body">
                    <div className="result-meta">
                      <span>{result.provider}</span>
                      <span>{result.runDate}</span>
                    </div>
                    <h3>
                      <a href={resultUrl}>{result.title}</a>
                    </h3>
                    <p>{result.summary}</p>
                    <dl>
                      <div>
                        <dt>MODEL</dt>
                        <dd>{result.model}</dd>
                      </div>
                      <div>
                        <dt>REASONING</dt>
                        <dd>{result.reasoning}</dd>
                      </div>
                      <div>
                        <dt>PROMPT</dt>
                        <dd>{result.promptVersion}</dd>
                      </div>
                    </dl>
                    {result.tags.length > 0 ? (
                      <div className="tag-row" aria-label="タグ">
                        {result.tags.map((tag) => (
                          <span key={tag}>{tag}</span>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
          </div>
          {visibleResults.length === 0 ? (
            <p className="no-match">「{query}」に一致する結果はありません。</p>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
