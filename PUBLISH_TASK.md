# モデル成果ページの反映・公開手順

この文書は、完成済みのベンチマーク成果をRotorBenchへ反映する**公開担当向け**の手順です。成果を生成したモデルへは渡さず、生成完了後の別タスクで使用してください。

対象リポジトリは [`https://github.com/naoyamd/rotorbench`](https://github.com/naoyamd/rotorbench) です。

## 必要な入力

- 完成済みの`submissions/<candidate-id>/`が存在する場所、またはその成果を生成したCodexタスク
- 候補ID

## 反映

1. 対象リポジトリの最新`main`を使用します。
2. 完成済みの候補ディレクトリを、同じ候補IDで`submissions/<candidate-id>/`へ取り込みます。
3. 取り込み前後のファイル内容が一致することを確認します。
4. 成果ページ、`manifest.json`、`BENCHMARK_PROMPT.md`は改変しません。
5. 共通サイト側で必要な修正だけを行い、`pnpm check`を通します。

## 公開

1. 変更内容を確認し、対象リポジトリへcommit・pushします。
2. GitHub Pagesの公開処理が成功するまで確認します。
3. 次の2つがブラウザから開けることを確認します。
   - `https://naoyamd.github.io/rotorbench/`
   - `https://naoyamd.github.io/rotorbench/results/<candidate-id>/`
4. 公開した候補ID、成果ページURL、検証結果を報告します。

## Codexへの指示例

```text
次の完成済み成果をRotorBenchへ反映し、公開確認まで完了してください。

反映手順:
https://naoyamd.github.io/rotorbench/publish-task/

候補ID:
<candidate-id>

成果物:
<成果を生成したCodexタスクのリンク、またはsubmissions/<candidate-id>/の絶対パス>
```

この公開タスクでは、成果物の改善、再設計、評価、ベンチマークの再実行は行いません。
