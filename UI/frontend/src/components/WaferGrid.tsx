import { useCallback, useRef, useState } from 'react';
import { GRID_COLS, GRID_ROWS } from '../config/hardware';
import { CELL_DEFECT, CELL_LABEL, CELL_NORMAL, CELL_OUTSIDE, type CellState } from '../config/model';
import { clockOf } from '../domain/features';
import type { WaferMap } from '../domain/types';

/**
 * 셀 상태별 색.
 * 연속 스케일이 아니라 3상태 카테고리라 값의 크기를 색 농도로 나르지 않는다.
 * 웨이퍼 밖은 데이터가 없는 칸이므로 중립 회색, 정상/불량은 같은 계열의 밝기 차로 둔다.
 * 색만으로 뜻이 전달되지 않도록 범례에 항상 라벨을 같이 붙인다.
 */
export const CELL_FILL: Record<CellState, string> = {
  [CELL_OUTSIDE]: 'var(--heat-empty)',
  [CELL_NORMAL]: 'var(--heat-1)',
  [CELL_DEFECT]: 'var(--heat-6)',
};

interface Props {
  map: WaferMap;
  /** 편집 가능 여부 — 클릭하면 정상↔불량 토글 */
  editable?: boolean;
  onCell?: (index: number, value: CellState) => void;
  /** 스캔 진행 중일 때 아직 안 읽은 셀을 흐리게 */
  readCount?: number;
  /** 지금 읽고 있는 셀 인덱스 */
  activeIndex?: number;
  /** 아날로그 센서 전압 (0~1) */
  values?: number[];
  /** 지점별 부가 설명 (측정값·스펙 편차 등) — 툴팁에 붙는다 */
  detail?: (string | null)[];
  size?: number;
}

export function WaferGrid({ map, editable = false, onCell, readCount, activeIndex, values, detail, size }: Props) {
  const [painting, setPainting] = useState<CellState | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const paint = useCallback(
    (index: number, value: CellState) => {
      if (!editable || !onCell) return;
      // 웨이퍼 밖 칸은 하드웨어 형상이지 데이터가 아니다 — 사용자가 바꿀 수 있으면 안 된다.
      if ((map[index] ?? CELL_OUTSIDE) === CELL_OUTSIDE) return;
      onCell(index, value);
    },
    [editable, onCell, map],
  );

  const cells = [];
  for (let row = 0; row < GRID_ROWS; row++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const i = row * GRID_COLS + col;
      const v = (map[i] ?? CELL_OUTSIDE) as CellState;
      const outside = v === CELL_OUTSIDE;
      const pending = readCount !== undefined && i >= readCount;
      const analog = values?.[i];

      const cls = [
        'wafer-cell',
        outside ? 'masked' : '',
        pending ? 'pending' : '',
        activeIndex === i ? 'active-scan' : '',
      ]
        .filter(Boolean)
        .join(' ');

      cells.push(
        <button
          key={i}
          type="button"
          className={cls}
          disabled={!editable || outside}
          style={{
            background: CELL_FILL[v],
            boxShadow: v === CELL_DEFECT && !pending ? 'inset 0 0 0 1.5px var(--text-primary)' : undefined,
          }}
          title={
            `(${row}, ${col}) · ${clockOf(row, col)}시 · ${CELL_LABEL[v]}` +
            (detail?.[i] ? ` · ${detail[i]}` : analog !== undefined ? ` · 전압 ${analog.toFixed(2)}` : '')
          }
          aria-label={`행 ${row} 열 ${col}, ${CELL_LABEL[v]}`}
          onPointerDown={(e) => {
            if (!editable || outside) return;
            e.preventDefault();
            const next: CellState =
              e.button === 2 || e.ctrlKey ? CELL_NORMAL : v === CELL_DEFECT ? CELL_NORMAL : CELL_DEFECT;
            setPainting(next);
            paint(i, next);
            gridRef.current?.setPointerCapture?.(e.pointerId);
          }}
          onPointerEnter={() => {
            if (painting !== null) paint(i, painting);
          }}
          onContextMenu={(e) => e.preventDefault()}
        />,
      );
    }
  }

  return (
    <div
      ref={gridRef}
      className={`wafer${editable ? '' : ' readonly'}`}
      style={size ? { maxWidth: size } : undefined}
      onPointerUp={() => setPainting(null)}
      onPointerLeave={() => setPainting(null)}
      role="group"
      aria-label="웨이퍼 맵 8×8"
    >
      {cells}
    </div>
  );
}

/** 3상태 범례. 색 단독으로 뜻을 나르지 않도록 라벨을 항상 붙인다. */
export function WaferLegend() {
  return (
    <div className="wafer-legend">
      {([CELL_OUTSIDE, CELL_NORMAL, CELL_DEFECT] as CellState[]).map((s) => (
        <span key={s} className="row" style={{ gap: 5 }}>
          <span
            aria-hidden
            style={{
              width: 11,
              height: 11,
              borderRadius: 3,
              background: CELL_FILL[s],
              border: '1px solid var(--border)',
              display: 'inline-block',
            }}
          />
          {CELL_LABEL[s]}
        </span>
      ))}
    </div>
  );
}
