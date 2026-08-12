import type { ProcessId } from '../domain/causes';

/* ────────────────────────────────────────────────────────────────────────────
 * 기밀성 대응 — 역할 기반 열람 제어 + 마스킹.
 *
 * ⚠ 먼저 분명히 해 둘 것: 지금 구현은 **클라이언트 표시 제어**다.
 *    원인 지식베이스가 프론트엔드 번들에 그대로 들어 있으므로, 마스킹은 화면에서 가리는
 *    것이지 데이터를 못 보게 하는 게 아니다. 개발자 도구를 열면 전부 보인다.
 *
 *    실제 배포에서 기밀이 의미를 가지려면:
 *      1) 원인 매트릭스를 서버에 두고, 서버가 세션 역할에 따라 **필터링해서** 내려줘야 한다.
 *         (services/inference.ts의 HttpInferenceEngine과 같은 자리)
 *      2) 감사 로그도 서버에 남아야 한다. 아래 localStorage 로그는 사용자가 지울 수 있다.
 *      3) 인증은 사내 SSO에 붙어야 한다. 아래 계정은 역할 전환 데모용 가짜다.
 *
 *    이 파일의 구조(권한 판정 함수 · 마스킹 지점 · 감사 이벤트)는 그대로 두고
 *    데이터 출처만 서버로 옮기면 되도록 짜 뒀다.
 * ──────────────────────────────────────────────────────────────────────────── */

export type Role = 'admin' | 'process_owner' | 'operator' | 'viewer';

export const ROLE_META: Record<Role, { label: string; description: string }> = {
  admin: {
    label: '공정기술 총괄',
    description: '전 공정의 원인·레시피 파라미터·개선안을 모두 열람한다.',
  },
  process_owner: {
    label: '공정 담당 엔지니어',
    description: '담당 공정은 전부, 타 공정은 공정명과 연관도까지만 본다.',
  },
  operator: {
    label: '설비 오퍼레이터',
    description: '판정 결과와 무정지 확인 항목만. 레시피 파라미터와 개선안은 가려진다.',
  },
  viewer: {
    label: '참관 · 교육',
    description: '판정 결과와 관련 공정명까지만. 원인 상세는 전부 가려진다.',
  },
};

/** 기밀 등급 — 낮을수록 공개 */
export type Classification = 'internal' | 'confidential' | 'restricted';

export const CLASSIFICATION_META: Record<Classification, { label: string; short: string; note: string }> = {
  internal: { label: '사내 일반', short: '일반', note: '사내 구성원이면 열람 가능.' },
  confidential: {
    label: '대외비',
    short: '대외비',
    note: '공정 조건이 드러나는 정보. 담당 공정 인원과 총괄만 열람.',
  },
  restricted: {
    label: '제한',
    short: '제한',
    note: '레시피 파라미터·설비 세부 설정. 총괄 승인 없이는 반출 불가.',
  },
};

/** 공정별 기밀 등급. 실제로는 사내 정보보호 정책 테이블에서 내려와야 한다. */
export const PROCESS_CLASSIFICATION: Record<ProcessId, Classification> = {
  DIFFUSION: 'confidential',
  DEPOSITION: 'restricted',
  PHOTO: 'restricted',
  ETCH: 'restricted',
  CLEANING: 'internal',
  CMP: 'confidential',
  COMMON: 'internal',
};

export interface User {
  id: string;
  name: string;
  role: Role;
  /** process_owner일 때 담당 공정 */
  ownedProcesses: ProcessId[];
  dept: string;
}

