import { GRID_COLS, GRID_ROWS } from '../config/hardware';
import { CELL_DEFECT, CELL_NORMAL, CELL_OUTSIDE, REVIEW_REASON_COPY } from '../config/model';
import { CONFIDENCE_COPY, FAMILIES, confidenceBand } from '../config/taxonomy';
import { DISRUPTION_LABEL, FACTOR_META, PATTERN_LABEL } from '../domain/causes';
import type { DiagnosisPlan } from '../domain/plan';
import type { Inspection } from '../domain/types';
import {
  CLASSIFICATION_META,
  PROCESS_CLASSIFICATION,
  ROLE_META,
  canSeeCause,
  canSeeDetail,
  type Classification,
  type User,
} from './security';

/**
 * 점검 보고서 PNG.
 *
 * 마크다운은 이력 시스템에 붙이기 좋지만, 실제로는 카톡·메일·현장 출력으로 돌리는 일이
 * 더 많다. 그래서 한 장으로 읽히는 이미지가 따로 필요하다.
 *
 * 캔버스에 직접 그린다. 외부 라이브러리(html2canvas 등)를 안 쓴 이유는 두 가지다 —
 * 화면 DOM을 그대로 캡처하면 스크롤·테마·잘린 텍스트가 그대로 딸려 오고, 무엇보다
 * 마스킹 규칙을 화면과 따로 태울 수가 없다. 여기서는 화면과 같은 권한 규칙을 그대로 적용한다.
 *
 * 색은 라이트 테마로 고정한다. 인쇄하거나 남에게 보낼 때 다크 배경이면 못 읽는다.
 */

const W = 1000;
const PAD = 36;

/** 라이트 테마 고정 팔레트 (styles/theme.css의 라이트 값과 동일) */
const C = {
  surface: '#fcfcfb',
  sunken: '#f2f2ee',
  raised: '#ffffff',
  ink: '#0b0b0b',
  ink2: '#52514e',
  muted: '#898781',
  grid: '#e1e0d9',
  baseline: '#c3c2b7',
  series: '#2a78d6',
  deemph: '#c3c2b7',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  cellOutside: '#e6e5e0',
  cellNormal: '#9ec5f4',
  cellDefect: '#0d366b',
};

const FONT = `system-ui, -apple-system, "Segoe UI", "Malgun Gothic", sans-serif`;

interface Ctx {
  g: CanvasRenderingContext2D;
  y: number;
}

const font = (size: number, weight = 400) => `${weight} ${size}px ${FONT}`;

