# RotorBench Result Integration

各モデルが生成した独立Webページを、共通ホームへ追加するための接続仕様です。ベンチマーク実行そのものは、この仕様には含みません。

モデルへURLで渡す内容非干渉の作業入口は[`MODEL_TASK.md`](./MODEL_TASK.md)です。この接続仕様は詳細確認用であり、成果ページの制作要件を追加するものではありません。

## 追加方法

1. `submissions/_template/` を `submissions/<candidate-id>/` へ複製します。
2. 完成済みの静的ページ一式を `site/` に配置します。入口は必ず `site/index.html` とします。
3. `manifest.json` を、実行時に確認できた正確な情報で更新します。
4. `pnpm catalog` または `pnpm check` を実行します。

ビルド時に全submissionが自動検出され、検証済みページが `public/results/<candidate-id>/` へコピーされます。同時にホーム画面用のカタログも自動生成されるため、共通UIの編集や中央レジストリへの追記は不要です。

## 独立ページの条件

- HTML、CSS、JavaScript、画像などを含む、ブラウザで直接動作する静的成果物であること。
- すべての資産URLを相対パスにし、GitHub Pagesのサブパス配信に対応すること。
- 他候補、共通ホーム、`BENCHMARK_PROMPT.md` を変更しないこと。
- 外部サービスや秘密情報がなくても、第三者が同じページを再現できること。

## manifest

`id`、`title`、`provider`、`model`、`reasoning`、`runDate`、`promptVersion`、`summary`、`tags`を記録します。カード画像を含める場合だけ、`site/`からの相対パスを`cover`へ指定します。

既存結果のmanifestは実行記録です。後からモデル名、推論設定、Prompt versionを変更してはいけません。
