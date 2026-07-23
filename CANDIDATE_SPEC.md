# RotorBench Candidate Specification

Version: `1.0` / Prompt: `RB-1.0`

この仕様は、DeepSeek、Qwen、Kimi、GLMを含む任意のLLM実装を同じ画面へ安全に接続するための契約です。

## 1. RotorCandidate インターフェース

正本は `app/benchmarks/types.ts` です。

```ts
type RotorCandidateViewProps = {
  inputs: Readonly<{
    collective: number;
    cyclicLat: number;
    cyclicLong: number;
    rpm: number;
  }>;
  rotorAzimuth: number;
  paused: boolean;
  assetBasePath: string;
  theme: Readonly<CandidateTheme>;
};

type RotorCandidate = {
  id: string;
  kind: "model" | "reference";
  name: string;
  maker: string;
  summary: string;
  version: string;
  metadata: {
    provider: string;
    model: string;
    reasoning: string;
    runDate: string;       // YYYY-MM-DD
    promptVersion: string; // RB-1.0
    tags: string[];
  };
  theme: CandidateTheme;
  View?: React.ComponentType<RotorCandidateViewProps>;
};
```

`id` は小文字英数字とハイフンだけを使用し、永続的に一意とします。評価データと共有URLがこのIDを参照するため、登録後に変更しません。
通常のLLM成果は `kind: "model"`、検算専用の非LLM基準だけを `kind: "reference"` とします。Referenceは表示比較には使えますが、モデル評価カードからは除外されます。

## 2. フォルダと manifest

```text
app/benchmarks/
  candidate-template/
  <candidate-id>/
    manifest.ts
    candidate-view.tsx
    README.md        # 任意。実装判断、モデル出力、既知の制約
public/candidates/
  <candidate-id>/   # 画像・フォント等が必要な場合のみ
```

`app/benchmarks/candidate-template/` をフォルダごとコピーします。`manifest.ts` は `candidate: RotorCandidate` を named export してください。モデルID、provider、reasoning、実行日は実行時の正確な値を記録し、推測で埋めません。

## 3. 共有 controls / azimuth

- `inputs` は読み取り専用です。複製して表示計算に使えますが、変更しません。
- `rotorAzimuth` が4枚のうちB1の現在方位角です。B2〜B4は90°ずつ加えます。
- 独自の `requestAnimationFrame` で方位角を進めません。親が同じフレーム値を全候補へ渡します。
- ピッチ値は `pitchAtAzimuth` または `bladeStates` を `app/kinematics.mjs` から import して求めます。式を候補内へ再実装しません。
- `paused` は表示用です。時間の進行判断は親が行います。

これにより、単体表示とA/B表示で同じ候補が同じ状態になります。

## 4. Canvas / React 接続規約

`CandidateView` は候補カードの `.canvas-shell` 内に配置されます。

- ルート要素は親の幅と高さに追従させます。CanvasはCSSで `width: 100%; height: 100%` とします。
- Canvasの内部解像度には `devicePixelRatio` を使い、最大2程度に抑えます。
- `ResizeObserver` または親寸法の読み取りでレスポンシブに再描画します。
- Canvasには内容を説明する `aria-label` と `role="img"` を付けます。
- React stateを毎フレーム複製せず、受け取ったpropsから決定的に描画します。
- WebGLを使う場合はコンテキスト喪失時に簡潔なフォールバックを表示します。
- グローバルCSS、document、body、共有コントロールを候補から変更しません。
- ポータル、全画面固定要素、外部ウィンドウ、ネットワーク通信は使いません。

`View` を省略した候補はRotorBench標準Canvasで表示されます。独自成果を比較する場合は必ず `View` を指定してください。

## 5. 静的資産規約

- 資産は `public/candidates/<candidate-id>/` の配下だけに置きます。
- URLは `${assetBasePath}/candidates/<candidate-id>/asset.ext` とし、JavaScriptから動的に外部CDNへ取りに行きません。
- GitHub Pagesのサブパスでも動くよう、可能ならimportされたローカル資産かCSS/Canvas表現を優先します。
- 秘密情報、API key、ライセンス不明の資産、大容量動画、ユーザー追跡コードを含めません。
- 候補固有の依存追加は原則禁止です。必要な場合は理由、容量、ライセンスをREADMEに記録し、比較条件を更新します。

## 6. セルフチェック

登録前に次を確認します。

- [ ] `manifest.ts` のIDとメタデータが正確で、IDが既存候補と重複しない。
- [ ] ホバリングで4枚のピッチが等しい。
- [ ] 横サイクリックのみで `ψ=0°/180°` が最大/最小になり、縦軸側は基準値になる。
- [ ] 縦サイクリックのみで `ψ=90°/270°` が最大/最小になる。
- [ ] コレクティブ変更で全ブレードが等量変化する。
- [ ] 一時停止、再生、1ステップで他候補と方位角が同期する。
- [ ] 単体、A、Bの各位置で表示できる。
- [ ] 360 px幅とデスクトップ幅で操作不能な重なりがない。
- [ ] キーボードだけで操作でき、Canvasの代替ラベルがある。
- [ ] 外部通信、コンソールエラー、型エラー、ビルドエラーがない。
- [ ] `pnpm check` が成功する。

## 7. 登録手順

例として `qwen3-235b-a22b` を追加します。

1. `app/benchmarks/candidate-template/` を `app/benchmarks/qwen3-235b-a22b/` へコピーする。
2. `manifest.ts` と `candidate-view.tsx` を実装し、セルフチェックを行う。
3. `app/candidates.ts` 冒頭で `import { candidate as qwen3 } from "./benchmarks/qwen3-235b-a22b/manifest";` を追加する。
4. `CANDIDATES` 配列の末尾へ `qwen3` を追加する。
5. `pnpm check` を実行する。

UI、セレクター、候補カタログ、評価カード、JSON保存、URL共有はレジストリから生成されるため、登録以外のアプリコード変更は不要です。
