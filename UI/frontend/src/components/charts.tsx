import { useId, useState } from 'react';

/*
 * 차트는 전부 인라인 SVG로 직접 그린다. 규칙은 하나로 통일해 뒀다.
 *   - 단일 계열은 색 하나(series-1). 값 크기를 색으로 또 칠하지 않는다.
 *   - 격자/축은 표면에서 한 단계만 뜬 실선 헤어라인. 점선 안 쓴다.
 *   - 값 라벨은 끝점·극값만. 모든 점에 숫자를 붙이지 않는다.
 *   - 호버 툴팁은 보조 수단이고, 값은 표로도 항상 읽을 수 있어야 한다.
 */

export interface Point {
  label: string;
  x: number;
  y: number;
  /** 현재 운전점처럼 강조할 지점 */
  emphasis?: boolean;
  /** 툴팁에 덧붙일 설명 */
  detail?: string;
}

interface LineChartProps {
  points: Point[];
  height?: number;
  yFormat: (v: number) => string;
  yTicks?: number;
  /** 끝점에 직접 라벨을 붙일지 */
  labelLast?: boolean;
  /** 로그 스케일 x축 (셀 수처럼 배율로 벌어지는 축) */
  logX?: boolean;
  ariaLabel: string;
  tableHead?: [string, string];
}

const PAD = { top: 14, right: 56, bottom: 26, left: 46 };

export function LineChart({
  points,
  height = 180,
  yFormat,
  yTicks = 4,
  labelLast = true,
  logX = false,
  ariaLabel,
  tableHead = ['구간', '값'],
}: LineChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const clipId = useId();
  const W = 640;
  const H = height;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;

  if (points.length === 0) return null;

  const xs = points.map((p) => (logX ? Math.log10(Math.max(1, p.x)) : p.x));
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMax = niceCeil(Math.max(...points.map((p) => p.y)));
  const yMin = 0;

  const sx = (i: number) => PAD.left + ((xs[i] - xMin) / (xMax - xMin || 1)) * innerW;
  const sy = (v: number) => PAD.top + innerH - ((v - yMin) / (yMax - yMin || 1)) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${sx(i)},${sy(p.y)}`).join(' ');
  const ticks = Array.from({ length: yTicks + 1 }, (_, i) => (yMax / yTicks) * i);
  const last = points.length - 1;
  const active = hover ?? null;

  return (
    <div className="chart-wrap">
      <svg
        className="chart-svg"
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        <defs>
          <clipPath id={clipId}>
            <rect x={PAD.left} y={0} width={innerW} height={H} />
          </clipPath>
        </defs>

        {ticks.map((t) => (
          <g key={t}>
            <line
              x1={PAD.left}
              x2={PAD.left + innerW}
              y1={sy(t)}
              y2={sy(t)}
              stroke="var(--grid)"
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={PAD.left - 8} y={sy(t) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {yFormat(t)}
            </text>
          </g>
        ))}

        <line
          x1={PAD.left}
          x2={PAD.left + innerW}
          y1={sy(0)}
          y2={sy(0)}
          stroke="var(--baseline)"
          strokeWidth={1}
          shapeRendering="crispEdges"
        />

        <path d={path} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" clipPath={`url(#${clipId})`} />

        {points.map((p, i) => {
          const isEmph = p.emphasis || i === last;
          if (!isEmph && active !== i) return null;
          return (
            <circle
              key={p.label}
              cx={sx(i)}
              cy={sy(p.y)}
              r={p.emphasis ? 5.5 : 4.5}
              fill="var(--series-1)"
              stroke="var(--surface)"
              strokeWidth={2}
            />
          );
        })}

        {/* x축 라벨 — 겹치지 않을 만큼만 */}
        {points.map((p, i) => {
          const step = Math.ceil(points.length / 7);
          if (i % step !== 0 && i !== last) return null;
          return (
            <text key={p.label} x={sx(i)} y={H - 8} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
              {p.label}
            </text>
          );
        })}

        {labelLast && (
          <text
            x={sx(last) + 9}
            y={sy(points[last].y) + 4}
            fontSize={12}
            fill="var(--text-primary)"
            fontWeight={600}
          >
            {yFormat(points[last].y)}
          </text>
        )}

        {/* 히트 영역 — 마크보다 넉넉하게 */}
        {points.map((p, i) => (
          <rect
            key={`hit-${p.label}`}
            x={sx(i) - innerW / points.length / 2}
            y={0}
            width={innerW / points.length}
            height={H}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
          />
        ))}

        {active !== null && (
          <line
            x1={sx(active)}
            x2={sx(active)}
            y1={PAD.top}
            y2={PAD.top + innerH}
            stroke="var(--baseline)"
            strokeWidth={1}
            shapeRendering="crispEdges"
          />
        )}
      </svg>

      {active !== null && (
        <div
          className="chart-tip"
          style={{
            left: `${(sx(active) / W) * 100}%`,
            top: 4,
            transform: sx(active) > W * 0.6 ? 'translateX(-105%)' : 'translateX(8px)',
          }}
        >
          <strong>{points[active].label}</strong> · {yFormat(points[active].y)}
          {points[active].detail && <div style={{ color: 'var(--text-muted)' }}>{points[active].detail}</div>}
        </div>
      )}

      <TableView
        head={tableHead}
        rows={points.map((p) => [p.label, yFormat(p.y)])}
      />
    </div>
  );
}

