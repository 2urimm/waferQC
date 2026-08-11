import type { ProcessId } from '../domain/causes';
import type { Classification } from './security';

/* ────────────────────────────────────────────────────────────────────────────
 * 매뉴얼 참조.
 *
 * 파일 자체를 이 앱이 들고 있지는 않는다 — 사내 파일 서버에 있는 문서를 가리키기만 한다.
 * 브라우저는 보안상 UNC 경로(\\server\...)를 링크로 열 수 없으므로, UI는 경로를
 * 클립보드에 복사해 주는 방식으로 처리한다. 이게 지금 웹앱에서 할 수 있는 최선이다.
 *
 * 실제 연결 시 선택지:
 *   - 사내 문서 포털에 http URL이 있으면 `url` 필드를 채우면 링크로 열린다.
 *   - 데스크톱 앱(Electron/Tauri)으로 감싸면 로컬 경로를 직접 열 수 있다.
 *   - 파일 서버를 WebDAV/HTTP로 노출하면 그대로 링크가 된다.
 * ──────────────────────────────────────────────────────────────────────────── */

export interface ManualRef {
  id: string;
  /** 어느 공정 매뉴얼인가 */
  process: ProcessId;
  title: string;
  /** 사내 파일 서버 경로 */
  path: string;
  /** 문서 포털 URL이 있으면 (없으면 경로 복사로 대체) */
  url?: string;
  /** 참조할 절 */
  section?: string;
  /** 문서 자체의 기밀 등급 */
  classification: Classification;
  revision: string;
  updatedAt: string;
  /** 이 매뉴얼이 걸리는 원인 항목 id (causes.ts의 CauseEntry.id) */
  causeIds: string[];
}