/** 한국어는 공백이 드물어 단어 단위로만 자르면 안 넘어간다 — 글자 단위 폴백을 둔다. */
function wrap(g: CanvasRenderingContext2D, text: string, maxW: number): string[] {
  const lines: string[] = [];
  let line = '';
  for (const ch of text) {
    const next = line + ch;
    if (g.measureText(next).width > maxW && line) {
      lines.push(line);
      line = ch === ' ' ? '' : ch;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

function text(c: Ctx, s: string, x: number, size: number, color: string, weight = 400, maxW = W - PAD * 2): number {
  c.g.font = font(size, weight);
  c.g.fillStyle = color;
  const lines = wrap(c.g, s, maxW);
  for (const ln of lines) {
    c.g.fillText(ln, x, c.y);
    c.y += size * 1.5;
  }
  return lines.length;
}

function rule(c: Ctx, color = C.grid) {
  c.g.fillStyle = color;
  c.g.fillRect(PAD, c.y, W - PAD * 2, 1);
  c.y += 1;
}

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  const rr = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rr, y);
  g.arcTo(x + w, y, x + w, y + h, rr);
  g.arcTo(x + w, y + h, x, y + h, rr);
  g.arcTo(x, y + h, x, y, rr);
  g.arcTo(x, y, x + w, y, rr);
  g.closePath();
  g.fill();
}

/** 배지 하나를 그리고 다음 x 좌표를 돌려준다 */
function badge(g: CanvasRenderingContext2D, s: string, x: number, y: number, color: string, filled = false): number {
  g.font = font(12, filled ? 600 : 400);
  const w = g.measureText(s).width + 18;
  g.fillStyle = filled ? color : C.sunken;
  roundRect(g, x, y - 13, w, 22, 11);
  g.fillStyle = filled ? '#fff' : C.ink2;
  g.fillText(s, x + 9, y + 4);
  return x + w + 6;
}

const pct = (x: number) => `${(x * 100).toFixed(0)}%`;

export interface ReportImageOptions {
  inspection: Inspection;
  plan: DiagnosisPlan;
  user: User;
  /** 상위 몇 개 공정까지 실을지 */
  processLimit?: number;
}

export interface RenderedImage {
  blob: Blob;
  width: number;
  height: number;
  classification: Classification;
  maskedCount: number;
  title: string;
}

const CLASS_RANK: Record<Classification, number> = { internal: 0, confidential: 1, restricted: 2 };

export async function renderReportPng(opts: ReportImageOptions): Promise<RenderedImage> {
  // 1차: 높이를 모르므로 넉넉한 캔버스에 그려 실제 높이를 잰다.
  const probe = draw(opts, 4000);
  // 2차: 잰 높이로 다시 그린다 (아래 여백이 남지 않게)
  const final = draw(opts, probe.height + PAD);

  const blob = await new Promise<Blob>((resolve, reject) => {
    final.canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG 변환 실패'))), 'image/png');
  });

  return {
    blob,
    width: W,
    height: final.height,
    classification: final.classification,
    maskedCount: final.maskedCount,
    title: final.title,
  };
}

function draw({ inspection, plan, user, processLimit = 3 }: ReportImageOptions, canvasHeight: number) {
  const { verdict } = inspection;
  const family = FAMILIES[verdict.family];
  const top = verdict.familyScores[0];
  const band = confidenceBand(top.probability, verdict.familyScores[1]?.probability ?? 0);

  // 배율은 2배로 고정한다. devicePixelRatio를 쓰면 보는 화면에 따라 저장 해상도가
  // 달라져서, 같은 보고서인데 어떤 노트북에서는 흐릿하게 나온다. 출력·공유용이므로
  // 화면 설정과 무관하게 항상 같은 크기여야 한다.
  const SCALE = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(W * SCALE);
  canvas.height = Math.round(canvasHeight * SCALE);
  const g = canvas.getContext('2d')!;
  g.scale(SCALE, SCALE);
  g.textBaseline = 'alphabetic';

  g.fillStyle = C.surface;
  g.fillRect(0, 0, W, canvasHeight);

  const c: Ctx = { g, y: PAD + 20 };
  let maskedCount = 0;
  let maxClass: Classification = 'internal';

  /* ── 헤더 ── */
  text(c, '웨이퍼 결함 스크리닝 점검 보고서', PAD, 24, C.ink, 600);
  c.y += 2;
  text(
    c,
    `${inspection.lotId} · 웨이퍼 #${inspection.waferNo} · ${new Date(inspection.capturedAt).toLocaleString('ko-KR')}`,
    PAD,
    13,
    C.ink2,
  );
  text(
    c,
    `8×8 (64칸) 저해상도 1차 스크리닝 · ${verdict.engineVersion}${verdict.engine === 'rule-mock' ? ' (규칙 기반 대체 — 학습 모델 미연결)' : ''} · 작성 ${user.name} · ${ROLE_META[user.role].label}`,
    PAD,
    12,
    C.muted,
  );
  c.y += 10;
  rule(c);
  c.y += 26;

  /* ── 웨이퍼 맵 + 판정 ── */
  const mapTop = c.y - 14;
  const cell = 26;
  const gap = 3;
  const mapSize = GRID_COLS * cell + (GRID_COLS - 1) * gap;

  for (let r = 0; r < GRID_ROWS; r++) {
    for (let col = 0; col < GRID_COLS; col++) {
      const v = inspection.map[r * GRID_COLS + col] ?? CELL_OUTSIDE;
      g.fillStyle = v === CELL_DEFECT ? C.cellDefect : v === CELL_NORMAL ? C.cellNormal : C.cellOutside;
      roundRect(g, PAD + col * (cell + gap), mapTop + r * (cell + gap), cell, cell, 3);
    }
  }

  let ly = mapTop + mapSize + 22;
  g.font = font(11);
  let lx = PAD;
  for (const [color, label] of [
    [C.cellOutside, '웨이퍼 밖'],
    [C.cellNormal, '정상 die'],
    [C.cellDefect, '불량 die'],
  ] as const) {
    g.fillStyle = color;
    roundRect(g, lx, ly - 9, 11, 11, 3);
    g.fillStyle = C.ink2;
    g.fillText(label, lx + 16, ly);
    lx += g.measureText(label).width + 32;
  }

  // 오른쪽: 판정
  const rx = PAD + mapSize + 40;
  const rw = W - PAD - rx;
  let ry = mapTop + 24;

  g.font = font(34, 600);
  g.fillStyle = C.ink;
  g.fillText(family.label, rx, ry);
  const famW = g.measureText(family.label).width;
  g.font = font(17);
  g.fillStyle = C.ink2;
  g.fillText(pct(top.probability), rx + famW + 12, ry);

  ry += 26;
  let bx = rx;
  bx = badge(g, `신뢰도 ${CONFIDENCE_COPY[band].label}`, bx, ry, C.deemph);
  badge(
    g,
    verdict.review.required ? '검토 필요' : '자동 채택 가능',
    bx,
    ry,
    verdict.review.required ? C.warning : C.good,
    true,
  );

  ry += 26;
  g.font = font(13);
  g.fillStyle = C.ink2;
  g.fillText(`모델 1순위: ${PATTERN_LABEL[verdict.top]} (${verdict.top}) ${pct(verdict.topScore)}`, rx, ry);

  ry += 22;
  g.font = font(12.5);
  for (const ln of wrap(g, family.meaning, rw)) {
    g.fillStyle = C.muted;
    g.fillText(ln, rx, ry);
    ry += 18;
  }

  // 범례 baseline 바로 아래에 다음 제목이 붙지 않도록 충분히 띄운다
  c.y = Math.max(ly + 40, ry + 16);

  /* ── 검토 필요 ──
     배경을 먼저 칠해야 하므로 높이를 미리 재고 나서 그린다. 텍스트를 먼저 그리면
     배경이 덮어버린다. */
  if (verdict.review.required) {
    const innerW = W - PAD * 2 - 32;
    const head = '사람 검토 필요 — 모델 정책이 자동 채택 대상에서 제외했다';

    g.font = font(14, 600);
    const headLines = wrap(g, head, innerW);
    g.font = font(12);
    const bodyLines = verdict.review.reasons.map((r) =>
      wrap(g, `· ${REVIEW_REASON_COPY[r].label} — ${REVIEW_REASON_COPY[r].detail}`, innerW),
    );

    const boxH = 18 + headLines.length * 21 + 4 + bodyLines.flat().length * 18 + 16;
    const boxTop = c.y;

    g.fillStyle = C.sunken;
    roundRect(g, PAD, boxTop, W - PAD * 2, boxH, 8);
    g.fillStyle = C.warning;
    g.fillRect(PAD, boxTop, 4, boxH);

    let ty = boxTop + 18 + 14;
    g.font = font(14, 600);
    g.fillStyle = C.ink;
    for (const ln of headLines) {
      g.fillText(ln, PAD + 16, ty);
      ty += 21;
    }
    ty += 4;
    g.font = font(12);
    g.fillStyle = C.ink2;
    for (const ln of bodyLines.flat()) {
      g.fillText(ln, PAD + 16, ty);
      ty += 18;
    }

    c.y = boxTop + boxH + 24;
  }

  /* ── 9클래스 확률 ── */
  text(c, '9클래스 확률', PAD, 14, C.ink, 600);
  c.y += 4;
  const barX = PAD + 130;
  const barW = W - PAD - barX - 56;
  for (const p of verdict.patterns) {
    const isTop = p.id === verdict.top;
    g.font = font(12.5, isTop ? 600 : 400);
    g.fillStyle = isTop ? C.ink : C.ink2;
    g.fillText(`${PATTERN_LABEL[p.id]}`, PAD, c.y + 4);

    g.fillStyle = C.sunken;
    roundRect(g, barX, c.y - 6, barW, 13, 3);
    g.fillStyle = isTop ? C.series : C.deemph;
    roundRect(g, barX, c.y - 6, Math.max(3, barW * p.probability), 13, 3);

    g.font = font(12);
    g.fillStyle = C.ink2;
    g.fillText(pct(p.probability), barX + barW + 10, c.y + 4);
    c.y += 22;
  }
  c.y += 12;

  /* ── 판정 근거 ── */
  text(c, '판정 근거', PAD, 14, C.ink, 600);
  c.y += 4;
  for (const d of verdict.drivers.filter((x) => x.effect === 'supports').slice(0, 5)) {
    g.font = font(12.5);
    g.fillStyle = C.ink2;
    g.fillText(d.label, PAD, c.y);
    g.font = font(12.5, 600);
    g.fillStyle = C.ink;
    g.fillText(d.value, PAD + 190, c.y);
    c.y += 20;
  }
  c.y += 14;

  /* ── 공정별 점검 순서 ── */
  rule(c);
  c.y += 24;
  text(c, '공정별 점검 순서', PAD, 15, C.ink, 600);
  c.y += 2;
  text(
    c,
    `연관도 순 · 총 예상 ${plan.totalEtaMin}분 · 지금 확인 가능 ${plan.immediateCount}건 / 이력 대조 필요 ${plan.historyCount}건`,
    PAD,
    12,
    C.muted,
  );
  c.y += 10;

  for (const tab of plan.tabs.slice(0, processLimit)) {
    const cls = PROCESS_CLASSIFICATION[tab.process];
    if (CLASS_RANK[cls] > CLASS_RANK[maxClass]) maxClass = cls;

    g.font = font(14, 600);
    g.fillStyle = C.ink;
    g.fillText(`${tab.rank}. ${tab.meta.label}`, PAD, c.y);
    const hw = g.measureText(`${tab.rank}. ${tab.meta.label}`).width;
    let hx = PAD + hw + 12;
    hx = badge(g, `연관도 ${pct(tab.relevance)}`, hx, c.y - 4, C.deemph);
    hx = badge(g, `${tab.totalEtaMin}분`, hx, c.y - 4, C.deemph);
    if (cls !== 'internal') badge(g, CLASSIFICATION_META[cls].label, hx, c.y - 4, cls === 'restricted' ? C.critical : C.warning, true);
    c.y += 22;

    if (!canSeeCause(user, tab.process)) {
      maskedCount += tab.causes.length;
      text(c, `열람 권한 없음 — 이 공정의 원인 ${tab.causes.length}건이 가려졌습니다. 담당자에게 이관할 것.`, PAD + 14, 12, C.serious, 400, W - PAD * 2 - 28);
      c.y += 12;
      continue;
    }

    const detail = canSeeDetail(user, tab.process);

    for (const cause of tab.causes.slice(0, 2)) {
      g.font = font(13, 600);
      g.fillStyle = C.ink;
      g.fillText(`· ${cause.equipment}`, PAD + 14, c.y);
      const cw = g.measureText(`· ${cause.equipment}`).width;
      let cx = PAD + 14 + cw + 10;
      cx = badge(g, FACTOR_META[cause.factor].short, cx, c.y - 4, C.deemph);
      cx = badge(g, `${DISRUPTION_LABEL[cause.actionable.disruption]} ${cause.actionable.etaMin}분`, cx, c.y - 4, C.deemph);
      if (cause.support === 'strong') badge(g, '측정이 지지', cx, c.y - 4, C.good, true);
      else if (cause.needsHistory) badge(g, '이력 대조 필요', cx, c.y - 4, C.deemph);
      c.y += 19;

      text(c, cause.cause, PAD + 26, 12, C.ink2, 400, W - PAD * 2 - 40);

      if (cause.supportNote && cause.support === 'strong') {
        text(c, cause.supportNote, PAD + 26, 11.5, C.muted, 400, W - PAD * 2 - 40);
      }

      if (!detail) {
        maskedCount += 1;
        text(c, '확인 항목·개선안은 권한 제한으로 가려졌습니다.', PAD + 26, 11.5, C.serious, 400, W - PAD * 2 - 40);
      } else {
        for (const chk of cause.actionable.checks.slice(0, 3)) {
          text(c, `☐ ${chk}`, PAD + 26, 11.5, C.ink2, 400, W - PAD * 2 - 40);
        }
      }
      c.y += 8;
    }
    c.y += 6;
  }

  /* ── 푸터 ── */
  c.y += 6;
  rule(c);
  c.y += 20;
  text(c, `${CLASSIFICATION_META[maxClass].label} — 사외 반출 금지. 열람 이력이 기록됩니다.`, PAD, 12, C.ink2, 600);
  if (maskedCount > 0) {
    text(c, `권한 제한으로 ${maskedCount}개 항목이 제외되었습니다.`, PAD, 11.5, C.serious);
  }
  text(
    c,
    '8×8(64칸) 저해상도 1차 스크리닝 결과입니다. 확정 진단이 아니라 점검 우선순위를 좁히기 위한 것이며, 개선안 항목은 검토 전 초안을 포함합니다.',
    PAD,
    11.5,
    C.muted,
  );

  return {
    canvas,
    height: Math.ceil(c.y + 8),
    classification: maxClass,
    maskedCount,
    title: `${inspection.lotId}_W${inspection.waferNo}_${family.short}_점검보고서`,
  };
}
