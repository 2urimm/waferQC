import {
  CELL_COUNT,
  GRID_COLS,
  GRID_ROWS,
  MUX_CHANNELS,
  SHIFT_REGISTER_BITS,
  isInsideWafer,
  type ScanOrder,
  type TimingBudget,
} from '../config/hardware';
import type { ScanStep } from './types';

/**
 * 스캔 시퀀스와 측정 시간.
 *
 * CD4067은 S0~S3로 한 번에 한 채널만 COMMON에 붙인다. 그래서 판독은 원리적으로 직렬이고,
 * 셀이 N개면 ADC 변환도 N번이다. 반면 74HC595는 8비트씩 밀어 넣고 한 번에 래치하므로
 * 쓰기 시간은 셀 수에 거의 비례하지 않는다.
 *
 * 이 비대칭이 이 프로젝트가 보여주려는 것이다 — 해상도를 올리면 정보량은 선형으로 늘지만
 * 측정 시간도 선형으로 늘고, 필요한 MUX 개수까지 같이 늘어난다.
 */

/** 스캔 순서대로 (row, col, mux, channel) 목록을 만든다 */
export function buildScanSequence(order: ScanOrder, circleMask: boolean): ScanStep[] {
  const cells: Array<{ row: number; col: number }> = [];

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let c = 0; c < GRID_COLS; c++) {
      if (circleMask && !isInsideWafer(r, c)) continue;
      cells.push({ row: r, col: c });
    }
  }

  // 'raster'는 행 우선(위에서 만든 그대로), 'bank'는 MUX 뱅크 단위로 묶어서 돈다.
  const ordered =
    order === 'raster'
      ? cells
      : cells.slice().sort((a, b) => {
          const ai = a.row * GRID_COLS + a.col;
          const bi = b.row * GRID_COLS + b.col;
          const aBank = Math.floor(ai / MUX_CHANNELS);
          const bBank = Math.floor(bi / MUX_CHANNELS);
          return aBank - bBank || ai - bi;
        });

  return ordered.map((cell, i) => ({
    index: i,
    row: cell.row,
    col: cell.col,
    muxIndex: Math.floor(i / MUX_CHANNELS),
    channel: i % MUX_CHANNELS,
  }));
}

export interface TimeEstimate {
  cellCount: number;
  /** 필요한 CD4067 개수 */
  muxCount: number;
  /** 필요한 74HC595 개수 (주소/뱅크 선택용) */
  shiftRegisterCount: number;
  /** 셀 하나 읽는 데 드는 시간 (µs) */
  perCellUs: number;
  /** 전체 채널 스캔 (ms) */
  scanMs: number;
  /** 74HC595 래치 (ms) */
  latchMs: number;
  /** 호스트로 시리얼 전송 (ms) */
  transferMs: number;
  /** 프레임 전체 (ms) */
  totalMs: number;
  /** 이론상 최대 프레임 레이트 */
  fps: number;
}

/** ADC 1샘플당 전송 바이트 수 (10bit → 2바이트) */
const BYTES_PER_SAMPLE = 2;
/** 8N1 시리얼 — 바이트당 10비트 */
const BITS_PER_BYTE = 10;

export function estimateTime(cellCount: number, t: TimingBudget): TimeEstimate {
  const perCellUs = t.addressSetUs + t.settleUs + t.adcConvertUs + t.loopOverheadUs;
  const scanMs = (cellCount * perCellUs) / 1000;

  const muxCount = Math.ceil(cellCount / MUX_CHANNELS);
  // MUX 주소 4비트 + 뱅크 선택. 74HC595 하나가 8비트를 내주므로 그 단위로 센다.
  const selectLines = 4 + Math.ceil(Math.log2(Math.max(1, muxCount)));
  const shiftRegisterCount = Math.max(1, Math.ceil(selectLines / SHIFT_REGISTER_BITS));

  const latchMs = (t.latchUs * shiftRegisterCount) / 1000;
  const transferMs = (cellCount * BYTES_PER_SAMPLE * BITS_PER_BYTE) / t.baudRate * 1000;

  const totalMs = scanMs + latchMs + transferMs;

  return {
    cellCount,
    muxCount,
    shiftRegisterCount,
    perCellUs,
    scanMs,
    latchMs,
    transferMs,
    totalMs,
    fps: totalMs > 0 ? 1000 / totalMs : 0,
  };
}

/** 현재 하드웨어 구성(64칸)의 추정치 */
export function currentEstimate(t: TimingBudget, circleMask: boolean): TimeEstimate {
  const cells = circleMask ? countCircleCells() : CELL_COUNT;
  return estimateTime(cells, t);
}

function countCircleCells(): number {
  let n = 0;
  for (let r = 0; r < GRID_ROWS; r++) for (let c = 0; c < GRID_COLS; c++) if (isInsideWafer(r, c)) n++;
  return n;
}

/**
 * 해상도-측정시간 트레이드오프 곡선.
 * 64칸이 어디쯤 서 있는지 보여주는 게 목적이라, 흔히 쓰는 고해상도 맵 크기까지 같이 찍는다.
 */
export interface TradeoffPoint extends TimeEstimate {
  label: string;
  side: number;
  /** 현재 구성인지 */
  current: boolean;
}

export const TRADEOFF_SIDES = [4, 8, 12, 16, 24, 32, 52];

export function tradeoffCurve(t: TimingBudget, currentSide = GRID_ROWS): TradeoffPoint[] {
  return TRADEOFF_SIDES.map((side) => {
    const cells = side * side;
    return {
      ...estimateTime(cells, t),
      label: `${side}×${side}`,
      side,
      current: side === currentSide,
    };
  });
}
