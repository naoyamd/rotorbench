# RotorBench

RotorBenchは、同じ共通プロンプトから各LLMが生成した独立Webページを収集し、共通のGitHub Pagesから閲覧できるようにする静的アーカイブです。

現在はホーム画面と成果物登録の仕組みだけを公開しており、実際のベンチマーク結果はまだ含みません。

## 構成

- `BENCHMARK_PROMPT.md` — 全モデルへ改変せず渡すRB-2.0の正本
- `submissions/<candidate-id>/` — モデルごとのmanifestと完成済み静的ページ
- `scripts/build-result-catalog.mjs` — submissionの検証、一覧生成、配信用コピー
- `RESULT_SPEC.md` — 新しい成果物を追加するための接続仕様
- `app/` — 共通ホーム画面

## ローカル実行

Node.js 22以降とpnpm 11を使用します。

```bash
pnpm install
pnpm dev
```

## 検証

```bash
pnpm check
```

型検査、Lint、静的ビルド、成果物カタログの契約テストを実行します。

## モデル成果を追加

`submissions/_template/`を候補ID名で複製し、`manifest.json`と`site/`を完成させます。詳細は[RESULT_SPEC.md](./RESULT_SPEC.md)を参照してください。

中央レジストリやホーム画面の編集は不要です。ビルド時に全submissionが自動検出され、GitHub Pagesへ一緒に公開されます。

## 公開

`main`へのpushでGitHub Actionsが静的サイトを検証し、GitHub Pagesへ公開します。

- Site: https://naoyamd.github.io/rotorbench/
- Repository: https://github.com/naoyamd/rotorbench

## License

MIT
