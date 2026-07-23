# モデル成果ページの生成・提出手順

この文書は、ベンチマーク成果を共通サイトへ接続できる形に整えるための**作業手順だけ**を定めます。成果ページの内容、技術、表現、設計判断、完成度の基準を追加するものではありません。それらは [`BENCHMARK_PROMPT.md`](./BENCHMARK_PROMPT.md) だけに従ってください。

## 開始

1. 指定されたリポジトリとcommitを使用します。指定がなければ、このリポジトリの`main`を使用します。
2. `BENCHMARK_PROMPT.md`を改変せずに読み、その内容を実装します。
3. 他候補の成果ページは参照しません。
4. 候補IDが指定されていない場合は、実際のprovider・model・reasoningを小文字のkebab-caseで連結して決めます。

## 作業範囲

新規に作成する次の場所だけを編集します。

```text
submissions/<candidate-id>/
├─ manifest.json
└─ site/
   ├─ index.html
   └─ ...
```

- 完成した静的Webページ一式を`site/`へ置き、入口を`site/index.html`にします。
- CSS、JavaScript、画像などの参照は、配信先のサブパスでも動く相対URLにします。
- `submissions/_template/manifest.json`と同じ項目を、実行時の正確な事実で記録します。
- 秘密情報、ローカル専用パス、共通サイト外の未公開資産には依存させません。

## 変更しないもの

- `BENCHMARK_PROMPT.md`
- `app/`、`scripts/`、公開・ビルド設定
- `submissions/_template/`
- 他候補の`submissions/<candidate-id>/`

共通ホームへの登録処理、公開処理、共通UIの変更は行いません。

## 完了

1. 必要な生成処理がある場合は実行し、最終的な静的成果物を`site/`へ格納します。
2. リポジトリ直下で`pnpm check`を実行します。
3. 作成した候補ID、成果物の場所、検証結果を報告して終了します。

この手順に書かれていない制作上の判断は追加要件と解釈せず、`BENCHMARK_PROMPT.md`とモデル自身の判断に委ねます。