interface ColumnChartProps {
  bars: Array<{ label: string; value: number; emphasis?: boolean }>;
  height?: number;
  format: (v: number) => string;
  ariaLabel: string;
  tableHead?: [string, string];
}

/** 세로 막대. 단일 계열이라 색은 하나, 강조만 예외. */
export function ColumnChart({ bars, height = 160, format, ariaLabel, tableHead = ['항목', '값'] }: ColumnChartProps) {
  const [hover, setHover] = useState<number | null>(null);
  const W = 640;
  const H = height;
  const pad = { top: 16, right: 8, bottom: 30, left: 40 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const yMax = niceCeil(Math.max(1, ...bars.map((b) => b.value)));
  const band = innerW / Math.max(1, bars.length);
  const barW = Math.min(24, band - 10);

  const sy = (v: number) => pad.top + innerH - (v / yMax) * innerH;

  return (
    <div className="chart-wrap">
      <svg className="chart-svg" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line
              x1={pad.left}
              x2={pad.left + innerW}
              y1={sy(yMax * f)}
              y2={sy(yMax * f)}
              stroke={f === 0 ? 'var(--baseline)' : 'var(--grid)'}
              strokeWidth={1}
              shapeRendering="crispEdges"
            />
            <text x={pad.left - 8} y={sy(yMax * f) + 4} textAnchor="end" fontSize={11} fill="var(--text-muted)">
              {format(yMax * f)}
            </text>
          </g>
        ))}

        {bars.map((b, i) => {
          const x = pad.left + band * i + (band - barW) / 2;
          const y = sy(b.value);
          const h = Math.max(0, sy(0) - y);
          return (
            <g key={b.label} onMouseEnter={() => setHover(i)}>
              <rect x={pad.left + band * i} y={0} width={band} height={H} fill="transparent" />
              <path
                d={roundedTopRect(x, y, barW, h, 4)}
                fill={b.emphasis === false ? 'var(--deemphasis)' : 'var(--series-1)'}
              />
              <text x={x + barW / 2} y={H - 10} textAnchor="middle" fontSize={11} fill="var(--text-muted)">
                {b.label}
              </text>
            </g>
          );
        })}

        {hover !== null && bars[hover] && (
          <text
            x={pad.left + band * hover + band / 2}
            y={sy(bars[hover].value) - 7}
            textAnchor="middle"
            fontSize={12}
            fontWeight={600}
            fill="var(--text-primary)"
          >
            {format(bars[hover].value)}
          </text>
        )}
      </svg>

      <TableView head={tableHead} rows={bars.map((b) => [b.label, format(b.value)])} />
    </div>
  );
}

/** 클래스 확률 — 가로 막대. 판정된 클래스만 강조하고 나머지는 비강조 회색. */
export function ProbabilityBars({
  rows,
  topId,
}: {
  rows: Array<{ id: string; label: string; probability: number }>;
  topId: string;
}) {
  return (
    <div role="table" aria-label="계통별 확률">
      {rows.map((r) => {
        const isTop = r.id === topId;
        return (
          <div className="prob-row" key={r.id} role="row">
            <span className={`prob-label${isTop ? ' top' : ''}`} role="cell">
              {r.label}
            </span>
            <span className="prob-track" role="cell">
              <span
                className={`prob-fill${isTop ? ' top' : ''}`}
                style={{ width: `${Math.max(1, r.probability * 100)}%` }}
              />
            </span>
            <span className="prob-value" role="cell">
              {(r.probability * 100).toFixed(0)}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

function TableView({ head, rows }: { head: [string, string]; rows: Array<[string, string]> }) {
  return (
    <details style={{ marginTop: 8 }}>
      <summary style={{ fontSize: 12, color: 'var(--text-muted)', cursor: 'pointer' }}>표로 보기</summary>
      <div className="table-wrap" style={{ marginTop: 6 }}>
        <table className="data">
          <thead>
            <tr>
              <th>{head[0]}</th>
              <th className="num">{head[1]}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([a, b]) => (
              <tr key={a}>
                <td>{a}</td>
                <td className="num">{b}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function niceCeil(v: number): number {
  if (v <= 0) return 1;
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / mag;
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10;
  return step * mag;
}

function roundedTopRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.min(r, w / 2, h);
  return `M${x},${y + h} L${x},${y + rr} Q${x},${y} ${x + rr},${y} L${x + w - rr},${y} Q${x + w},${y} ${x + w},${y + rr} L${x + w},${y + h} Z`;
}
