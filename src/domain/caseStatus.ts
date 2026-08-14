import { LOG_CUTOFF, type CauseEntry } from './causes';

/**
 * 대응 건의 상태.
 *
 * **판정하지 않는다.** 상태는 `불량 대응 log.xlsx`의 `상태` 열이 정하고, 이 파일은 그 값을
 * 화면·보고서가 같은 문장으로 쓰도록 형태만 맞춰 준다. 대장이 소스 오브 트루스이므로
 * 코드가 규칙을 세워 뒤집지 않는다.
 *
 * 여기서 계산하는 건 판정이 아니라 사실뿐이다 — 마지막 발생일로부터 며칠 지났는가.
 * 대장에 이미 있는 발생일자를 빼기만 한 값이라 새 판단이 섞이지 않는다.
 */

/** 대장의 집계 마감일 (= 마지막 발생일). 경과일 계산의 기준점. */
export const CUTOFF_DATE = LOG_CUTOFF;

const DAY = 86_400_000;

export type CaseStatus = 'closed' | 'monitoring' | 'unknown';

export const CASE_STATUS_LABEL: Record<CaseStatus, string> = {
  closed: '종결',
  monitoring: '모니터링 중 (효과검증 진행)',
  unknown: '이력 없음',
};

export const CASE_STATUS_SHORT: Record<CaseStatus, string> = {
  closed: '종결',
  monitoring: '모니터링',
  unknown: '—',
};

/** 마지막 발생일로부터 집계 마감일까지 며칠 지났는가 (대장 날짜의 차이일 뿐) */
export function daysSince(lastSeen: string, cutoff: string = CUTOFF_DATE): number {
  const a = new Date(`${lastSeen}T00:00:00`).getTime();
  const b = new Date(`${cutoff}T00:00:00`).getTime();
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / DAY);
}

export interface CauseStatus {
  /** 대장 '상태' 열이 말하는 그대로 */
  status: CaseStatus;
  /** 마지막 발생일 (대장 기재) */
  lastSeen?: string;
  /** 마지막 발생 이후 경과일 */
  elapsedDays: number;
  /** 대장에 기록된 총 발생 건수 */
  occurrences: number;
}

export function causeStatus(cause: CauseEntry, cutoff: string = CUTOFF_DATE): CauseStatus {
  const status: CaseStatus = cause.logIds.length === 0 ? 'unknown' : cause.openCase ? 'monitoring' : 'closed';
  return {
    status,
    lastSeen: cause.lastSeen,
    elapsedDays: cause.lastSeen ? daysSince(cause.lastSeen, cutoff) : 0,
    occurrences: cause.occurrences,
  };
}

/** 한 줄 설명 — 화면·보고서에서 같은 문장을 쓴다 */
export function explainStatus(s: CauseStatus): string {
  if (s.status === 'unknown') return '대응 Log에 기록이 없다.';
  const seen = s.lastSeen ? `마지막 발생 ${s.lastSeen} (${s.elapsedDays}일 전)` : '마지막 발생일 미상';
  return s.status === 'monitoring'
    ? `대장 기준 효과검증 진행 중. ${seen}, 지난 12개월 ${s.occurrences}회 기록.`
    : `대장 기준 종결. ${seen}, 지난 12개월 ${s.occurrences}회 기록.`;
}