export const MANUALS: ManualRef[] = [
  {
    id: 'm-etch-focusring',
    process: 'ETCH',
    title: '식각 설비 포커스 링 교체 및 수명 관리 절차',
    path: '\\\\fileserver\\공정매뉴얼\\04_식각\\ETCH-MNT-012_포커스링_교체절차.pdf',
    section: '4장 RF hour 기준 교체 판정',
    classification: 'confidential',
    revision: 'Rev.7',
    updatedAt: '2026-05-14',
    causeIds: ['edgering-aging-focusring'],
  },
  {
    id: 'm-etch-chamber-clean',
    process: 'ETCH',
    title: '식각 챔버 인시츄 클리닝 주기 관리',
    path: '\\\\fileserver\\공정매뉴얼\\04_식각\\ETCH-PRC-031_챔버클리닝_주기.pdf',
    section: '3장 로트 간 클리닝 삽입 기준',
    classification: 'restricted',
    revision: 'Rev.3',
    updatedAt: '2026-07-02',
    causeIds: ['edgering-r2r-fluorine'],
  },
  {
    id: 'm-etch-uniformity',
    process: 'ETCH',
    title: '식각 균일도 이상 대응 가이드',
    path: '\\\\fileserver\\공정매뉴얼\\04_식각\\ETCH-TRB-004_균일도이상_대응.pdf',
    section: '2장 중심/외곽 편차 진단 순서',
    classification: 'restricted',
    revision: 'Rev.11',
    updatedAt: '2026-06-20',
    causeIds: ['center-static-etch', 'center-spatial-etch'],
  },
  {
    id: 'm-depo-showerhead',
    process: 'DEPOSITION',
    title: 'PECVD 샤워헤드 점검 및 교체 절차',
    path: '\\\\fileserver\\공정매뉴얼\\05_증착\\DEP-MNT-008_샤워헤드_점검교체.pdf',
    section: '5장 홀 막힘 판정 기준',
    classification: 'restricted',
    revision: 'Rev.5',
    updatedAt: '2026-04-28',
    causeIds: ['center-aging-pecvd', 'center-static-cvd'],
  },
  {
    id: 'm-depo-rf',
    process: 'DEPOSITION',
    title: 'PECVD RF 매칭 튜닝 및 반사파 관리',
    path: '\\\\fileserver\\공정매뉴얼\\05_증착\\DEP-PRC-019_RF매칭_튜닝.pdf',
    section: '4장 반사파 상승 시 조치',
    classification: 'restricted',
    revision: 'Rev.2',
    updatedAt: '2026-07-30',
    causeIds: ['edgering-static-pecvd-rf', 'edgering-static-pecvd-flow'],
  },
  {
    id: 'm-depo-fwe',
    process: 'DEPOSITION',
    title: '챔버 시즈닝 및 첫 웨이퍼 효과(FWE) 대응',
    path: '\\\\fileserver\\공정매뉴얼\\05_증착\\DEP-PRC-024_시즈닝_FWE.pdf',
    section: '2장 유휴 시간별 더미 매수',
    classification: 'confidential',
    revision: 'Rev.4',
    updatedAt: '2026-03-11',
    causeIds: ['donut-r2r-pecvd-fwe'],
  },
  {
    id: 'm-photo-ebr',
    process: 'PHOTO',
    title: 'EBR 노즐 정렬 및 폭 관리',
    path: '\\\\fileserver\\공정매뉴얼\\03_포토\\PHO-MNT-021_EBR노즐_정렬.pdf',
    section: '3장 EBR 폭 실측 및 보정',
    classification: 'restricted',
    revision: 'Rev.9',
    updatedAt: '2026-06-05',
    causeIds: ['edgering-static-photo-ebr'],
  },
  {
    id: 'm-photo-coater',
    process: 'PHOTO',
    title: '스핀 코터 RPM 캘리브레이션',
    path: '\\\\fileserver\\공정매뉴얼\\03_포토\\PHO-MNT-014_코터_RPM교정.pdf',
    section: '2장 엔코더 대조 절차',
    classification: 'confidential',
    revision: 'Rev.6',
    updatedAt: '2026-02-19',
    causeIds: ['donut-static-photo'],
  },
  {
    id: 'm-photo-esc',
    process: 'PHOTO',
    title: 'ESC 헬륨 누설 점검 절차',
    path: '\\\\fileserver\\공정매뉴얼\\03_포토\\PHO-MNT-030_ESC_He누설점검.pdf',
    section: '3장 누설 위치 추정',
    classification: 'confidential',
    revision: 'Rev.5',
    updatedAt: '2026-07-18',
    causeIds: ['edgeloc-aging-esc-he', 'donut-aging-esc'],
  },
  {
    id: 'm-cmp-pad',
    process: 'CMP',
    title: 'CMP 패드 수명 관리 및 브레이크인',
    path: '\\\\fileserver\\공정매뉴얼\\09_CMP\\CMP-PRC-007_패드수명_브레이크인.pdf',
    section: '4장 사용 시간별 제거율 보정',
    classification: 'confidential',
    revision: 'Rev.8',
    updatedAt: '2026-05-30',
    causeIds: ['nearfull-r2r-cmp-pad', 'center-aging-cmp'],
  },
  {
    id: 'm-cmp-head',
    process: 'CMP',
    title: 'CMP 캐리어 헤드 존 압력 교정',
    path: '\\\\fileserver\\공정매뉴얼\\09_CMP\\CMP-MNT-002_헤드압력_교정.pdf',
    section: '3장 존별 압력 실측',
    classification: 'confidential',
    revision: 'Rev.10',
    updatedAt: '2026-06-27',
    causeIds: ['center-static-cmp'],
  },
  {
    id: 'm-oxid-rtp',
    process: 'OXIDATION',
    title: 'RTP 존 파워 배분 및 온도 프로파일',
    path: '\\\\fileserver\\공정매뉴얼\\02_산화\\OXI-PRC-011_RTP_존파워.pdf',
    section: '3장 방사형 구배 보정',
    classification: 'confidential',
    revision: 'Rev.4',
    updatedAt: '2026-01-23',
    causeIds: ['donut-static-diffusion', 'edgering-spatial-rtp'],
  },
  {
    id: 'm-clean-rinse',
    process: 'CLEAN',
    title: '세정 Rinse 노즐 점검 및 분사 조건',
    path: '\\\\fileserver\\공정매뉴얼\\10_세정\\CLN-MNT-005_Rinse노즐_점검.pdf',
    section: '2장 노즐 스윕 범위 설정',
    classification: 'internal',
    revision: 'Rev.3',
    updatedAt: '2026-04-09',
    causeIds: ['donut-static-clean'],
  },
  {
    id: 'm-common-robot',
    process: 'COMMON',
    title: '반송 로봇 암 티칭 및 레벨링',
    path: '\\\\fileserver\\공정매뉴얼\\00_공통\\CMN-MNT-016_로봇암_티칭.pdf',
    section: '4장 삽입 궤적 오차 보정',
    classification: 'internal',
    revision: 'Rev.12',
    updatedAt: '2026-07-25',
    causeIds: ['scratch-spatial-robotarm'],
  },
  {
    id: 'm-common-gate',
    process: 'COMMON',
    title: '게이트 도어 · 슬릿 밸브 파티클 관리',
    path: '\\\\fileserver\\공정매뉴얼\\00_공통\\CMN-MNT-022_슬릿밸브_파티클.pdf',
    section: '3장 개폐 시퀀스 조정',
    classification: 'internal',
    revision: 'Rev.6',
    updatedAt: '2026-03-04',
    causeIds: ['edgeloc-spatial-gatedoor'],
  },
  {
    id: 'm-common-esc',
    process: 'COMMON',
    title: 'ESC 냉각계 이상 대응',
    path: '\\\\fileserver\\공정매뉴얼\\00_공통\\CMN-TRB-009_ESC냉각_이상대응.pdf',
    section: '2장 전면 냉각 실패 시 조치',
    classification: 'internal',
    revision: 'Rev.7',
    updatedAt: '2026-06-12',
    causeIds: ['nearfull-static-esc'],
  },
];

export function manualsForCause(causeId: string): ManualRef[] {
  return MANUALS.filter((m) => m.causeIds.includes(causeId));
}

export function manualsForProcess(process: ProcessId): ManualRef[] {
  return MANUALS.filter((m) => m.process === process);
}