/** 역할 전환 데모용 가짜 계정. 실제로는 SSO 세션에서 온다. */
export const DEMO_USERS: User[] = [
  { id: 'u-admin', name: '총괄 (데모)', role: 'admin', ownedProcesses: [], dept: '공정기술팀' },
  {
    id: 'u-etch',
    name: '식각 담당 (데모)',
    role: 'process_owner',
    ownedProcesses: ['ETCH', 'CLEANING'],
    dept: '식각기술파트',
  },
  {
    id: 'u-depo',
    name: '증착 담당 (데모)',
    role: 'process_owner',
    ownedProcesses: ['DEPOSITION', 'DIFFUSION'],
    dept: '박막기술파트',
  },
  { id: 'u-op', name: '오퍼레이터 (데모)', role: 'operator', ownedProcesses: [], dept: '제조1팀' },
  { id: 'u-view', name: '참관 (데모)', role: 'viewer', ownedProcesses: [], dept: '교육' },
];

/** 볼 수 있는 정보의 깊이 */
export type Visibility =
  /** 전부 */
  | 'full'
  /** 원인·기전까지. 레시피 파라미터와 개선안은 가림 */
  | 'summary'
  /** 공정명과 연관도까지만 */
  | 'label'
  ;

export function visibilityFor(user: User, process: ProcessId): Visibility {
  const level = PROCESS_CLASSIFICATION[process];

  if (user.role === 'admin') return 'full';

  if (user.role === 'process_owner') {
    if (user.ownedProcesses.includes(process)) return 'full';
    return level === 'restricted' ? 'label' : 'summary';
  }

  if (user.role === 'operator') {
    if (level === 'restricted') return 'label';
    return 'summary';
  }

  // viewer
  return level === 'internal' ? 'summary' : 'label';
}

/** 마스킹된 자리에 보여줄 것 */
export interface Masked {
  masked: true;
  reason: string;
}

export type Maybe<T> = T | Masked;

export function isMasked<T>(v: Maybe<T>): v is Masked {
  return typeof v === 'object' && v !== null && (v as Masked).masked === true;
}

export function gate<T>(value: T, allowed: boolean, reason: string): Maybe<T> {
  return allowed ? value : { masked: true, reason };
}

/** 이 사용자가 이 공정의 상세(설비·파라미터·개선안)를 볼 수 있는가 */
export function canSeeDetail(user: User, process: ProcessId): boolean {
  return visibilityFor(user, process) === 'full';
}

/** 이 사용자가 이 공정의 원인·기전을 볼 수 있는가 */
export function canSeeCause(user: User, process: ProcessId): boolean {
  return visibilityFor(user, process) !== 'label';
}

export function maskReason(user: User, process: ProcessId): string {
  const level = CLASSIFICATION_META[PROCESS_CLASSIFICATION[process]];
  if (user.role === 'process_owner') {
    return `${level.label} — 담당 공정이 아니라 가려집니다. 열람이 필요하면 해당 공정 담당자 또는 총괄에게 요청하세요.`;
  }
  return `${level.label} — ${ROLE_META[user.role].label} 권한에서는 가려집니다.`;
}

/* ── 감사 로그 ───────────────────────────────────────────────────────────── */

export type AuditAction = 'view-detail' | 'export-report' | 'copy-report' | 'role-switch' | 'blocked';

export interface AuditEvent {
  at: number;
  userId: string;
  userName: string;
  role: Role;
  action: AuditAction;
  target: string;
  classification?: Classification;
}

const AUDIT_KEY = 'waferqc.audit.v1';
const AUDIT_LIMIT = 500;

export function readAudit(): AuditEvent[] {
  try {
    const raw = localStorage.getItem(AUDIT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function recordAudit(e: Omit<AuditEvent, 'at'>): AuditEvent[] {
  const next = [{ ...e, at: Date.now() }, ...readAudit()].slice(0, AUDIT_LIMIT);
  try {
    localStorage.setItem(AUDIT_KEY, JSON.stringify(next));
  } catch {
    /* 프로토타입 범위에서 무시 */
  }
  return next;
}

export const AUDIT_ACTION_LABEL: Record<AuditAction, string> = {
  'view-detail': '기밀 상세 열람',
  'export-report': '보고서 반출',
  'copy-report': '보고서 복사',
  'role-switch': '역할 전환',
  blocked: '권한 없음 — 차단',
};
