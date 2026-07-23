# RotorBench

RotorBenchは、異なるLLMが実装したヘリコプター・メインローターの可変ピッチ機構を、同じ入力条件で単体表示またはA/B比較する静的Webベンチマークです。

## 主な機能

- コレクティブ、横・縦サイクリック、回転数を全候補へ同期
- 4枚ローター、傾斜するスワッシュプレート、ピッチリンク、ブレード角の疑似3D表示
- `θ(ψ) = θ0 + θlat cos(ψ) + θlong sin(ψ)` を描画・数値・グラフの共通ソースとして使用
- フライト・プリセット、一時停止、再生、1ステップ
- 任意候補の単体表示、任意2候補の左右比較
- provider / model / reasoning / runDate / promptVersion / tags を持つ候補カタログ
- URLクエリによる比較状態の共有
- 6軸・100点換算評価、メモの端末内自動保存、JSON入出力
- GitHub PagesとOpenAI Sitesのどちらでも配布できる静的クライアント構成

## ローカル実行

必要環境はNode.js `>=22.13.0` です。

```bash
pnpm install
pnpm dev
```

表示されたローカルURLをブラウザで開きます。

## 検証

```bash
pnpm check
```

型チェック、vinext本番ビルド、運動学と静的HTMLのテストを実行します。

GitHub Pages向け成果物だけを作る場合:

```bash
pnpm export:pages
```

成果物は `out/` に生成されます。

## GitHub Pagesで公開

1. GitHubへリポジトリをpushします。
2. Settings → Pages → Build and deployment のSourceを「GitHub Actions」にします。
3. `main` ブランチへpushするか、Actionsから `Deploy RotorBench to GitHub Pages` を実行します。
4. Workflowが `out/` をPagesへ公開します。

リポジトリ名のサブパスはWorkflowが `PAGES_BASE_PATH` と `NEXT_PUBLIC_BASE_PATH` へ自動設定します。独自ドメインでルート配信する場合は、Workflow内の `base_path` を空文字へ固定してください。

## 他モデルの成果を追加

比較実験の正本は [BENCHMARK_PROMPT.md](./BENCHMARK_PROMPT.md)、接続契約は [CANDIDATE_SPEC.md](./CANDIDATE_SPEC.md) です。

1. DeepSeek、Qwen、Kimi、GLMなど任意モデルの新規セッションへ `BENCHMARK_PROMPT.md` の共通プロンプトを変更せず渡します。
2. モデルに `app/benchmarks/candidate-template/` を候補ID名のフォルダへ複製させ、その中だけで実装させます。
3. 実際のprovider、model ID、reasoning mode、runDate、promptVersionをmanifestへ記録します。
4. `app/candidates.ts` でmanifestをimportし、`CANDIDATES` 配列へ1件追加します。
5. `pnpm check` と `CANDIDATE_SPEC.md` のセルフチェックを実行します。

レジストリへの追加だけで、単体表示、左右セレクター、候補カタログ、評価、JSON保存のすべてへ候補が現れます。

## 比較URL

単体表示:

```text
?view=single&candidate=luna-xhigh
```

A/B比較:

```text
?view=compare&left=luna-xhigh&right=reference-kinematics
```

画面の「比較URLをコピー」から現在の組み合わせを共有できます。操作値と評価データはURLへ含めず、端末内またはJSONへ保存します。

## 構成

```text
app/
  rotor-bench.tsx            UI、同期時計、評価、URL状態
  kinematics.mjs             運動学の正本
  candidates.ts              候補レジストリ
  benchmarks/
    types.ts                 接続インターフェース
    candidate-template/      他モデル用のコピー可能な雛形
tests/
.github/workflows/
```

評価とメモは `localStorage` の `rotorbench-evaluations-v1` に保存され、外部へ送信されません。

## ライセンス

MIT License。フォーク、候補追加、比較結果の再現に自由に利用できます。
