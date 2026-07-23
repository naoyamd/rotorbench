# Candidate template

このフォルダを `app/benchmarks/<candidate-id>/` へコピーし、別のLLMが生成した実装を接続します。

1. `manifest.ts` のIDと実行メタデータを埋めます。
2. `candidate-view.tsx` を実装します。受け取る `inputs` と `rotorAzimuth` は変更せず、独自の時計を作りません。
3. 静的資産が必要な場合は `public/candidates/<candidate-id>/` に置きます。
4. `app/candidates.ts` で manifest を import し、`CANDIDATES` 配列へ追加します。
5. `pnpm check` を実行し、単体表示、左右どちらの選択、停止・ステップ、JSON保存を確認します。

詳細な契約はルートの `CANDIDATE_SPEC.md` を参照してください。
