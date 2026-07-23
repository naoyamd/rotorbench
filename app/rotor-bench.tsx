"use client";

import {
  type ChangeEvent,
  type CSSProperties,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { CANDIDATES, getCandidate, type RotorCandidate } from "./candidates";
import {
  DEFAULT_INPUTS,
  PRESETS,
  advanceAzimuth,
  bladeStates,
  degreesToRadians,
  pitchAtAzimuth,
  pitchEnvelope,
  type RotorInputs,
} from "./kinematics.mjs";

const assetBasePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

type ViewMode = "single" | "compare";
type ScoreKey =
  | "engineering"
  | "clarity"
  | "interaction"
  | "visual"
  | "accessibility"
  | "implementation";

type Evaluation = {
  scores: Record<ScoreKey, number>;
  notes: string;
};

type EvaluationMap = Record<string, Evaluation>;

const STORAGE_KEY = "rotorbench-evaluations-v1";
const SESSION_STORAGE_KEY = "rotorbench-session-v1";
const SCORE_KEYS: {
  key: ScoreKey;
  label: string;
  hint: string;
  weight: number;
}[] = [
  {
    key: "engineering",
    label: "機構・工学的妥当性",
    hint: "式と機構の整合",
    weight: 30,
  },
  {
    key: "clarity",
    label: "因果関係の分かりやすさ",
    hint: "入力と動作の明瞭さ",
    weight: 20,
  },
  {
    key: "interaction",
    label: "操作性・比較性",
    hint: "同期操作の扱いやすさ",
    weight: 15,
  },
  {
    key: "visual",
    label: "視覚的情報設計",
    hint: "形状・動き・情報密度",
    weight: 15,
  },
  {
    key: "accessibility",
    label: "アクセシビリティ",
    hint: "キーボード・狭幅対応",
    weight: 10,
  },
  {
    key: "implementation",
    label: "実装・公開品質",
    hint: "堅牢性と静的公開適性",
    weight: 10,
  },
];

const BENCHMARK_PROMPT = `Prompt version: RB-2.0

この共通プロンプトは改変不可です。

・ヘリコプター主回転翼のスワッシュプレート式可変ピッチ機構を、ブラウザで操作できる技術デモとして実装してください。
・共通のGitHub Pagesで開く、モデル固有の独立コンテンツのWEBページとして実装してください。
・コレクティブ／サイクリックをリアルタイムに反映してください。
・模式図ではなく、実機・CAD志向の構造と運動を追求してください。
・ローターヘッドだけでなく、動力・伝達・制御までつながる機械システムとして捉えてください。
・未指定事項は自律的に判断し、最低限で止めず、改善を重ねて完成させてください。`;

function emptyEvaluation(): Evaluation {
  return {
    scores: {
      engineering: 0,
      clarity: 0,
      interaction: 0,
      visual: 0,
      accessibility: 0,
      implementation: 0,
    },
    notes: "",
  };
}

function initialEvaluations(): EvaluationMap {
  return Object.fromEntries(
    CANDIDATES.map((candidate) => [candidate.id, emptyEvaluation()]),
  );
}

function formatSigned(value: number, digits = 1) {
  if (Math.abs(value) < 0.05) return `0.${"0".repeat(Math.max(0, digits))}`;
  return `${value > 0 ? "+" : ""}${value.toFixed(digits)}`;
}

function formatDegree(value: number, signed = false) {
  return `${signed ? formatSigned(value) : value.toFixed(1)}°`;
}

function projectPoint(
  x: number,
  y: number,
  z: number,
  width: number,
  height: number,
) {
  const scale = Math.min(width / 410, height / 320);
  const yaw = degreesToRadians(-34);
  const rx = x * Math.cos(yaw) - y * Math.sin(yaw);
  const ry = x * Math.sin(yaw) + y * Math.cos(yaw);
  return {
    x: width * 0.49 + rx * scale,
    y: height * 0.45 + (ry * 0.42 - z * 0.84) * scale,
  };
}

function line3d(
  context: CanvasRenderingContext2D,
  from: [number, number, number],
  to: [number, number, number],
  width: number,
  height: number,
) {
  const start = projectPoint(from[0], from[1], from[2], width, height);
  const end = projectPoint(to[0], to[1], to[2], width, height);
  context.beginPath();
  context.moveTo(start.x, start.y);
  context.lineTo(end.x, end.y);
  context.stroke();
}

function polygon3d(
  context: CanvasRenderingContext2D,
  points: [number, number, number][],
  width: number,
  height: number,
) {
  const projected = points.map(([x, y, z]) =>
    projectPoint(x, y, z, width, height),
  );
  context.beginPath();
  projected.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  context.closePath();
  context.fill();
  context.stroke();
}

function drawRotorScene(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  candidate: RotorCandidate,
  inputs: RotorInputs,
  rotorAzimuth: number,
) {
  const { theme } = candidate;
  const isReference = theme.renderer === "reference";
  context.clearRect(0, 0, width, height);

  const background = context.createLinearGradient(0, 0, 0, height);
  background.addColorStop(0, "#0d1725");
  background.addColorStop(1, "#071019");
  context.fillStyle = background;
  context.fillRect(0, 0, width, height);

  context.save();
  context.strokeStyle = theme.grid;
  context.lineWidth = 1;
  for (let coordinate = -180; coordinate <= 180; coordinate += 30) {
    line3d(
      context,
      [-180, coordinate, -48],
      [180, coordinate, -48],
      width,
      height,
    );
    line3d(
      context,
      [coordinate, -180, -48],
      [coordinate, 180, -48],
      width,
      height,
    );
  }

  const swashBase = -2 + (inputs.collective - 8) * 1.2;
  const swashZ = (x: number, y: number) =>
    swashBase + 0.045 * (inputs.cyclicLat * x + inputs.cyclicLong * y);

  // Mast and non-rotating lower swashplate.
  context.strokeStyle = "rgba(202, 218, 233, 0.48)";
  context.lineWidth = 5;
  line3d(context, [0, 0, -50], [0, 0, 45], width, height);
  context.lineWidth = 2;
  context.fillStyle = "rgba(134, 156, 177, 0.18)";
  const lowerPlate: [number, number, number][] = [];
  for (let step = 0; step < 40; step += 1) {
    const angle = (step / 40) * Math.PI * 2;
    lowerPlate.push([
      Math.cos(angle) * 47,
      Math.sin(angle) * 47,
      swashBase - 7,
    ]);
  }
  polygon3d(context, lowerPlate, width, height);

  // Tilting, rotating upper swashplate.
  const upperPlate: [number, number, number][] = [];
  for (let step = 0; step < 48; step += 1) {
    const angle = (step / 48) * Math.PI * 2;
    const x = Math.cos(angle) * 43;
    const y = Math.sin(angle) * 43;
    upperPlate.push([x, y, swashZ(x, y)]);
  }
  context.strokeStyle = theme.accent;
  context.fillStyle = theme.accentSoft;
  context.lineWidth = 3;
  polygon3d(context, upperPlate, width, height);

  // Stationary control actuators make the collective/cyclic motion legible.
  const actuatorPoints: [number, number][] = [
    [-34, 0],
    [24, -25],
    [24, 25],
  ];
  context.lineWidth = 3;
  actuatorPoints.forEach(([x, y]) => {
    context.strokeStyle = "rgba(176, 197, 216, 0.54)";
    line3d(context, [x, y, -47], [x, y, swashZ(x, y)], width, height);
  });

  const blades = bladeStates(rotorAzimuth, inputs);
  const rotorZ = 43;

  // Pitch links connect rotating swashplate to each pitch horn.
  context.lineWidth = 2.3;
  blades.forEach((blade) => {
    const psi = degreesToRadians(blade.azimuth);
    const ux = Math.cos(psi);
    const uy = Math.sin(psi);
    const vx = -uy;
    const vy = ux;
    const plateX = ux * 38;
    const plateY = uy * 38;
    const hornRadius = 30;
    const pitchRadians = degreesToRadians(blade.pitch);
    const hornX = ux * hornRadius + vx * 11 * Math.cos(pitchRadians);
    const hornY = uy * hornRadius + vy * 11 * Math.cos(pitchRadians);
    const hornZ = rotorZ + 11 * Math.sin(pitchRadians);
    context.strokeStyle = "rgba(235, 244, 251, 0.86)";
    line3d(
      context,
      [plateX, plateY, swashZ(plateX, plateY)],
      [hornX, hornY, hornZ],
      width,
      height,
    );
    const hornPoint = projectPoint(hornX, hornY, hornZ, width, height);
    context.fillStyle = theme.accent;
    context.beginPath();
    context.arc(hornPoint.x, hornPoint.y, 3.2, 0, Math.PI * 2);
    context.fill();
  });

  // Draw the four blades back-to-front.
  [...blades]
    .sort(
      (a, b) =>
        Math.sin(degreesToRadians(a.azimuth + 34)) -
        Math.sin(degreesToRadians(b.azimuth + 34)),
    )
    .forEach((blade) => {
      const psi = degreesToRadians(blade.azimuth);
      const pitch = degreesToRadians(blade.pitch);
      const ux = Math.cos(psi);
      const uy = Math.sin(psi);
      const vx = -uy;
      const vy = ux;
      const point = (radius: number, side: number, chord: number) =>
        [
          ux * radius + vx * side * chord * Math.cos(pitch),
          uy * radius + vy * side * chord * Math.cos(pitch),
          rotorZ + side * chord * Math.sin(pitch),
        ] as [number, number, number];

      context.strokeStyle = theme.accent;
      context.fillStyle = isReference
        ? "rgba(255, 189, 102, 0.12)"
        : "rgba(85, 230, 200, 0.18)";
      context.lineWidth = 1.6;
      polygon3d(
        context,
        [point(25, -1, 8), point(140, -1, 5), point(140, 1, 5), point(25, 1, 8)],
        width,
        height,
      );

      if (isReference) {
        context.strokeStyle = "rgba(255, 255, 255, 0.24)";
        context.setLineDash([4, 4]);
        line3d(
          context,
          [ux * 28, uy * 28, rotorZ],
          [ux * 136, uy * 136, rotorZ],
          width,
          height,
        );
        context.setLineDash([]);
      }

      const labelPoint = projectPoint(
        ux * 151,
        uy * 151,
        rotorZ + 4,
        width,
        height,
      );
      context.font = "600 10px ui-monospace, SFMono-Regular, Consolas, monospace";
      context.textAlign = "center";
      context.fillStyle = "rgba(225, 237, 247, 0.82)";
      context.fillText(
        `B${blade.index + 1}  ${formatSigned(blade.pitch)}°`,
        labelPoint.x,
        labelPoint.y,
      );
    });

  const hub = projectPoint(0, 0, rotorZ, width, height);
  context.fillStyle = "#d8e4ed";
  context.strokeStyle = "#152536";
  context.lineWidth = 3;
  context.beginPath();
  context.arc(hub.x, hub.y, 9, 0, Math.PI * 2);
  context.fill();
  context.stroke();

  // Phase graph uses the same pitch function as the blades and readouts.
  const chartWidth = Math.min(178, width * 0.42);
  const chartHeight = 60;
  const chartX = width - chartWidth - 14;
  const chartY = height - chartHeight - 14;
  context.fillStyle = "rgba(3, 9, 15, 0.76)";
  context.strokeStyle = "rgba(174, 197, 216, 0.2)";
  context.lineWidth = 1;
  context.beginPath();
  context.roundRect(chartX, chartY, chartWidth, chartHeight, 8);
  context.fill();
  context.stroke();
  context.strokeStyle = "rgba(174, 197, 216, 0.14)";
  context.beginPath();
  context.moveTo(chartX + 8, chartY + chartHeight / 2);
  context.lineTo(chartX + chartWidth - 8, chartY + chartHeight / 2);
  context.stroke();

  const minPitch = -3;
  const maxPitch = 19;
  context.strokeStyle = theme.accent;
  context.lineWidth = 1.6;
  context.beginPath();
  for (let degree = 0; degree <= 360; degree += 4) {
    const pitch = pitchAtAzimuth(
      degree,
      inputs.collective,
      inputs.cyclicLat,
      inputs.cyclicLong,
    );
    const x = chartX + 8 + (degree / 360) * (chartWidth - 16);
    const y =
      chartY +
      chartHeight -
      8 -
      ((pitch - minPitch) / (maxPitch - minPitch)) * (chartHeight - 16);
    if (degree === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();

  const phaseX = chartX + 8 + (rotorAzimuth / 360) * (chartWidth - 16);
  context.strokeStyle = "rgba(255,255,255,0.7)";
  context.lineWidth = 1;
  context.beginPath();
  context.moveTo(phaseX, chartY + 7);
  context.lineTo(phaseX, chartY + chartHeight - 7);
  context.stroke();
  context.font = "500 9px ui-monospace, SFMono-Regular, Consolas, monospace";
  context.textAlign = "left";
  context.fillStyle = "rgba(208, 224, 237, 0.68)";
  context.fillText("θ / ψ 0–360°", chartX + 8, chartY + 11);

  context.restore();
}

function RotorCanvas({
  candidate,
  inputs,
  rotorAzimuth,
}: {
  candidate: RotorCandidate;
  inputs: RotorInputs;
  rotorAzimuth: number;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (!parent) return;

    const draw = () => {
      const bounds = parent.getBoundingClientRect();
      const width = Math.max(320, Math.round(bounds.width));
      const height = Math.max(280, Math.round(bounds.height));
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      if (
        canvas.width !== Math.round(width * ratio) ||
        canvas.height !== Math.round(height * ratio)
      ) {
        canvas.width = Math.round(width * ratio);
        canvas.height = Math.round(height * ratio);
      }
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawRotorScene(context, width, height, candidate, inputs, rotorAzimuth);
    };

    draw();
    const observer = new ResizeObserver(draw);
    observer.observe(parent);
    return () => observer.disconnect();
  }, [candidate, inputs, rotorAzimuth]);

  return (
    <canvas
      ref={canvasRef}
      aria-label={`${candidate.name}の可変ピッチ・ローター機構。現在のローター方位角 ${rotorAzimuth.toFixed(0)} 度`}
      role="img"
    />
  );
}

function useRotorClock(rpm: number) {
  const [paused, setPaused] = useState(false);
  const [azimuth, setAzimuth] = useState(22.5);
  const previousFrame = useRef<number | null>(null);

  useEffect(() => {
    if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const frame = window.requestAnimationFrame(() => setPaused(true));
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    let animationFrame = 0;
    const animate = (time: number) => {
      if (previousFrame.current === null) previousFrame.current = time;
      const elapsed = Math.min(time - previousFrame.current, 80);
      previousFrame.current = time;
      if (!paused && elapsed > 0) {
        setAzimuth((current) => advanceAzimuth(current, elapsed, rpm));
      }
      animationFrame = requestAnimationFrame(animate);
    };
    animationFrame = requestAnimationFrame(animate);
    return () => {
      cancelAnimationFrame(animationFrame);
      previousFrame.current = null;
    };
  }, [paused, rpm]);

  const step = useCallback(() => {
    setPaused(true);
    setAzimuth((current) => advanceAzimuth(current, 1000 / 24, rpm));
  }, [rpm]);

  const reset = useCallback(() => {
    setPaused(true);
    setAzimuth(22.5);
  }, []);

  return { paused, setPaused, azimuth, step, reset };
}

function RangeControl({
  label,
  symbol,
  value,
  min,
  max,
  step,
  unit,
  accent,
  onChange,
}: {
  label: string;
  symbol: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  accent?: "amber";
  onChange: (value: number) => void;
}) {
  const percentage = ((value - min) / (max - min)) * 100;
  return (
    <label className="range-control">
      <span className="range-label">
        <span>
          {label} <code>{symbol}</code>
        </span>
        <output>
          {unit === "°" ? formatSigned(value) : value.toFixed(0)}
          {unit}
        </output>
      </span>
      <input
        aria-label={label}
        className={accent === "amber" ? "range-amber" : ""}
        max={max}
        min={min}
        onInput={(event) => onChange(Number(event.currentTarget.value))}
        step={step}
        style={{ "--range-progress": `${percentage}%` } as CSSProperties}
        type="range"
        value={value}
      />
      <span className="range-ends" aria-hidden="true">
        <span>
          {min}
          {unit}
        </span>
        <span>
          {max}
          {unit}
        </span>
      </span>
    </label>
  );
}

function CandidateSelector({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <label className="select-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {CANDIDATES.map((candidate) => (
          <option key={candidate.id} value={candidate.id}>
            {candidate.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function SimulationCard({
  candidate,
  inputs,
  rotorAzimuth,
  paused,
}: {
  candidate: RotorCandidate;
  inputs: RotorInputs;
  rotorAzimuth: number;
  paused: boolean;
}) {
  const blades = useMemo(
    () => bladeStates(rotorAzimuth, inputs),
    [rotorAzimuth, inputs],
  );
  const envelope = pitchEnvelope(inputs);
  return (
    <article
      className="simulation-card"
      style={
        {
          "--candidate-accent": candidate.theme.accent,
          "--candidate-soft": candidate.theme.accentSoft,
        } as CSSProperties
      }
    >
      <header className="simulation-header">
        <div>
          <div className="candidate-kicker">
            <span className="candidate-dot" aria-hidden="true" />
            {candidate.maker}
          </div>
          <h2>{candidate.name}</h2>
        </div>
        <span className="version-chip">v{candidate.version}</span>
      </header>

      <div className="canvas-shell">
        {candidate.View ? (
          <candidate.View
            assetBasePath={assetBasePath}
            inputs={inputs}
            paused={paused}
            rotorAzimuth={rotorAzimuth}
            theme={candidate.theme}
          />
        ) : (
          <RotorCanvas
            candidate={candidate}
            inputs={inputs}
            rotorAzimuth={rotorAzimuth}
          />
        )}
        <div className="canvas-legend" aria-hidden="true">
          <span><i className="legend-swash" />スワッシュ</span>
          <span><i className="legend-link" />ピッチリンク</span>
        </div>
      </div>

      <div className="simulation-readout">
        <div className="metric-strip">
          <div>
            <span>ピッチ範囲</span>
            <strong>
              {envelope.min.toFixed(1)}° — {envelope.max.toFixed(1)}°
            </strong>
          </div>
          <div>
            <span>1/rev 振幅</span>
            <strong>{envelope.amplitude.toFixed(1)}°</strong>
          </div>
          <div>
            <span>位相</span>
            <strong>{envelope.phase.toFixed(0)}°</strong>
          </div>
        </div>
        <ol className="blade-readouts" aria-label="各ブレードの現在値">
          {blades.map((blade) => (
            <li key={blade.index}>
              <span>B{blade.index + 1}</span>
              <span>ψ {blade.azimuth.toFixed(0)}°</span>
              <strong>{formatDegree(blade.pitch, true)}</strong>
            </li>
          ))}
        </ol>
        <p className="candidate-summary">{candidate.summary}</p>
      </div>
    </article>
  );
}

function ScorePicker({
  candidateId,
  scoreKey,
  value,
  label,
  onChange,
}: {
  candidateId: string;
  scoreKey: ScoreKey;
  value: number;
  label: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="score-picker" aria-label={`${label}の評価`}>
      {[1, 2, 3, 4, 5].map((score) => (
        <button
          aria-label={`${label} ${score}点`}
          aria-pressed={value === score}
          className={value === score ? "selected" : ""}
          key={`${candidateId}-${scoreKey}-${score}`}
          onClick={() => onChange(score)}
          type="button"
        >
          {score}
        </button>
      ))}
    </div>
  );
}

function EvaluationCard({
  candidate,
  evaluation,
  onChange,
}: {
  candidate: RotorCandidate;
  evaluation: Evaluation;
  onChange: (evaluation: Evaluation) => void;
}) {
  const scoredRubrics = SCORE_KEYS.filter(
    ({ key }) => evaluation.scores[key] > 0,
  );
  const weightedScore =
    scoredRubrics.length > 0
      ? scoredRubrics.reduce(
          (total, { key, weight }) =>
            total + (evaluation.scores[key] / 5) * weight,
          0,
        )
      : null;

  return (
    <article
      className="evaluation-card"
      style={{ "--candidate-accent": candidate.theme.accent } as CSSProperties}
    >
      <header>
        <div>
          <span>{candidate.maker}</span>
          <h3>{candidate.name}</h3>
        </div>
        <div className="score-total" aria-label="100点換算の加重得点">
          <strong>
            {weightedScore === null ? "—" : weightedScore.toFixed(0)}
          </strong>
          <span>/ 100</span>
        </div>
      </header>
      <div className="rubric-list">
        {SCORE_KEYS.map(({ key, label, hint, weight }) => (
          <div className="rubric-row" key={key}>
            <div>
              <strong>{label}</strong>
              <span>
                {hint} · {weight}%
              </span>
            </div>
            <ScorePicker
              candidateId={candidate.id}
              label={label}
              onChange={(score) =>
                onChange({
                  ...evaluation,
                  scores: { ...evaluation.scores, [key]: score },
                })
              }
              scoreKey={key}
              value={evaluation.scores[key]}
            />
          </div>
        ))}
      </div>
      <label className="notes-field">
        <span>観察メモ</span>
        <textarea
          onChange={(event) =>
            onChange({ ...evaluation, notes: event.target.value })
          }
          placeholder="良かった点、違和感、再現条件など…"
          rows={4}
          value={evaluation.notes}
        />
      </label>
    </article>
  );
}

function CandidateCatalogCard({
  candidate,
  primaryId,
  secondaryId,
  viewMode,
  onSingle,
  onLeft,
  onRight,
}: {
  candidate: RotorCandidate;
  primaryId: string;
  secondaryId: string;
  viewMode: ViewMode;
  onSingle: () => void;
  onLeft: () => void;
  onRight: () => void;
}) {
  const isSingle = viewMode === "single" && primaryId === candidate.id;
  const isLeft = viewMode === "compare" && primaryId === candidate.id;
  const isRight = viewMode === "compare" && secondaryId === candidate.id;
  return (
    <article
      className="catalog-card"
      style={{ "--candidate-accent": candidate.theme.accent } as CSSProperties}
    >
      <header>
        <div>
          <span>{candidate.maker}</span>
          <h3>{candidate.name}</h3>
        </div>
        <span className="catalog-version">v{candidate.version}</span>
      </header>
      <dl>
        <div>
          <dt>PROVIDER</dt>
          <dd>{candidate.metadata.provider}</dd>
        </div>
        <div>
          <dt>MODEL</dt>
          <dd>{candidate.metadata.model}</dd>
        </div>
        <div>
          <dt>REASONING</dt>
          <dd>{candidate.metadata.reasoning}</dd>
        </div>
        <div>
          <dt>RUN DATE</dt>
          <dd>{candidate.metadata.runDate}</dd>
        </div>
        <div>
          <dt>PROMPT</dt>
          <dd>{candidate.metadata.promptVersion}</dd>
        </div>
      </dl>
      <div className="tag-list" aria-label="候補タグ">
        {candidate.metadata.tags.map((tag) => (
          <span key={tag}>{tag}</span>
        ))}
      </div>
      <div className="catalog-actions">
        <button
          aria-pressed={isSingle}
          className={isSingle ? "active" : ""}
          onClick={onSingle}
          type="button"
        >
          単体表示
        </button>
        <button
          aria-pressed={isLeft}
          className={isLeft ? "active" : ""}
          onClick={onLeft}
          type="button"
        >
          Aに設定
        </button>
        <button
          aria-pressed={isRight}
          className={isRight ? "active" : ""}
          onClick={onRight}
          type="button"
        >
          Bに設定
        </button>
      </div>
    </article>
  );
}

function safeEvaluationMap(value: unknown): EvaluationMap | null {
  if (!value || typeof value !== "object") return null;
  const source = value as Record<string, unknown>;
  const result = initialEvaluations();
  for (const candidate of CANDIDATES) {
    const raw = source[candidate.id];
    if (!raw || typeof raw !== "object") continue;
    const item = raw as { scores?: unknown; notes?: unknown };
    if (item.scores && typeof item.scores === "object") {
      for (const { key } of SCORE_KEYS) {
        const score = Number((item.scores as Record<string, unknown>)[key]);
        if (Number.isInteger(score) && score >= 0 && score <= 5) {
          result[candidate.id].scores[key] = score;
        }
      }
    }
    if (typeof item.notes === "string") {
      result[candidate.id].notes = item.notes.slice(0, 20_000);
    }
  }
  return result;
}

function isRotorInputs(value: unknown): value is RotorInputs {
  if (!value || typeof value !== "object") return false;
  const inputs = value as Record<string, unknown>;
  return (
    typeof inputs.collective === "number" &&
    inputs.collective >= -2 &&
    inputs.collective <= 16 &&
    typeof inputs.cyclicLat === "number" &&
    inputs.cyclicLat >= -8 &&
    inputs.cyclicLat <= 8 &&
    typeof inputs.cyclicLong === "number" &&
    inputs.cyclicLong >= -8 &&
    inputs.cyclicLong <= 8 &&
    typeof inputs.rpm === "number" &&
    inputs.rpm >= 30 &&
    inputs.rpm <= 420
  );
}

export function RotorBench() {
  const [viewMode, setViewMode] = useState<ViewMode>("compare");
  const [primaryId, setPrimaryId] = useState(CANDIDATES[0].id);
  const [secondaryId, setSecondaryId] = useState(CANDIDATES[1].id);
  const [inputs, setInputs] = useState<RotorInputs>({ ...DEFAULT_INPUTS });
  const [evaluations, setEvaluations] =
    useState<EvaluationMap>(initialEvaluations);
  const [storageReady, setStorageReady] = useState(false);
  const [sessionReady, setSessionReady] = useState(false);
  const [urlReady, setUrlReady] = useState(false);
  const [toast, setToast] = useState("");
  const importRef = useRef<HTMLInputElement>(null);
  const clock = useRotorClock(inputs.rpm);
  const setClockPaused = clock.setPaused;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(SESSION_STORAGE_KEY);
        if (stored) {
          const session = JSON.parse(stored) as Record<string, unknown>;
          if (isRotorInputs(session.inputs)) setInputs(session.inputs);
          if (
            session.viewMode === "single" ||
            session.viewMode === "compare"
          ) {
            setViewMode(session.viewMode);
          }
          if (
            typeof session.primaryId === "string" &&
            CANDIDATES.some((item) => item.id === session.primaryId)
          ) {
            setPrimaryId(session.primaryId);
          }
          if (
            typeof session.secondaryId === "string" &&
            CANDIDATES.some((item) => item.id === session.secondaryId)
          ) {
            setSecondaryId(session.secondaryId);
          }
          if (typeof session.paused === "boolean") {
            setClockPaused(session.paused);
          }
        }
      } catch {
        // A malformed session falls back to the canonical defaults.
      }

      const parameters = new URLSearchParams(window.location.search);
      const requestedView = parameters.get("view");
      const candidate = parameters.get("candidate");
      const left = parameters.get("left");
      const right = parameters.get("right");
      if (
        requestedView === "single" &&
        candidate &&
        CANDIDATES.some((item) => item.id === candidate)
      ) {
        setViewMode("single");
        setPrimaryId(candidate);
      } else if (requestedView === "compare") {
        setViewMode("compare");
        if (left && CANDIDATES.some((item) => item.id === left)) {
          setPrimaryId(left);
        }
        if (right && CANDIDATES.some((item) => item.id === right)) {
          setSecondaryId(right);
        }
      }
      setUrlReady(true);
      setSessionReady(true);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [setClockPaused]);

  useEffect(() => {
    if (!urlReady) return;
    const url = new URL(window.location.href);
    if (viewMode === "single") {
      url.searchParams.set("view", "single");
      url.searchParams.set("candidate", primaryId);
      url.searchParams.delete("left");
      url.searchParams.delete("right");
    } else {
      url.searchParams.set("view", "compare");
      url.searchParams.set("left", primaryId);
      url.searchParams.set("right", secondaryId);
      url.searchParams.delete("candidate");
    }
    window.history.replaceState(null, "", url);
  }, [primaryId, secondaryId, urlReady, viewMode]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      try {
        const stored = window.localStorage.getItem(STORAGE_KEY);
        if (stored) {
          const restored = safeEvaluationMap(JSON.parse(stored));
          if (restored) setEvaluations(restored);
        }
      } catch {
        // An unavailable or malformed local store should not block the demo.
      } finally {
        setStorageReady(true);
      }
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    if (!storageReady) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(evaluations));
    } catch {
      // The export button remains available when browser storage is disabled.
    }
  }, [evaluations, storageReady]);

  useEffect(() => {
    if (!sessionReady) return;
    try {
      window.localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify({
          viewMode,
          primaryId,
          secondaryId,
          inputs,
          paused: clock.paused,
        }),
      );
    } catch {
      // Device-local persistence is optional; the UI remains fully usable.
    }
  }, [
    clock.paused,
    inputs,
    primaryId,
    secondaryId,
    sessionReady,
    viewMode,
  ]);

  const updateInput = <Key extends keyof RotorInputs>(
    key: Key,
    value: RotorInputs[Key],
  ) => setInputs((current) => ({ ...current, [key]: value }));

  const applyPreset = (presetId: string) => {
    const preset = PRESETS.find((item) => item.id === presetId);
    if (preset) {
      setInputs({ ...preset.inputs });
      showToast(`「${preset.label}」を両ビューに適用しました`);
    }
  };

  const resetAll = () => {
    setInputs({ ...DEFAULT_INPUTS });
    clock.reset();
    showToast("入力とローター位置をリセットしました");
  };

  const updateEvaluation = (candidateId: string, value: Evaluation) => {
    setEvaluations((current) => ({ ...current, [candidateId]: value }));
  };

  const exportSession = () => {
    const payload = {
      schema: "rotorbench/session",
      version: 1,
      exportedAt: new Date().toISOString(),
      comparison: { viewMode, primaryId, secondaryId },
      controls: inputs,
      evaluations,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `rotorbench-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    showToast("評価セッションを書き出しました");
  };

  const importSession = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const payload = JSON.parse(await file.text()) as Record<string, unknown>;
      if (
        payload.schema !== "rotorbench/session" ||
        payload.version !== 1 ||
        !isRotorInputs(payload.controls)
      ) {
        throw new Error("unsupported");
      }
      const restored = safeEvaluationMap(payload.evaluations);
      if (!restored) throw new Error("evaluation");
      setInputs(payload.controls);
      setEvaluations(restored);
      const comparison = payload.comparison as
        | Record<string, unknown>
        | undefined;
      if (comparison) {
        if (
          comparison.viewMode === "single" ||
          comparison.viewMode === "compare"
        ) {
          setViewMode(comparison.viewMode);
        }
        if (
          typeof comparison.primaryId === "string" &&
          CANDIDATES.some((item) => item.id === comparison.primaryId)
        ) {
          setPrimaryId(comparison.primaryId);
        }
        if (
          typeof comparison.secondaryId === "string" &&
          CANDIDATES.some((item) => item.id === comparison.secondaryId)
        ) {
          setSecondaryId(comparison.secondaryId);
        }
      }
      showToast("評価セッションを読み込みました");
    } catch {
      showToast("このJSONは読み込めませんでした");
    }
  };

  const clearEvaluations = () => {
    if (!window.confirm("すべての採点とメモを消去しますか？")) return;
    setEvaluations(initialEvaluations());
    showToast("評価を消去しました");
  };

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(BENCHMARK_PROMPT);
      showToast("ベンチマーク・プロンプトをコピーしました");
    } catch {
      showToast("コピーできませんでした");
    }
  };

  const copyShareUrl = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showToast("現在の比較URLをコピーしました");
    } catch {
      showToast("URLをコピーできませんでした");
    }
  };

  const primary = getCandidate(primaryId);
  const secondary = getCandidate(secondaryId);
  const envelope = pitchEnvelope(inputs);

  return (
    <>
      <a className="skip-link" href="#simulation-workspace">
        シミュレーションへ移動
      </a>
      <div className="app-shell">
        <header className="site-header">
          <a className="brand" href="#" aria-label="RotorBench ホーム">
            <span className="brand-mark" aria-hidden="true">
              <i />
            </span>
            <span>
              <strong>RotorBench</strong>
              <small>LLM IMPLEMENTATION BENCHMARK</small>
            </span>
          </a>
          <div className="header-status">
            <span className="live-dot" aria-hidden="true" />
            LOCAL-FIRST
            <span className="header-divider" />
            v1.0
          </div>
        </header>

        <main>
          <section className="hero">
            <div>
              <p className="eyebrow">VARIABLE-PITCH ROTOR LAB</p>
              <h1>
                同じ入力で、<span>実装の差</span>を見る。
              </h1>
              <p className="hero-copy">
                コレクティブとサイクリックを同期し、機構表現・工学的整合性・
                操作体験を同一条件で比較する、自分用のLLMベンチマークです。
              </p>
            </div>
            <div className="formula-card" aria-label="使用しているピッチ式">
              <span>CANONICAL PITCH SCHEDULE</span>
              <code>
                θ(ψ) = θ<sub>0</sub> + θ<sub>lat</sub> cos ψ + θ
                <sub>long</sub> sin ψ
              </code>
              <p>操作・描画・数値表示は、すべてこの1つの式を参照します。</p>
              <p className="model-convention">
                x＝右、y＝前、z＝上、ψ=0°＝右。上面視で反時計回り。
                空力・フラッピング・位相遅れを含まない準静的リンク機構モデルです。
              </p>
            </div>
          </section>

          <section className="bench-toolbar" aria-label="比較表示の設定">
            <div className="segmented" aria-label="表示モード">
              <button
                aria-pressed={viewMode === "single"}
                className={viewMode === "single" ? "active" : ""}
                onClick={() => setViewMode("single")}
                type="button"
              >
                単体
              </button>
              <button
                aria-pressed={viewMode === "compare"}
                className={viewMode === "compare" ? "active" : ""}
                onClick={() => setViewMode("compare")}
                type="button"
              >
                A / B 比較
              </button>
            </div>
            <div className="candidate-selectors">
              <CandidateSelector
                label={viewMode === "compare" ? "VIEW A" : "表示候補"}
                onChange={setPrimaryId}
                value={primaryId}
              />
              {viewMode === "compare" && (
                <>
                  <span className="versus">VS</span>
                  <CandidateSelector
                    label="VIEW B"
                    onChange={setSecondaryId}
                    value={secondaryId}
                  />
                </>
              )}
            </div>
            <span className="sync-status">
              <i aria-hidden="true" />
              {viewMode === "compare" ? "INPUTS SYNCED" : "SINGLE VIEW"}
            </span>
            <button
              className="share-button"
              onClick={copyShareUrl}
              type="button"
            >
              比較URLをコピー
            </button>
          </section>

          <section
            className="workspace"
            id="simulation-workspace"
            aria-label="ローター・シミュレーション"
          >
            <aside className="control-panel">
              <div className="panel-heading">
                <div>
                  <span>SHARED CONTROLS</span>
                  <h2>飛行入力</h2>
                </div>
                <button className="text-button" onClick={resetAll} type="button">
                  リセット
                </button>
              </div>

              <div className="presets">
                <span className="field-caption">フライト・プリセット</span>
                <div>
                  {PRESETS.map((preset) => (
                    <button
                      key={preset.id}
                      onClick={() => applyPreset(preset.id)}
                      title={preset.description}
                      type="button"
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="control-group">
                <div className="group-heading">
                  <span className="control-index">01</span>
                  <div>
                    <strong>コレクティブ</strong>
                    <span>全ブレードの基準ピッチ</span>
                  </div>
                </div>
                <RangeControl
                  label="コレクティブ"
                  max={16}
                  min={-2}
                  onChange={(value) => updateInput("collective", value)}
                  step={0.5}
                  symbol="θ₀"
                  unit="°"
                  value={inputs.collective}
                />
              </div>

              <div className="control-group">
                <div className="group-heading">
                  <span className="control-index amber">02</span>
                  <div>
                    <strong>サイクリック</strong>
                    <span>1回転中の周期的なピッチ変化</span>
                  </div>
                </div>
                <RangeControl
                  accent="amber"
                  label="横方向"
                  max={8}
                  min={-8}
                  onChange={(value) => updateInput("cyclicLat", value)}
                  step={0.5}
                  symbol="θlat"
                  unit="°"
                  value={inputs.cyclicLat}
                />
                <RangeControl
                  accent="amber"
                  label="縦方向"
                  max={8}
                  min={-8}
                  onChange={(value) => updateInput("cyclicLong", value)}
                  step={0.5}
                  symbol="θlong"
                  unit="°"
                  value={inputs.cyclicLong}
                />
              </div>

              <div className="control-group compact-group">
                <div className="group-heading">
                  <span className="control-index neutral">03</span>
                  <div>
                    <strong>ローター速度</strong>
                    <span>表示上の回転速度</span>
                  </div>
                </div>
                <RangeControl
                  label="ローター速度"
                  max={420}
                  min={30}
                  onChange={(value) => updateInput("rpm", value)}
                  step={10}
                  symbol="Ω"
                  unit=" rpm"
                  value={inputs.rpm}
                />
              </div>

              <div className="transport-controls">
                <button
                  className="primary-button"
                  onClick={() => clock.setPaused((paused) => !paused)}
                  type="button"
                >
                  <span aria-hidden="true">{clock.paused ? "▶" : "Ⅱ"}</span>
                  {clock.paused ? "再生" : "一時停止"}
                </button>
                <button onClick={clock.step} type="button">
                  <span aria-hidden="true">↦</span>
                  1ステップ
                </button>
              </div>

              <div className="live-summary">
                <span>LIVE ENVELOPE</span>
                <div>
                  <p>
                    <span>θ min</span>
                    <strong>{envelope.min.toFixed(1)}°</strong>
                  </p>
                  <p>
                    <span>θ max</span>
                    <strong>{envelope.max.toFixed(1)}°</strong>
                  </p>
                  <p>
                    <span>ψ rotor</span>
                    <strong>{clock.azimuth.toFixed(0)}°</strong>
                  </p>
                </div>
              </div>
            </aside>

            <div
              className={`simulation-grid ${
                viewMode === "single" ? "single-view" : ""
              }`}
            >
              <SimulationCard
                candidate={primary}
                inputs={inputs}
                paused={clock.paused}
                rotorAzimuth={clock.azimuth}
              />
              {viewMode === "compare" && (
                <SimulationCard
                  candidate={secondary}
                  inputs={inputs}
                  paused={clock.paused}
                  rotorAzimuth={clock.azimuth}
                />
              )}
            </div>
          </section>

          <section className="catalog-section" id="catalog">
            <div className="section-heading">
              <div>
                <p className="eyebrow">CANDIDATE REGISTRY</p>
                <h2>候補カタログ</h2>
                <p>
                  実行条件を含む候補レジストリです。単体表示、または任意の2候補を
                  A / Bへ割り当てられます。
                </p>
              </div>
              <span className="catalog-count">
                {CANDIDATES.length.toString().padStart(2, "0")} REGISTERED
              </span>
            </div>
            <div className="catalog-grid">
              {CANDIDATES.map((candidate) => (
                <CandidateCatalogCard
                  candidate={candidate}
                  key={candidate.id}
                  onLeft={() => {
                    setPrimaryId(candidate.id);
                    setViewMode("compare");
                  }}
                  onRight={() => {
                    setSecondaryId(candidate.id);
                    setViewMode("compare");
                  }}
                  onSingle={() => {
                    setPrimaryId(candidate.id);
                    setViewMode("single");
                  }}
                  primaryId={primaryId}
                  secondaryId={secondaryId}
                  viewMode={viewMode}
                />
              ))}
            </div>
          </section>

          <section className="evaluation-section" id="evaluation">
            <div className="section-heading">
              <div>
                <p className="eyebrow">LOCAL EVALUATION</p>
                <h2>同じ基準で採点する</h2>
                <p>
                  1点＝主要要件を満たさない、3点＝概ね正確、5点＝正確かつ
                  直感的。6軸の加重得点と観察メモはこのブラウザに保存され、
                  JSONで別環境へ持ち出せます。
                </p>
              </div>
              <div className="data-actions">
                <button onClick={exportSession} type="button">
                  JSONを書き出す
                </button>
                <button onClick={() => importRef.current?.click()} type="button">
                  JSONを読み込む
                </button>
                <button className="danger-text" onClick={clearEvaluations} type="button">
                  評価を消去
                </button>
                <input
                  accept="application/json,.json"
                  className="visually-hidden"
                  onChange={importSession}
                  ref={importRef}
                  type="file"
                />
              </div>
            </div>
            <div className="evaluation-grid">
              {CANDIDATES.filter(({ kind }) => kind === "model").map((candidate) => (
                <EvaluationCard
                  candidate={candidate}
                  evaluation={
                    evaluations[candidate.id] ?? emptyEvaluation()
                  }
                  key={candidate.id}
                  onChange={(evaluation) =>
                    updateEvaluation(candidate.id, evaluation)
                  }
                />
              ))}
            </div>
          </section>

          <section className="protocol-section">
            <div className="section-heading compact">
              <div>
                <p className="eyebrow">REPRODUCIBLE PROTOCOL</p>
                <h2>テスト条件を固定する</h2>
              </div>
            </div>
            <div className="protocol-grid">
              <div className="protocol-steps">
                <ol>
                  <li>
                    <span>01</span>
                    <div>
                      <strong>同じプロンプトを渡す</strong>
                      <p>モデル名と実行日時だけを記録し、追加指示を揃えます。</p>
                    </div>
                  </li>
                  <li>
                    <span>02</span>
                    <div>
                      <strong>プリセットを順に確認</strong>
                      <p>ホバリング、上昇、右ロール、前進、複合入力を比較します。</p>
                    </div>
                  </li>
                  <li>
                    <span>03</span>
                    <div>
                      <strong>式・機構・体験を採点</strong>
                      <p>見た目だけでなく、リンクとピッチ値の整合も確認します。</p>
                    </div>
                  </li>
                </ol>
              </div>
              <details className="prompt-card">
                <summary>
                  <span>
                    <small>BENCHMARK PROMPT</small>
                    実装課題を表示
                  </span>
                  <i aria-hidden="true">＋</i>
                </summary>
                <div>
                  <pre>{BENCHMARK_PROMPT}</pre>
                  <button onClick={copyPrompt} type="button">
                    プロンプトをコピー
                  </button>
                </div>
              </details>
            </div>
          </section>
        </main>

        <footer>
          <div className="brand footer-brand">
            <span className="brand-mark" aria-hidden="true">
              <i />
            </span>
            <span>
              <strong>RotorBench</strong>
              <small>OPEN, STATIC, REPRODUCIBLE</small>
            </span>
          </div>
          <p>
            データは端末内に保存され、外部へ送信されません。
            <span>θ(ψ) convention: advancing-axis reference</span>
          </p>
        </footer>
      </div>
      <div className={`toast ${toast ? "show" : ""}`} role="status" aria-live="polite">
        {toast}
      </div>
    </>
  );
}
